using System.Text.RegularExpressions;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.VolumeBoost;

/// <summary>
/// Registers the plugin's services with Jellyfin.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddHostedService<ScriptInjector>();
    }
}

/// <summary>
/// Gets the boost script into jellyfin-web:
/// 1. Preferred: via the File Transformation plugin (in-memory, index.html on disk untouched).
/// 2. Fallback: write a &lt;script&gt; tag into index.html on disk.
/// </summary>
public partial class ScriptInjector : IHostedService
{
    private const string StartMarker = "<!-- VolumeBoost:start -->";
    private const string EndMarker = "<!-- VolumeBoost:end -->";

    // index.html is served from /web/, so ../VolumeBoost/ resolves correctly with or without a base URL.
    private const string ScriptTag =
        StartMarker + "<script plugin=\"VolumeBoost\" defer src=\"../VolumeBoost/script.js\"></script>" + EndMarker;

    private readonly IApplicationPaths _appPaths;
    private readonly ILogger<ScriptInjector> _logger;

    public ScriptInjector(IApplicationPaths appPaths, ILogger<ScriptInjector> logger)
    {
        _appPaths = appPaths;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (FileTransformationIntegration.TryRegister(_logger))
        {
            _logger.LogInformation("VolumeBoost: registered with File Transformation; index.html on disk is left alone.");

            // Clean up a tag from an earlier disk-based install, if we're allowed to.
            RemoveFromIndex(_appPaths, null);
            return Task.CompletedTask;
        }

        _logger.LogInformation("VolumeBoost: File Transformation plugin not found, patching index.html on disk instead.");
        PatchIndexOnDisk();
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <summary>
    /// Returns <paramref name="html"/> with exactly one VolumeBoost script tag before &lt;/body&gt;.
    /// </summary>
    internal static string InjectInto(string html)
    {
        var cleaned = Strip(html);
        var bodyEnd = cleaned.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        return bodyEnd < 0 ? cleaned + ScriptTag : cleaned.Insert(bodyEnd, ScriptTag);
    }

    internal static string Strip(string html) => MarkerRegex().Replace(html, string.Empty);

    private void PatchIndexOnDisk()
    {
        var indexPath = Path.Combine(_appPaths.WebPath, "index.html");

        try
        {
            if (!File.Exists(indexPath))
            {
                _logger.LogWarning("VolumeBoost: {Path} not found (is the web client hosted separately?).", indexPath);
                return;
            }

            var html = File.ReadAllText(indexPath);
            var updated = InjectInto(html);
            if (!string.Equals(updated, html, StringComparison.Ordinal))
            {
                File.WriteAllText(indexPath, updated);
                _logger.LogInformation("VolumeBoost: injected script into {Path}", indexPath);
            }
        }
        catch (UnauthorizedAccessException)
        {
            _logger.LogError(
                "VolumeBoost: no write permission for {Path}. Install the 'File Transformation' plugin " +
                "(recommended) or give the Jellyfin user write access to that file.",
                indexPath);
        }
        catch (IOException ex)
        {
            _logger.LogError(ex, "VolumeBoost: failed to update {Path}", indexPath);
        }
    }

    /// <summary>
    /// Removes the injected tag from index.html on disk (used on uninstall / when switching to File Transformation).
    /// </summary>
    internal static void RemoveFromIndex(IApplicationPaths appPaths, ILogger? logger)
    {
        var indexPath = Path.Combine(appPaths.WebPath, "index.html");
        try
        {
            if (!File.Exists(indexPath))
            {
                return;
            }

            var html = File.ReadAllText(indexPath);
            var cleaned = Strip(html);
            if (!string.Equals(cleaned, html, StringComparison.Ordinal))
            {
                File.WriteAllText(indexPath, cleaned);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger?.LogWarning(ex, "VolumeBoost: could not clean {Path}", indexPath);
        }
    }

    [GeneratedRegex("<!-- VolumeBoost:start -->.*?<!-- VolumeBoost:end -->", RegexOptions.Singleline)]
    private static partial Regex MarkerRegex();
}

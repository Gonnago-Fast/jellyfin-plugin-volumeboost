using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Hosting;
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
        // Injects the script tag into index.html in memory (see IndexHtmlInjectionMiddleware).
        serviceCollection.AddTransient<IStartupFilter, VolumeBoostStartupFilter>();
        serviceCollection.AddHostedService<LegacyTagCleanup>();
    }
}

/// <summary>
/// On startup, removes a script tag that version 1.0.0.0 may have written into index.html on disk,
/// so the page doesn't load the script twice. Does nothing if the file isn't writable.
/// </summary>
public class LegacyTagCleanup : IHostedService
{
    private readonly IApplicationPaths _appPaths;
    private readonly ILogger<LegacyTagCleanup> _logger;

    public LegacyTagCleanup(IApplicationPaths appPaths, ILogger<LegacyTagCleanup> logger)
    {
        _appPaths = appPaths;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        HtmlInjector.CleanIndexOnDisk(_appPaths, _logger);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}

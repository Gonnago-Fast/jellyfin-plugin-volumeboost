using System.Text.RegularExpressions;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.VolumeBoost;

/// <summary>
/// Adds / removes the VolumeBoost &lt;script&gt; tag in jellyfin-web's index.html markup.
/// </summary>
public static partial class HtmlInjector
{
    private const string StartMarker = "<!-- VolumeBoost:start -->";
    private const string EndMarker = "<!-- VolumeBoost:end -->";

    // index.html is served from /web/, so ../VolumeBoost/ resolves correctly with or without a base URL.
    private const string ScriptTag =
        StartMarker + "<script plugin=\"VolumeBoost\" defer src=\"../VolumeBoost/script.js\"></script>" + EndMarker;

    /// <summary>
    /// Returns <paramref name="html"/> with exactly one VolumeBoost script tag before &lt;/body&gt;.
    /// </summary>
    public static string InjectInto(string html)
    {
        var cleaned = Strip(html);
        var bodyEnd = cleaned.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        return bodyEnd < 0 ? cleaned + ScriptTag : cleaned.Insert(bodyEnd, ScriptTag);
    }

    /// <summary>
    /// Removes any VolumeBoost script tag.
    /// </summary>
    public static string Strip(string html) => MarkerRegex().Replace(html, string.Empty);

    /// <summary>
    /// Removes a tag that an older version of this plugin wrote into index.html on disk.
    /// Best effort: does nothing if the file isn't writable.
    /// </summary>
    internal static void CleanIndexOnDisk(IApplicationPaths appPaths, ILogger? logger)
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
            logger?.LogDebug(ex, "VolumeBoost: could not clean {Path}", indexPath);
        }
    }

    [GeneratedRegex("<!-- VolumeBoost:start -->.*?<!-- VolumeBoost:end -->", RegexOptions.Singleline)]
    private static partial Regex MarkerRegex();
}

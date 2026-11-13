using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.VolumeBoost.Configuration;

/// <summary>
/// Plugin configuration.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets the maximum boost in percent (e.g. 300 = 3x).
    /// </summary>
    public int MaxBoostPercent { get; set; } = 300;

    /// <summary>
    /// Gets or sets the slider step in percent.
    /// </summary>
    public int StepPercent { get; set; } = 10;
}

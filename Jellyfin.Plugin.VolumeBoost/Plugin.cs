using System.Globalization;
using Jellyfin.Plugin.VolumeBoost.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.VolumeBoost;

/// <summary>
/// Volume Boost plugin: lets the web client play audio above 100%.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    private readonly IApplicationPaths _appPaths;

    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
        _appPaths = applicationPaths;
    }

    public static Plugin? Instance { get; private set; }

    public override string Name => "Volume Boost";

    public static readonly Guid PluginId = Guid.Parse("d4c61c6f-f9ae-4a3c-872b-79a9b3da3518");

    public override Guid Id => PluginId;

    public override string Description => "Boost playback volume above 100% in the Jellyfin web client.";

    public IEnumerable<PluginPageInfo> GetPages()
    {
        return
        [
            new PluginPageInfo
            {
                Name = Name,
                EmbeddedResourcePath = string.Format(
                    CultureInfo.InvariantCulture,
                    "{0}.Configuration.configPage.html",
                    GetType().Namespace)
            }
        ];
    }

    /// <summary>
    /// Remove the script tag from index.html when the plugin is uninstalled.
    /// </summary>
    public override void OnUninstalling()
    {
        ScriptInjector.RemoveFromIndex(_appPaths, null);
        base.OnUninstalling();
    }
}

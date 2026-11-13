using System.Globalization;
using System.Net.Mime;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.VolumeBoost.Api;

/// <summary>
/// Serves the client-side volume boost script.
/// </summary>
[ApiController]
[Route("VolumeBoost")]
public class VolumeBoostController : ControllerBase
{
    private const string ResourceName = "Jellyfin.Plugin.VolumeBoost.Web.volumeboost.js";

    /// <summary>
    /// Gets the volume boost script with the current configuration baked in.
    /// </summary>
    /// <returns>The JavaScript file.</returns>
    [HttpGet("script.js")]
    [AllowAnonymous]
    [Produces("application/javascript")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult GetScript()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName);
        if (stream is null)
        {
            return NotFound();
        }

        using var reader = new StreamReader(stream);
        var js = reader.ReadToEnd();

        var config = Plugin.Instance?.Configuration;
        var max = Math.Clamp(config?.MaxBoostPercent ?? 300, 100, 1000);
        var step = Math.Clamp(config?.StepPercent ?? 10, 1, 100);

        js = js
            .Replace("__MAX_BOOST__", max.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
            .Replace("__STEP__", step.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);

        Response.Headers.CacheControl = "no-cache";
        return Content(js, "application/javascript");
    }
}

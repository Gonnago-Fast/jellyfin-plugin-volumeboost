using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.VolumeBoost;

/// <summary>
/// Puts <see cref="IndexHtmlInjectionMiddleware"/> at the front of Jellyfin's request pipeline.
/// </summary>
public sealed class VolumeBoostStartupFilter : IStartupFilter
{
    private readonly ILogger<VolumeBoostStartupFilter> _logger;

    public VolumeBoostStartupFilter(ILogger<VolumeBoostStartupFilter> logger)
    {
        _logger = logger;
    }

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        return app =>
        {
            _logger.LogInformation("VolumeBoost: adding the script tag to /web/index.html in memory as it is served.");
            app.UseMiddleware<IndexHtmlInjectionMiddleware>();
            next(app);
        };
    }
}

/// <summary>
/// Adds the VolumeBoost &lt;script&gt; tag to jellyfin-web's index.html as it is served, without
/// touching the file on disk. Works when the web folder is read-only (e.g. the official Docker image
/// running as a non-root user) and needs no other plugin.
/// </summary>
public sealed class IndexHtmlInjectionMiddleware
{
    private readonly RequestDelegate _next;

    public IndexHtmlInjectionMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, ILogger<IndexHtmlInjectionMiddleware> logger)
    {
        if (!HttpMethods.IsGet(context.Request.Method) || !IsIndexPath(context.Request.Path.Value))
        {
            await _next(context);
            return;
        }

        // Ask the inner pipeline for a plain, full 200 response we can edit:
        // no compression, and no 304 based on the unmodified file's ETag/date.
        context.Request.Headers.Remove(HeaderNames.AcceptEncoding);
        context.Request.Headers.Remove(HeaderNames.IfNoneMatch);
        context.Request.Headers.Remove(HeaderNames.IfModifiedSince);

        var originalBody = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;

        try
        {
            await _next(context);
        }
        finally
        {
            context.Response.Body = originalBody;
        }

        var response = context.Response;
        var isEditableHtml = response.StatusCode == StatusCodes.Status200OK
            && (response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) ?? false)
            && !response.Headers.ContainsKey(HeaderNames.ContentEncoding);

        if (!isEditableHtml)
        {
            buffer.Position = 0;
            await buffer.CopyToAsync(originalBody, context.RequestAborted);
            return;
        }

        byte[] output;
        try
        {
            var html = Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length);
            output = Encoding.UTF8.GetBytes(HtmlInjector.InjectInto(html));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "VolumeBoost: failed to add the script tag; serving index.html unchanged.");
            output = buffer.ToArray();
        }

        response.Headers.Remove(HeaderNames.ETag);
        response.Headers.Remove(HeaderNames.LastModified);
        response.Headers.CacheControl = "no-cache";
        response.ContentLength = output.Length;
        await originalBody.WriteAsync(output, context.RequestAborted);
    }

    /// <summary>
    /// Matches /web, /web/ and /web/index.html, with or without a base URL in front.
    /// </summary>
    internal static bool IsIndexPath(string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return false;
        }

        return path.EndsWith("/web/index.html", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/web/", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith("/web", StringComparison.OrdinalIgnoreCase);
    }
}

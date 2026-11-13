using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.VolumeBoost;

/// <summary>
/// Integration with IAmParadox27's "File Transformation" plugin
/// (https://github.com/IAmParadox27/jellyfin-plugin-file-transformation), which lets plugins modify
/// jellyfin-web as it is served, without touching files on disk.
///
/// Jellyfin loads each plugin in its own AssemblyLoadContext, so everything is done via reflection and
/// we deliberately don't reference Newtonsoft.Json (its JObject type would differ between load contexts).
/// </summary>
public static class FileTransformationIntegration
{
    /// <summary>
    /// Tries to register our index.html transformation. Returns false if the plugin isn't installed.
    /// </summary>
    internal static bool TryRegister(ILogger logger)
    {
        try
        {
            var ftAssembly = AssemblyLoadContext.All
                .SelectMany(ctx => ctx.Assemblies)
                .FirstOrDefault(a => a.FullName?.Contains(".FileTransformation", StringComparison.Ordinal) ?? false);

            if (ftAssembly is null)
            {
                return false;
            }

            var register = ftAssembly
                .GetType("Jellyfin.Plugin.FileTransformation.PluginInterface")
                ?.GetMethod("RegisterTransformation", BindingFlags.Public | BindingFlags.Static);

            if (register is null)
            {
                logger.LogWarning("VolumeBoost: File Transformation found, but its RegisterTransformation API wasn't.");
                return false;
            }

            var json = JsonSerializer.Serialize(new
            {
                id = Plugin.PluginId.ToString(),
                fileNamePattern = @"index\.html$",
                callbackAssembly = typeof(FileTransformationIntegration).Assembly.FullName,
                callbackClass = typeof(FileTransformationIntegration).FullName,
                callbackMethod = nameof(TransformIndexHtml)
            });

            // RegisterTransformation takes a Newtonsoft JObject (loaded in File Transformation's context).
            // Build one with that type's own static Parse(string), so the types match.
            var paramType = register.GetParameters().FirstOrDefault()?.ParameterType;
            object? payload = json;
            if (paramType is not null && paramType != typeof(string))
            {
                var parse = paramType.GetMethod("Parse", BindingFlags.Public | BindingFlags.Static, [typeof(string)]);
                if (parse is null)
                {
                    logger.LogWarning("VolumeBoost: unexpected RegisterTransformation parameter type {Type}.", paramType.FullName);
                    return false;
                }

                payload = parse.Invoke(null, [json]);
            }

            register.Invoke(null, [payload]);
            return true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "VolumeBoost: registering with File Transformation failed.");
            return false;
        }
    }

    /// <summary>
    /// Called by File Transformation every time index.html is served.
    /// The payload has a "contents" field holding the current HTML.
    /// </summary>
    /// <param name="payload">Transformation payload (a JObject or typed object from File Transformation).</param>
    /// <returns>The modified HTML.</returns>
    public static string TransformIndexHtml(object payload)
    {
        var contents = ExtractContents(payload)
            ?? throw new InvalidOperationException("VolumeBoost: could not read 'contents' from File Transformation payload.");

        return ScriptInjector.InjectInto(contents);
    }

    private static string? ExtractContents(object? payload)
    {
        switch (payload)
        {
            case null:
                return null;
            case string s:
                return TryReadJsonContents(s) ?? s;
        }

        // Typed object with a Contents property?
        var prop = payload.GetType().GetProperty("Contents", BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
        if (prop?.PropertyType == typeof(string))
        {
            return (string?)prop.GetValue(payload);
        }

        // JObject: ToString() yields its JSON.
        return TryReadJsonContents(payload.ToString());
    }

    private static string? TryReadJsonContents(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || json.TrimStart()[0] != '{')
        {
            return null;
        }

        try
        {
            using var doc = JsonDocument.Parse(json);
            foreach (var p in doc.RootElement.EnumerateObject())
            {
                if (string.Equals(p.Name, "contents", StringComparison.OrdinalIgnoreCase) && p.Value.ValueKind == JsonValueKind.String)
                {
                    return p.Value.GetString();
                }
            }
        }
        catch (JsonException)
        {
            // not JSON
        }

        return null;
    }
}

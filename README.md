# Jellyfin Volume Boost

A Jellyfin server plugin that lets the **web client** play audio louder than 100%, the same way
browser "volume booster" extensions do: the `<video>`/`<audio>` element is routed through a Web Audio
`GainNode` (plus a limiter so boosted peaks don't hard-clip).

- Boost slider next to the volume slider in the video player and the audio now-playing bar
- **Shift + ↑ / ↓** changes the boost, double-click the slider resets to 100%
- Boost level is remembered per browser
- Max boost and step size configurable in *Dashboard → Plugins → Volume Boost*

Targets **Jellyfin 10.11.x** (net9.0).

## How it hooks into the web client

1. **File Transformation plugin installed (recommended):** Volume Boost registers an `index.html`
   transformation, and the script tag is added in memory each time the page is served. Nothing on
   disk changes, and Jellyfin upgrades don't break it.
2. **Otherwise:** it adds a `<script>` tag to jellyfin-web's `index.html` on disk at startup
   (between `<!-- VolumeBoost:start/end -->` markers, removed on uninstall). Jellyfin needs write
   access to that file.

The script itself is served by the plugin at `/VolumeBoost/script.js`.

## Install from a plugin repository

1. Push this folder to a GitHub repo (branch `main`).
2. Tag a release: `git tag v1.0.0.0 && git push origin v1.0.0.0`.
   The *Release* workflow builds the DLL, publishes `volumeboost_1.0.0.0.zip` as a GitHub release,
   and adds that version to `manifest.json` on `main`.
3. In Jellyfin: **Dashboard → Plugins → Repositories → +**
   - Name: `Volume Boost`
   - URL: `https://raw.githubusercontent.com/<owner>/<repo>/main/manifest.json`
4. **Catalog → Volume Boost → Install**, then restart Jellyfin.
5. Recommended: also install **File Transformation** (add the repository URL listed in
   github.com/IAmParadox27/jellyfin-plugin-file-transformation's README), then restart again.
6. Hard-reload the web page (Ctrl+F5).

Future updates: push a new tag (`v1.0.1.0`, …) and Jellyfin will offer the update.

## Manual install

```sh
dotnet publish Jellyfin.Plugin.VolumeBoost/Jellyfin.Plugin.VolumeBoost.csproj -c Release -o out
```

Copy `out/Jellyfin.Plugin.VolumeBoost.dll` into `<config>/plugins/VolumeBoost_1.0.0.0/`
(`/config/plugins/` in the official Docker image) and restart Jellyfin.

## Troubleshooting

Look for `VolumeBoost:` lines in the server log. You should see either
`registered with File Transformation` or `injected script into …/index.html`.

## Limitations

- Only affects clients that play through jellyfin-web (browsers, web-based TV apps). Native players
  (Android/iOS apps, Jellyfin Media Player / Desktop, Kodi, Swiftfin) aren't affected.
- Once an element has been boosted, it stays routed through Web Audio until the page reloads. At 100%
  this makes no audible difference.
- The boost stacks on top of Jellyfin's own volume: 100% Jellyfin × 300% boost = 3×.

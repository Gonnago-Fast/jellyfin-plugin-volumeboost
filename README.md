# Jellyfin Volume Boost

A Jellyfin server plugin that lets Jellyfin play audio louder than 100%.

| Client | How the boost works |
| --- | --- |
| Browsers, Android app (web player) | The `<video>`/`<audio>` element is routed through a Web Audio `GainNode`, like browser "volume booster" extensions |
| **Jellyfin Desktop / Jellyfin Media Player** (Windows, macOS, Linux) | These play in mpv, not in the page, so the script adds an mpv audio filter (`lavfi volume` + `alimiter`) through the app's built-in `window.api.player.userCommand` bridge |

Both paths use a limiter, so boosted peaks don't hard-clip.

- Boost slider next to the volume slider in the video player and the audio now-playing bar
- **Shift + ↑ / ↓** changes the boost, double-click the slider resets to 100%
- Boost level is remembered per browser
- Max boost and step size configurable in *Dashboard → Plugins → Volume Boost*

Targets **Jellyfin 12.x** (.NET 10).

## How it hooks into the web client

The plugin adds a small ASP.NET Core middleware to Jellyfin's request pipeline that inserts one
`<script>` tag into `/web/index.html` **in memory** as the page is served. Nothing on disk is changed,
so it works with read-only web folders (e.g. the official Docker image), survives Jellyfin upgrades,
and needs no other plugin. The script itself is served by the plugin at `/VolumeBoost/script.js`.

## Install from a plugin repository

1. Push this folder to a GitHub repo (branch `main`).
2. Publish a release: on GitHub open **Actions → Release → Run workflow**, enter a 4-part version
   (e.g. `1.0.1.0`) and run it. (Pushing a tag like `v1.0.1.0` works too.) The workflow builds the DLL,
   publishes `volumeboost_<version>.zip` as a GitHub release and adds that version to `manifest.json`.
3. In Jellyfin: **Dashboard → Plugins → Repositories → +**
   - Name: `Volume Boost`
   - URL: `https://raw.githubusercontent.com/<owner>/<repo>/main/manifest.json`
4. **Catalog → Volume Boost → Install**, then restart Jellyfin.
5. Hard-reload the web page (Ctrl+F5).

Future updates: run the Release workflow again with a higher version and Jellyfin will offer the update.

## Manual install

```sh
dotnet publish Jellyfin.Plugin.VolumeBoost/Jellyfin.Plugin.VolumeBoost.csproj -c Release -o out
```

Copy `out/Jellyfin.Plugin.VolumeBoost.dll` into `<config>/plugins/VolumeBoost_1.0.0.0/`
(`/config/plugins/` in the official Docker image) and restart Jellyfin.

## Troubleshooting

Look for `VolumeBoost:` lines in the server log. On startup you should see
`VolumeBoost: adding the script tag to /web/index.html in memory as it is served.`
Open `https://<your-server>/web/index.html` and search the page source for `VolumeBoost` to confirm.

## Limitations

- Works in clients that show jellyfin-web: browsers, the Android app with *Video player type: Web player*,
  and Jellyfin Desktop / Jellyfin Media Player. Native players (Android *Integrated player*, Android TV,
  Swiftfin, Findroid, Kodi) aren't affected.
- Desktop app: the boost can't apply while **audio passthrough** (bitstreaming AC3/DTS to a receiver) is
  active, because mpv doesn't decode that audio. Changing the boost during playback may cause a tiny
  audio dropout while mpv rebuilds its filter chain.
- Browser: once an element has been boosted, it stays routed through Web Audio until the page reloads. At
  100% this makes no audible difference.
- The boost stacks on top of Jellyfin's own volume: 100% Jellyfin × 300% boost = 3×.

# Jellyfin Volume Boost

A Jellyfin server plugin that lets Jellyfin play audio louder than 100%, like a browser "volume booster"
extension. Targets **Jellyfin 12.x** (.NET 10).

## What you get

- A **speaker button** (megaphone icon) next to Jellyfin's volume control in the video player and in the
  audio now-playing bar.
- **Hover** over it to open a small popup with the boost slider (100% – 300% by default), the current
  level and a *Reset to 100%* button. On touch screens or with a remote, click/tap the button instead;
  the popup then stays open until you tap it again or elsewhere.
- While boost is above 100%, the icon turns Jellyfin blue.
- **Shift + ↑ / ↓** changes the boost while something is playing, with a short on-screen indicator.
- The boost level is remembered per browser / per app.
- Max boost and step size can be changed in *Dashboard → Plugins → Volume Boost*.

The button and popup are built from Jellyfin's own components (`paper-icon-button-light`, `emby-slider`,
Material icons) and its default palette, so they look like the rest of the player. If you use a custom
theme that restyles Jellyfin's sliders and buttons, it restyles these too.

## How the boost works

| Client | Method |
| --- | --- |
| Browsers, Android app with *Video player type: Web player* | The `<video>`/`<audio>` element is routed through a Web Audio `GainNode` and a limiter. Gain changes glide over ~20 ms, so moving the slider doesn't click. |
| **Jellyfin Desktop / Jellyfin Media Player** (Windows, macOS, Linux) | These apps play in mpv, not in the page. When the app is detected, the script adds one mpv audio filter (`lavfi volume` + `alimiter`) through the app's built-in `window.api.player.userCommand` bridge. After that it only changes the running filter's gain with `af-command`, in small steps, so the audio is never interrupted while you move the slider. |

In both cases a limiter keeps boosted peaks from hard-clipping. At 100% the audio is unchanged.

## How it hooks into the web client

The plugin adds a small ASP.NET Core middleware to Jellyfin's request pipeline that inserts one
`<script>` tag into `/web/index.html` **in memory** as the page is served. Nothing on disk is changed,
so it works with read-only web folders (e.g. the official Docker image), survives Jellyfin upgrades and
needs no other plugin. The script itself is served by the plugin at `/VolumeBoost/script.js`.

## Install from the plugin repository

1. In Jellyfin: **Dashboard → Plugins → Repositories → +**
   - Name: `Volume Boost`
   - URL: `https://raw.githubusercontent.com/Gonnago-Fast/jellyfin-plugin-volumeboost/main/manifest.json`
2. **Catalog → Volume Boost → Install**, then restart Jellyfin.
3. Reload the client: Ctrl+F5 in a browser, or close and reopen the desktop app.

Updates show up in the Catalog / *My Plugins* like any other plugin. After updating, restart Jellyfin and
reload the client.

## Publishing a new version (maintainers)

On GitHub open **Actions → Release → Run workflow**, enter a higher 4-part version (e.g. `1.0.2.0`) and run
it. (Pushing a tag like `v1.0.2.0` works too.) The workflow builds the DLL, publishes
`volumeboost_<version>.zip` as a GitHub release and adds that version to `manifest.json`.

## Manual install

```sh
dotnet publish Jellyfin.Plugin.VolumeBoost/Jellyfin.Plugin.VolumeBoost.csproj -c Release -o out
```

Copy `out/Jellyfin.Plugin.VolumeBoost.dll` into `<config>/plugins/Volume Boost_<version>/`
(`/config/plugins/` in the official Docker image) and restart Jellyfin.

## Standalone script

`Jellyfin.Plugin.VolumeBoost/Web/volumeboost.js` also works without the server plugin (defaults: max 300%,
step 10%), e.g. pasted into the JavaScript Injector plugin or loaded as a userscript.

## Troubleshooting

- Server log on startup:
  `VolumeBoost: adding the script tag to /web/index.html in memory as it is served.`
- Open `https://<your-server>/web/index.html` and search the page source for `VolumeBoost`.
- In the browser console (or the desktop app's log) you should see `[VolumeBoost] loaded …`, and in the
  desktop app also `[VolumeBoost] desktop app detected, boosting through mpv`.

## Limitations

- Works in clients that show jellyfin-web: browsers, the Android app with *Video player type: Web player*,
  and Jellyfin Desktop / Jellyfin Media Player. Native players (Android *Integrated player*, Android TV,
  Swiftfin, Findroid, Kodi) aren't affected.
- Desktop app: the boost can't apply while **audio passthrough** (bitstreaming AC3/DTS to a receiver) is
  active, because mpv doesn't decode that audio.
- Browser: once an element has been boosted, it stays routed through Web Audio until the page reloads.
  At 100% this makes no audible difference.
- The boost stacks on top of Jellyfin's own volume: 100% Jellyfin × 300% boost = 3×.

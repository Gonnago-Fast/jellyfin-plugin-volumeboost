/*
 * Jellyfin Volume Boost
 * Lets Jellyfin play audio louder than 100%:
 *  - in browsers / web-player apps: via the Web Audio API (like browser "volume booster" extensions)
 *  - in the Jellyfin Desktop / Jellyfin Media Player apps: via an mpv audio filter, because those
 *    apps play media in mpv instead of an HTML <video> element.
 *
 * Works as part of the Jellyfin.Plugin.VolumeBoost server plugin, or standalone
 * (e.g. pasted into the "JavaScript Injector" plugin, or as a userscript).
 */
(function () {
    'use strict';

    if (window.__jfVolumeBoostLoaded) return;
    window.__jfVolumeBoostLoaded = true;

    // The server plugin replaces this placeholder with the configured maximum.
    // Standalone, it falls back to 300%.
    var MAX = Math.max(100, Number('__MAX_BOOST__') || 300);
    var STEP = Math.max(1, Number('__STEP__') || 10);
    var STORE_KEY = 'jfVolumeBoostPercent';

    var ctx = null;
    var graphs = []; // { el, gain }
    var boost = load();

    // ---------- desktop app (mpv) ----------
    // Jellyfin Desktop and Jellyfin Media Player expose window.api.player, whose userCommand()
    // runs an mpv command. We add a labelled lavfi filter, so the boost stacks on top of
    // Jellyfin's own volume and isn't limited by mpv's volume-max (130% by default).
    var MPV_LABEL = '@volboost';
    var desktopPlayer = null;
    var lastMpvGain = null;

    function findDesktopPlayer() {
        var p = window.api && window.api.player;
        return p && typeof p.userCommand === 'function' ? p : null;
    }

    function applyMpv(force) {
        if (!desktopPlayer) return;
        var g = boost / 100;
        if (!force && g === lastMpvGain) return;
        lastMpvGain = g;
        try {
            desktopPlayer.userCommand('af remove ' + MPV_LABEL);
            if (g > 1) {
                // volume = gain, alimiter = keep boosted peaks from hard-clipping (no auto-leveling).
                desktopPlayer.userCommand('af add ' + MPV_LABEL + ':lavfi=[volume=' + g.toFixed(3) +
                    ',alimiter=limit=0.97:level=0]');
            }
        } catch (e) {
            console.warn('[VolumeBoost] mpv command failed', e);
        }
    }

    function onDesktopFound(p) {
        if (desktopPlayer || !p) return;
        desktopPlayer = p;
        console.info('[VolumeBoost] desktop app detected, boosting through mpv');
        applyMpv(true);
    }

    function detectDesktop() {
        if (window.apiPromise && typeof window.apiPromise.then === 'function') {
            window.apiPromise.then(function () { onDesktopFound(findDesktopPlayer()); }, function () {});
        }
        // window.api is set up asynchronously over Qt WebChannel, so poll for a while too.
        var tries = 0;
        (function poll() {
            var p = findDesktopPlayer();
            if (p) { onDesktopFound(p); return; }
            if (++tries < 120) setTimeout(poll, 500);
        })();
    }

    // ---------- persistence ----------
    function load() {
        try {
            var v = Number(localStorage.getItem(STORE_KEY));
            if (v >= 100 && v <= MAX) return v;
        } catch (e) { /* storage unavailable */ }
        return 100;
    }

    function save() {
        try { localStorage.setItem(STORE_KEY, String(boost)); } catch (e) { /* ignore */ }
    }

    // ---------- audio graph ----------
    function getContext() {
        if (!ctx) {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
        }
        if (ctx.state === 'suspended') ctx.resume().catch(function () {});
        return ctx;
    }

    function findGraph(el) {
        for (var i = 0; i < graphs.length; i++) {
            if (graphs[i].el === el) return graphs[i];
        }
        return null;
    }

    // An element can only be routed through Web Audio once, and that can't be undone,
    // so we only hook it once boosting is actually wanted (> 100%).
    function attach(el) {
        var existing = findGraph(el);
        if (existing) return existing;

        var c = getContext();
        if (!c) return null;

        try {
            var source = c.createMediaElementSource(el);
            var gain = c.createGain();

            // Brick-wall-ish limiter so boosted peaks don't hard-clip.
            var limiter = c.createDynamicsCompressor();
            limiter.threshold.value = -1;
            limiter.knee.value = 0;
            limiter.ratio.value = 20;
            limiter.attack.value = 0.003;
            limiter.release.value = 0.1;

            source.connect(gain);
            gain.connect(limiter);
            limiter.connect(c.destination);

            gain.gain.value = boost / 100;
            var g = { el: el, gain: gain };
            graphs.push(g);
            return g;
        } catch (e) {
            console.warn('[VolumeBoost] could not attach to media element', e);
            return null;
        }
    }

    function applyGain() {
        // drop elements that are gone
        graphs = graphs.filter(function (g) { return g.el.isConnected; });

        if (boost > 100) {
            var media = document.querySelectorAll('video, audio');
            for (var i = 0; i < media.length; i++) attach(media[i]);
        }

        var c = ctx;
        for (var j = 0; j < graphs.length; j++) {
            var p = graphs[j].gain.gain;
            if (c) p.setTargetAtTime(boost / 100, c.currentTime, 0.02);
            else p.value = boost / 100;
        }
    }

    function setBoost(value, showOsd) {
        var v = Math.round(Math.min(MAX, Math.max(100, value)) / STEP) * STEP;
        v = Math.min(MAX, Math.max(100, v));
        boost = v;
        save();
        applyGain();
        applyMpv(false);
        syncControls();
        if (showOsd) flash('Volume boost: ' + boost + '%');
    }

    // Hook new media as soon as it starts playing.
    document.addEventListener('play', function (e) {
        var el = e.target;
        if (!(el instanceof HTMLMediaElement)) return;
        if (boost > 100) {
            var g = attach(el);
            if (g) g.gain.gain.value = boost / 100;
        } else if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(function () {});
        }
    }, true);

    // ---------- UI ----------
    var style = document.createElement('style');
    style.textContent = [
        '.volumeBoostControl{display:inline-flex;align-items:center;gap:.4em;margin:0 .6em;white-space:nowrap;font-size:.85em;opacity:.9}',
        '.volumeBoostControl input[type=range]{width:6em;accent-color:#00a4dc;cursor:pointer;margin:0}',
        '.volumeBoostControl .volumeBoostLabel{min-width:3.2em;text-align:right;font-variant-numeric:tabular-nums}',
        '.volumeBoostControl.boosting .volumeBoostLabel{color:#ffb74d;font-weight:600}',
        '#volumeBoostOsd{position:fixed;top:12%;left:50%;transform:translateX(-50%);z-index:99999;',
        'background:rgba(0,0,0,.75);color:#fff;padding:.5em 1em;border-radius:.4em;font-size:1.1em;',
        'pointer-events:none;opacity:0;transition:opacity .2s}',
        '#volumeBoostOsd.show{opacity:1}'
    ].join('');
    document.head.appendChild(style);

    function makeControl() {
        var wrap = document.createElement('div');
        wrap.className = 'volumeBoostControl';
        wrap.title = 'Volume boost (Shift + ↑ / ↓)';

        var label = document.createElement('span');
        label.className = 'volumeBoostLabel';

        var range = document.createElement('input');
        range.type = 'range';
        range.min = '100';
        range.max = String(MAX);
        range.step = String(STEP);
        range.setAttribute('aria-label', 'Volume boost');

        range.addEventListener('input', function () { setBoost(Number(range.value), false); });
        // Stop the OSD from treating slider interaction as "hide controls"/seek clicks.
        ['click', 'mousedown', 'pointerdown', 'keydown'].forEach(function (t) {
            range.addEventListener(t, function (e) { e.stopPropagation(); });
        });
        range.addEventListener('dblclick', function (e) { e.stopPropagation(); setBoost(100, true); });

        wrap.appendChild(range);
        wrap.appendChild(label);
        updateControl(wrap);
        return wrap;
    }

    function updateControl(wrap) {
        var range = wrap.querySelector('input');
        var label = wrap.querySelector('.volumeBoostLabel');
        range.value = String(boost);
        label.textContent = boost + '%';
        wrap.classList.toggle('boosting', boost > 100);
    }

    function syncControls() {
        var all = document.querySelectorAll('.volumeBoostControl');
        for (var i = 0; i < all.length; i++) updateControl(all[i]);
    }

    // Containers of the volume slider in the video OSD and the audio "now playing" bar.
    var ANCHORS = '.osdVolumeSliderContainer, .nowPlayingBarVolumeSliderContainer';

    function injectControls() {
        var anchors = document.querySelectorAll(ANCHORS);
        for (var i = 0; i < anchors.length; i++) {
            var a = anchors[i];
            var next = a.nextElementSibling;
            if (next && next.classList.contains('volumeBoostControl')) continue;
            a.parentNode.insertBefore(makeControl(), a.nextSibling);
        }
    }

    var pending = false;
    new MutationObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; injectControls(); });
    }).observe(document.documentElement, { childList: true, subtree: true });
    injectControls();

    // ---------- keyboard: Shift+Up / Shift+Down ----------
    document.addEventListener('keydown', function (e) {
        if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        var t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (!isPlayerVisible()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        setBoost(boost + (e.key === 'ArrowUp' ? STEP : -STEP), true);
    }, true);

    // Something is playing if there's an HTML media element (web player) or, in the desktop app,
    // the player's volume controls are on screen.
    function isPlayerVisible() {
        if (document.querySelector('video, audio')) return true;
        if (!desktopPlayer) return false;
        var anchors = document.querySelectorAll(ANCHORS);
        for (var i = 0; i < anchors.length; i++) {
            if (anchors[i].offsetParent !== null) return true;
        }
        return false;
    }

    detectDesktop();

    // ---------- small on-screen indicator ----------
    var osd = null, osdTimer = null;
    function flash(text) {
        if (!osd) {
            osd = document.createElement('div');
            osd.id = 'volumeBoostOsd';
            document.body.appendChild(osd);
        }
        osd.textContent = text;
        osd.classList.add('show');
        clearTimeout(osdTimer);
        osdTimer = setTimeout(function () { osd.classList.remove('show'); }, 1200);
    }

    console.info('[VolumeBoost] loaded (max ' + MAX + '%, current ' + boost + '%)');
})();

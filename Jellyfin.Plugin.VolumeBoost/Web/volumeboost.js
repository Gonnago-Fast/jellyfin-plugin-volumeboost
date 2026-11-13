/*
 * Jellyfin Volume Boost
 * Lets Jellyfin play audio louder than 100%:
 *  - in browsers / web-player apps: via the Web Audio API (like browser "volume booster" extensions)
 *  - in the Jellyfin Desktop / Jellyfin Media Player apps: via an mpv audio filter, because those
 *    apps play media in mpv instead of an HTML <video> element.
 *
 * UI: a speaker button next to Jellyfin's volume control. Hovering it (or clicking / focusing it)
 * opens a small popup with the boost slider. Built from Jellyfin's own components
 * (paper-icon-button-light, emby-slider, Material icons) and default palette variables.
 *
 * Works as part of the Jellyfin.Plugin.VolumeBoost server plugin, or standalone
 * (e.g. pasted into the "JavaScript Injector" plugin, or as a userscript).
 */
(function () {
    'use strict';

    if (window.__jfVolumeBoostLoaded) return;
    window.__jfVolumeBoostLoaded = true;

    // The server plugin replaces these placeholders with the configured values.
    // Standalone, they fall back to 300% / 10%.
    var MAX = Math.max(100, Number('__MAX_BOOST__') || 300);
    var STEP = Math.max(1, Number('__STEP__') || 10);
    var STORE_KEY = 'jfVolumeBoostPercent';

    var boost = load();

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

    // ---------- browser playback: Web Audio ----------
    var ctx = null;
    var graphs = []; // { el, gain }

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

            // Limiter so boosted peaks don't hard-clip.
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

    function applyWebAudio() {
        graphs = graphs.filter(function (g) { return g.el.isConnected; });

        if (boost > 100) {
            var media = document.querySelectorAll('video, audio');
            for (var i = 0; i < media.length; i++) attach(media[i]);
        }

        for (var j = 0; j < graphs.length; j++) {
            var p = graphs[j].gain.gain;
            // Smooth glide (~20 ms time constant) so dragging the slider doesn't click.
            if (ctx) p.setTargetAtTime(boost / 100, ctx.currentTime, 0.02);
            else p.value = boost / 100;
        }
    }

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

    // ---------- desktop app playback: mpv ----------
    // Jellyfin Desktop and Jellyfin Media Player expose window.api.player.userCommand(), which runs an
    // mpv command. We add ONE labelled lavfi filter (volume + limiter) when the app is detected — before
    // anything plays — and from then on only change its gain in place with `af-command`, gliding in
    // small steps. Rebuilding the filter chain on every change (what 1.0.x did) briefly interrupts
    // the audio, which is what made dragging the slider crackle.
    var MPV_LABEL = 'volboost';
    var MPV_RAMP_STEP = 0.05;   // max gain change per tick
    var MPV_RAMP_MS = 25;       // tick length
    var desktopPlayer = null;
    var mpvGain = 1;
    var mpvTimer = null;

    function mpv(cmd) {
        try {
            desktopPlayer.userCommand(cmd);
        } catch (e) {
            console.warn('[VolumeBoost] mpv command failed: ' + cmd, e);
        }
    }

    function findDesktopPlayer() {
        var p = window.api && window.api.player;
        return p && typeof p.userCommand === 'function' ? p : null;
    }

    function installMpvFilter() {
        mpvGain = boost / 100;
        // Remove a filter left over from a previous page load in the same app session, then add ours.
        // limit=1 keeps the limiter inactive for normal audio, so 100% sounds exactly like no filter.
        mpv('af remove @' + MPV_LABEL);
        mpv('af add @' + MPV_LABEL + ':lavfi=[volume=' + mpvGain.toFixed(3) + ',alimiter=limit=1:level=0]');
    }

    function applyMpv() {
        if (!desktopPlayer || mpvTimer) return;
        mpvTimer = setInterval(function () {
            var target = boost / 100;
            var diff = target - mpvGain;
            if (Math.abs(diff) < 0.0005) {
                clearInterval(mpvTimer);
                mpvTimer = null;
                return;
            }
            mpvGain += Math.max(-MPV_RAMP_STEP, Math.min(MPV_RAMP_STEP, diff));
            mpv('af-command ' + MPV_LABEL + ' volume ' + mpvGain.toFixed(3) + ' volume');
        }, MPV_RAMP_MS);
    }

    function onDesktopFound(p) {
        if (desktopPlayer || !p) return;
        desktopPlayer = p;
        console.info('[VolumeBoost] desktop app detected, boosting through mpv');
        installMpvFilter();
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

    // ---------- shared ----------
    function setBoost(value, showOsd) {
        var v = Math.round(Math.min(MAX, Math.max(100, value)) / STEP) * STEP;
        v = Math.min(MAX, Math.max(100, v));
        if (v === boost) { syncUi(); return; }
        boost = v;
        save();
        applyWebAudio();
        applyMpv();
        syncUi();
        if (showOsd) flash(boost);
    }

    // ---------- UI ----------
    var style = document.createElement('style');
    style.textContent = [
        // While boosting, the icon uses Jellyfin's primary color (like other active player controls).
        '.btnVolumeBoost.boosting{color:var(--jf-palette-primary-main,#00a4dc)}',
        '.nowPlayingBarVolumeSliderContainer.hide + .btnVolumeBoost{display:none}',

        // Popup: Jellyfin's default menu surface (paper background, small radius, MUI-like shadow).
        '.volumeBoostPopup{position:fixed;z-index:100000;width:16em;box-sizing:border-box;padding:0.85em 1.1em 0.7em;',
        'background:var(--jf-palette-background-paper,#202020);color:var(--jf-palette-text-primary,#fff);',
        'border-radius:0.25em;box-shadow:0 0.3em 1.2em rgba(0,0,0,0.55);',
        'opacity:0;visibility:hidden;transform:translateY(0.35em);',
        'transition:opacity 0.14s ease,transform 0.14s ease,visibility 0s linear 0.14s}',
        '.volumeBoostPopup.open{opacity:1;visibility:visible;transform:none;transition:opacity 0.14s ease,transform 0.14s ease}',
        '.volumeBoostPopup.below{transform:translateY(-0.35em)}',
        '.volumeBoostPopup.open.below{transform:none}',
        '.volumeBoostPopupHeader{display:flex;align-items:center;justify-content:space-between;margin-bottom:0.35em}',
        '.volumeBoostPopupTitle{display:flex;align-items:center;gap:0.4em;font-size:0.9em;',
        'color:var(--jf-palette-text-secondary,rgba(255,255,255,0.7))}',
        '.volumeBoostPopupTitle .material-icons{font-size:1.3em}',
        '.volumeBoostPopupValue{font-size:1.15em;font-weight:600;font-variant-numeric:tabular-nums}',
        '.volumeBoostPopup.boosting .volumeBoostPopupValue{color:var(--jf-palette-primary-main,#00a4dc)}',
        '.volumeBoostPopup .sliderContainer{width:100%}',
        '.volumeBoostPopup input[type=range]:not(.mdl-slider){width:100%;accent-color:var(--jf-palette-primary-main,#00a4dc)}',
        '.volumeBoostPopupFooter{display:flex;align-items:center;justify-content:space-between;margin-top:0.45em;',
        'font-size:0.75em;color:var(--jf-palette-text-secondary,rgba(255,255,255,0.7))}',
        '.volumeBoostReset{background:none;border:0;padding:0.2em 0.4em;margin:-0.2em -0.4em;border-radius:0.2em;',
        'font:inherit;color:var(--jf-palette-primary-main,#00a4dc);cursor:pointer}',
        '.volumeBoostReset:hover{background:var(--jf-palette-action-hover,rgba(255,255,255,0.08))}',
        '.volumeBoostReset:disabled{color:inherit;opacity:0.5;cursor:default;background:none}',

        // Keyboard-shortcut indicator, styled like Jellyfin's toast.
        '#volumeBoostOsd{position:fixed;top:12%;left:50%;transform:translateX(-50%);z-index:100001;',
        'display:flex;align-items:center;gap:0.5em;padding:0.6em 1.1em;border-radius:0.25em;',
        'background:var(--jf-palette-background-paper,#202020);color:var(--jf-palette-text-primary,#fff);',
        'box-shadow:0 0.3em 1.2em rgba(0,0,0,0.55);font-variant-numeric:tabular-nums;',
        'pointer-events:none;opacity:0;transition:opacity 0.2s}',
        '#volumeBoostOsd.show{opacity:1}'
    ].join('');
    document.head.appendChild(style);

    var ICON = 'campaign'; // megaphone, from Jellyfin's bundled Material icon font

    // One popup, shared by all buttons (OSD and now-playing bar). It lives in <body> so the player's
    // own layout/overflow can't clip it.
    var popup = document.createElement('div');
    popup.className = 'volumeBoostPopup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Volume boost');
    popup.innerHTML =
        '<div class="volumeBoostPopupHeader">' +
            '<span class="volumeBoostPopupTitle"><span class="material-icons ' + ICON + '" aria-hidden="true"></span>Volume boost</span>' +
            '<span class="volumeBoostPopupValue"></span>' +
        '</div>' +
        '<div class="sliderContainer volumeBoostSliderContainer">' +
            '<input is="emby-slider" type="range" step="' + STEP + '" min="100" max="' + MAX + '" value="' + boost + '" class="volumeBoostSlider" aria-label="Volume boost" />' +
        '</div>' +
        '<div class="volumeBoostPopupFooter">' +
            '<span>Shift + ↑ / ↓</span>' +
            '<button type="button" class="volumeBoostReset">Reset to 100%</button>' +
        '</div>';
    document.body.appendChild(popup);

    var slider = popup.querySelector('.volumeBoostSlider');
    var valueLabel = popup.querySelector('.volumeBoostPopupValue');
    var resetBtn = popup.querySelector('.volumeBoostReset');

    slider.getBubbleText = function (percent, value) { return Math.round(value) + '%'; };
    slider.addEventListener('input', function () { setBoost(Number(slider.value), false); });
    slider.addEventListener('change', function () { setBoost(Number(slider.value), false); });
    resetBtn.addEventListener('click', function () { setBoost(100, false); });

    // Keep the player's own click/keyboard handlers out of the popup.
    ['click', 'mousedown', 'pointerdown', 'touchstart', 'dblclick'].forEach(function (t) {
        popup.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    popup.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closePopup(true); return; }
        e.stopPropagation();
    });

    // ----- open / close -----
    var anchor = null;
    var closeTimer = null;
    var pinned = false; // opened by click/tap: stays open until clicked again or elsewhere
    var visibilityWatch = null;

    function positionPopup() {
        if (!anchor) return;
        var r = anchor.getBoundingClientRect();
        var w = popup.offsetWidth;
        var h = popup.offsetHeight;
        var left = Math.min(Math.max(r.left + r.width / 2 - w / 2, 8), window.innerWidth - w - 8);
        var top = r.top - h - 10;
        var below = top < 8;
        if (below) top = r.bottom + 10;
        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
        popup.classList.toggle('below', below);
    }

    function openPopup(btn) {
        clearTimeout(closeTimer);
        anchor = btn;
        syncUi();
        positionPopup();
        popup.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
        // Close if the button disappears (player controls auto-hide, player closed).
        clearInterval(visibilityWatch);
        visibilityWatch = setInterval(function () {
            if (!anchor || !anchor.isConnected || anchor.offsetParent === null) {
                if (!slider.dragging) closePopup(true);
            } else {
                positionPopup();
            }
        }, 250);
    }

    function closePopup(now) {
        clearTimeout(closeTimer);
        var doClose = function () {
            if (slider.dragging) { closeTimer = setTimeout(doClose, 200); return; }
            popup.classList.remove('open');
            pinned = false;
            clearInterval(visibilityWatch);
            if (anchor) anchor.setAttribute('aria-expanded', 'false');
            anchor = null;
        };
        if (now) doClose(); else closeTimer = setTimeout(doClose, 280);
    }

    popup.addEventListener('mouseenter', function () { clearTimeout(closeTimer); });
    popup.addEventListener('mouseleave', function () { if (!pinned) closePopup(false); });
    document.addEventListener('pointerdown', function (e) {
        if (!popup.classList.contains('open')) return;
        if (popup.contains(e.target) || (anchor && anchor.contains(e.target))) return;
        closePopup(true);
    }, true);
    window.addEventListener('resize', positionPopup);

    function makeButton(inNowPlayingBar) {
        var btn = document.createElement('button');
        btn.setAttribute('is', 'paper-icon-button-light');
        btn.type = 'button';
        btn.className = 'btnVolumeBoost ' + (inNowPlayingBar ? 'mediaButton' : 'autoSize');
        btn.setAttribute('aria-label', 'Volume boost');
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML =
            '<span class="' + (inNowPlayingBar ? '' : 'xlargePaperIconButton ') + 'material-icons ' + ICON + '" aria-hidden="true"></span>';

        btn.addEventListener('mouseenter', function () { openPopup(btn); });
        btn.addEventListener('mouseleave', function () { if (!pinned) closePopup(false); });
        btn.addEventListener('focus', function () { if (!popup.classList.contains('open')) openPopup(btn); });
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (popup.classList.contains('open') && pinned && anchor === btn) {
                closePopup(true);
            } else {
                openPopup(btn);
                pinned = true;
            }
        });
        btn.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closePopup(true);
        });
        // Keep the OSD from treating these as clicks on the video.
        ['mousedown', 'pointerdown', 'dblclick'].forEach(function (t) {
            btn.addEventListener(t, function (e) { e.stopPropagation(); });
        });

        updateButton(btn);
        return btn;
    }

    function updateButton(btn) {
        btn.classList.toggle('boosting', boost > 100);
        btn.title = 'Volume boost: ' + boost + '% (Shift + ↑ / ↓)';
    }

    function syncUi() {
        var btns = document.querySelectorAll('.btnVolumeBoost');
        for (var i = 0; i < btns.length; i++) updateButton(btns[i]);
        valueLabel.textContent = boost + '%';
        popup.classList.toggle('boosting', boost > 100);
        resetBtn.disabled = boost <= 100;
        if (!slider.dragging && Number(slider.value) !== boost) slider.value = boost;
    }

    // Containers of the volume slider in the video player and in the audio "now playing" bar.
    var ANCHORS = '.osdVolumeSliderContainer, .nowPlayingBarVolumeSliderContainer';

    function injectButtons() {
        var anchors = document.querySelectorAll(ANCHORS);
        for (var i = 0; i < anchors.length; i++) {
            var a = anchors[i];
            var next = a.nextElementSibling;
            if (next && next.classList.contains('btnVolumeBoost')) continue;
            a.parentNode.insertBefore(makeButton(a.classList.contains('nowPlayingBarVolumeSliderContainer')), a.nextSibling);
        }
    }

    var pending = false;
    new MutationObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; injectButtons(); });
    }).observe(document.documentElement, { childList: true, subtree: true });
    injectButtons();

    // ---------- keyboard: Shift+Up / Shift+Down ----------
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

    // ---------- on-screen indicator for the keyboard shortcut ----------
    var osd = null, osdTimer = null;
    function flash(value) {
        if (!osd) {
            osd = document.createElement('div');
            osd.id = 'volumeBoostOsd';
            osd.innerHTML = '<span class="material-icons ' + ICON + '" aria-hidden="true"></span><span></span>';
            document.body.appendChild(osd);
        }
        osd.lastChild.textContent = 'Volume boost ' + value + '%';
        osd.classList.add('show');
        clearTimeout(osdTimer);
        osdTimer = setTimeout(function () { osd.classList.remove('show'); }, 1200);
    }

    syncUi();
    detectDesktop();

    console.info('[VolumeBoost] loaded (max ' + MAX + '%, current ' + boost + '%)');
})();

'use strict';

/**
 * Renderer — YouTube IFrame API + chrome UI.
 * Parse helpers come from lib/youtube-url.js (YouTubeUrl global).
 */

(function () {
  const YTUrl = window.YouTubeUrl;
  if (!YTUrl) {
    console.error('YouTubeUrl helpers missing');
    return;
  }

  const api = window.overlay;
  const $ = (id) => document.getElementById(id);

  const chromeEl = $('chrome');
  const urlInput = $('url-input');
  const btnLoad = $('btn-load');
  const opacitySlider = $('opacity');
  const opacityLabel = $('opacity-label');
  const btnAspect = $('btn-aspect');
  const btnAot = $('btn-aot');
  const btnCt = $('btn-clickthrough');
  const btnMin = $('btn-min');
  const btnClose = $('btn-close');
  const placeholder = $('placeholder');
  const loading = $('loading');
  const toastEl = $('toast');
  const grip = $('grip');
  const playerHost = $('player-host');

  let player = null;
  let ytApiReady = false;
  let pendingLoad = null;
  let lockAspect = false;
  let clickThrough = false;
  let chromeLocked = false; // keep visible while typing / interacting
  let idleTimer = null;
  let toastTimer = null;

  // —— Toast ——
  function showToast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', !!isError);
    toastEl.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3200);
  }

  function setLoading(on) {
    loading.classList.toggle('hidden', !on);
  }

  function setOpacityUi(frac) {
    const clamped = clamp(frac, 0.3, 1);
    const pct = Math.round(clamped * 100);
    opacitySlider.value = String(pct);
    opacityLabel.textContent = pct + '%';
    // Translucency only on the video stage — chrome stays fully opaque.
    document.documentElement.style.setProperty('--video-opacity', String(clamped));
  }

  function clamp(n, a, b) {
    return Math.min(b, Math.max(a, n));
  }

  function setToggle(btn, on) {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  // —— Chrome idle hide ——
  function showChrome() {
    chromeEl.classList.remove('hidden-chrome');
    document.body.classList.remove('idle');
  }

  function hideChrome() {
    if (chromeLocked || clickThrough) return;
    if (document.activeElement === urlInput) return;
    chromeEl.classList.add('hidden-chrome');
    document.body.classList.add('idle');
  }

  function bumpIdle() {
    showChrome();
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(hideChrome, 2200);
  }

  document.addEventListener('mousemove', (e) => {
    if (e.clientY < 40) bumpIdle();
  });
  chromeEl.addEventListener('mouseenter', () => {
    chromeLocked = true;
    showChrome();
  });
  chromeEl.addEventListener('mouseleave', () => {
    chromeLocked = false;
    bumpIdle();
  });

  // —— YouTube player ——
  window.onYouTubeIframeAPIReady = function () {
    ytApiReady = true;
    if (pendingLoad) {
      const p = pendingLoad;
      pendingLoad = null;
      createPlayer(p);
    }
  };

  // If API already loaded (cached)
  if (window.YT && window.YT.Player) {
    ytApiReady = true;
  }

  function ensurePlayerMount() {
    let mount = document.getElementById('player');
    if (!mount) {
      mount = document.createElement('div');
      mount.id = 'player';
      // Insert before placeholder so overlays stay on top
      const ph = document.getElementById('placeholder');
      if (ph && ph.parentNode === playerHost) playerHost.insertBefore(mount, ph);
      else playerHost.insertBefore(mount, playerHost.firstChild);
    }
    return mount;
  }

  function destroyPlayer() {
    if (player) {
      try {
        player.destroy();
      } catch {
        /* ignore */
      }
      player = null;
    }
    // YT.Player replaces #player with an iframe; remove any leftover mount/iframe
    const stale = document.getElementById('player');
    if (stale) stale.remove();
    playerHost.querySelectorAll('iframe').forEach((el) => el.remove());
  }

  function createPlayer(parsed) {
    destroyPlayer();
    ensurePlayerMount();
    placeholder.classList.add('hidden');
    setLoading(true);

    const vars = {
      autoplay: 1,
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
      enablejsapi: 1,
    };
    // YouTube rejects file:// as origin; only send real http(s) origins
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      vars.origin = location.origin;
    }
    if (parsed.listId) {
      vars.list = parsed.listId;
      if (!parsed.videoId) vars.listType = 'playlist';
    }

    const opts = {
      width: '100%',
      height: '100%',
      playerVars: vars,
      // IFrame API is most reliable on youtube.com (nocookie still allowed via sanitize)
      host: 'https://www.youtube.com',
      events: {
        onReady: () => {
          setLoading(false);
          placeholder.classList.add('hidden');
        },
        onError: (e) => {
          console.error('YT onError', e && e.data);
          // Recover with a direct embed (150/153 common in locked-down / software-GPU envs)
          fallbackEmbed(parsed);
        },
      },
    };

    if (parsed.videoId) {
      opts.videoId = parsed.videoId;
    }

    try {
      player = new YT.Player('player', opts);
      // If the API replaces the node asynchronously, give it a moment then verify
      setTimeout(() => {
        const iframe = document.querySelector('#player-host iframe');
        if (!iframe) {
          console.warn('No iframe after YT.Player — falling back to direct embed');
          fallbackEmbed(parsed);
        }
      }, 2500);
    } catch (err) {
      setLoading(false);
      console.error(err);
      fallbackEmbed(parsed);
    }
  }

  function fallbackEmbed(parsed) {
    destroyPlayer();
    ensurePlayerMount();
    const embed = YTUrl.sanitizeEmbedSrc(
      YTUrl.buildEmbedUrl(parsed, {
        autoplay: true,
        origin: (location.protocol === 'http:' || location.protocol === 'https:')
          ? location.origin
          : undefined,
      })
    );
    // Prefer youtube.com for Electron file:// loads if nocookie is flaky
    let src = embed;
    if (src) src = src.replace('www.youtube-nocookie.com', 'www.youtube.com');
    src = YTUrl.sanitizeEmbedSrc(src);
    if (!src) {
      placeholder.classList.remove('hidden');
      showToast('Could not build a safe embed URL', true);
      setLoading(false);
      return;
    }
    const mount = document.getElementById('player');
    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.allow =
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.title = 'YouTube';
    iframe.style.border = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    mount.appendChild(iframe);
    placeholder.classList.add('hidden');
    setLoading(false);
    // postMessage play/pause still works roughly via Space no-op without API player
    player = {
      playVideo: () => {
        try {
          iframe.contentWindow.postMessage(
            JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
            '*'
          );
        } catch (_) {}
      },
      pauseVideo: () => {
        try {
          iframe.contentWindow.postMessage(
            JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
            '*'
          );
        } catch (_) {}
      },
      getPlayerState: () => -1,
      destroy: () => {
        iframe.remove();
      },
    };
  }

  function loadFromInput(raw) {
    const text = (raw == null ? urlInput.value : raw).trim();
    if (!text) {
      showToast('Paste a YouTube URL or 11-character video ID', true);
      return;
    }
    const parsed = YTUrl.parseYouTubeInput(text);
    if (!parsed || (!parsed.videoId && !parsed.listId)) {
      showToast('Invalid YouTube URL', true);
      return;
    }
    // Sanity-check embed URL before touching the player
    const embed = YTUrl.buildEmbedUrl(parsed, { origin: location.origin || undefined });
    const safe = YTUrl.sanitizeEmbedSrc(embed);
    if (!safe) {
      showToast('Blocked unsafe embed URL', true);
      return;
    }

    if (api && api.saveVideo) api.saveVideo(text);

    if (!ytApiReady && !(window.YT && window.YT.Player)) {
      pendingLoad = parsed;
      setLoading(true);
      showToast('Waiting for YouTube API…');
      return;
    }
    ytApiReady = true;
    createPlayer(parsed);
  }

  function togglePlayPause() {
    if (!player || typeof player.getPlayerState !== 'function') return;
    try {
      const state = player.getPlayerState();
      // 1 = playing, 2 = paused, 3 = buffering, 5 = cued, -1 = unstarted, 0 = ended
      if (state === 1 || state === 3) player.pauseVideo();
      else player.playVideo();
    } catch {
      /* ignore */
    }
  }

  // —— Wire UI ——
  btnLoad.addEventListener('click', () => loadFromInput());
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      loadFromInput();
    }
  });

  // Paste into field or globally when not typing elsewhere
  urlInput.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (text && text.trim()) {
      // Let paste complete, then load
      setTimeout(() => loadFromInput(urlInput.value), 0);
    }
  });

  opacitySlider.addEventListener('input', async () => {
    const frac = Number(opacitySlider.value) / 100;
    setOpacityUi(frac);
    if (api) await api.setOpacity(frac);
  });

  btnAspect.addEventListener('click', async () => {
    lockAspect = !lockAspect;
    setToggle(btnAspect, lockAspect);
    if (api) await api.setAspectLock(lockAspect);
  });

  btnAot.addEventListener('click', async () => {
    if (!api) return;
    const on = await api.toggleAlwaysOnTop();
    setToggle(btnAot, on);
  });

  btnCt.addEventListener('click', async () => {
    if (!api) return;
    const on = await api.toggleClickThrough();
    applyClickThrough(on);
  });

  btnMin.addEventListener('click', () => api && api.minimize());
  btnClose.addEventListener('click', () => api && api.close());

  grip.addEventListener('mouseenter', () => api && api.gripEnter());
  grip.addEventListener('mouseleave', () => api && api.gripLeave());
  grip.addEventListener('click', async () => {
    if (!api) return;
    await api.gripEnter();
    const on = await api.setClickThrough(false);
    applyClickThrough(on);
    showToast('Click-through off — you can interact again');
    bumpIdle();
  });

  function applyClickThrough(on) {
    clickThrough = !!on;
    setToggle(btnCt, clickThrough);
    document.body.classList.toggle('click-through', clickThrough);
    grip.classList.toggle('visible', clickThrough);
    if (clickThrough) {
      showChrome();
      showToast('Click-through ON — use ◎ grip or Ctrl+Shift+C to exit');
    }
  }

  // —— Keyboard ——
  document.addEventListener('keydown', async (e) => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';

    // Opacity [ ]
    if (!typing && e.key === '[') {
      e.preventDefault();
      if (api) setOpacityUi(await api.nudgeOpacity(-0.05));
      bumpIdle();
      return;
    }
    if (!typing && e.key === ']') {
      e.preventDefault();
      if (api) setOpacityUi(await api.nudgeOpacity(0.05));
      bumpIdle();
      return;
    }

    // Ctrl/Cmd+Shift+C click-through (also global in main)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      if (api) applyClickThrough(await api.toggleClickThrough());
      return;
    }

    // Ctrl/Cmd+Shift+T always on top
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      if (api) setToggle(btnAot, await api.toggleAlwaysOnTop());
      return;
    }

    // Ctrl/Cmd+V outside input → paste URL from clipboard into field and load
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V') && !typing) {
      // Electron/Chromium: try clipboard read via paste event fallback
      // navigator.clipboard may need focus; attempt async
      e.preventDefault();
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          urlInput.value = text.trim();
          loadFromInput(text);
          bumpIdle();
        } else {
          showToast('Clipboard empty', true);
        }
      } catch {
        // Focus input so user can paste normally
        showChrome();
        urlInput.focus();
        showToast('Focus URL field — paste with Ctrl+V');
      }
      return;
    }

    if (!typing && e.code === 'Space') {
      e.preventDefault();
      togglePlayPause();
      return;
    }

    if (e.key === 'Escape') {
      urlInput.blur();
      chromeLocked = false;
      hideChrome();
    }
  });

  // —— Init from main ——
  if (api && api.onInit) {
    api.onInit((state) => {
      if (state.opacity != null) setOpacityUi(state.opacity);
      lockAspect = !!state.lockAspect;
      setToggle(btnAspect, lockAspect);
      setToggle(btnAot, state.alwaysOnTop !== false);
      if (state.lastVideo) {
        urlInput.value = state.lastVideo;
        // Auto-load last video
        loadFromInput(state.lastVideo);
      }
      bumpIdle();
    });
  }

  if (api && api.onOpacityChanged) {
    api.onOpacityChanged((v) => setOpacityUi(v));
  }
  if (api && api.onClickThroughChanged) {
    api.onClickThroughChanged((v) => applyClickThrough(v));
  }
  if (api && api.onAlwaysOnTopChanged) {
    api.onAlwaysOnTopChanged((v) => setToggle(btnAot, v));
  }

  // Fallback if running outside Electron (e.g. opened as file for CSS check)
  if (!api) {
    setOpacityUi(0.92);
    bumpIdle();
  }
})();

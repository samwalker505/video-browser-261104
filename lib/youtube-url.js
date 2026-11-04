'use strict';

/**
 * Pure YouTube URL / ID parsers — works in Node (smoke tests) and browser (UMD).
 * Returns { videoId, listId? } or null if invalid.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof root === 'object') {
    root.YouTubeUrl = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
  const LIST_ID_RE = /^[a-zA-Z0-9_-]+$/;

  /**
   * @param {string} input
   * @returns {{ videoId: string, listId?: string } | null}
   */
  function parseYouTubeInput(input) {
    if (input == null) return null;
    const raw = String(input).trim();
    if (!raw) return null;

    if (VIDEO_ID_RE.test(raw)) {
      return { videoId: raw };
    }

    let url;
    try {
      const withScheme = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
      url = new URL(withScheme);
    } catch {
      return null;
    }

    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    let videoId = null;
    let listId = null;

    const listParam = url.searchParams.get('list');
    if (listParam && LIST_ID_RE.test(listParam)) {
      listId = listParam;
    }

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0] || '';
      if (VIDEO_ID_RE.test(id)) videoId = id;
    } else if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.pathname === '/watch' || parts[0] === 'watch') {
        const v = url.searchParams.get('v');
        if (v && VIDEO_ID_RE.test(v)) videoId = v;
      } else if (
        parts[0] === 'embed' ||
        parts[0] === 'v' ||
        parts[0] === 'shorts' ||
        parts[0] === 'live'
      ) {
        const id = parts[1] || '';
        if (VIDEO_ID_RE.test(id)) videoId = id;
      } else if (parts[0] === 'playlist') {
        if (listId) return { videoId: '', listId: listId };
        return null;
      }
    } else {
      return null;
    }

    if (!videoId && !listId) return null;
    if (!videoId && listId) return { videoId: '', listId: listId };

    const result = { videoId: videoId };
    if (listId) result.listId = listId;
    return result;
  }

  /**
   * @param {{ videoId: string, listId?: string }} parsed
   * @param {{ autoplay?: boolean, origin?: string }} [opts]
   * @returns {string | null}
   */
  function buildEmbedUrl(parsed, opts) {
    opts = opts || {};
    if (!parsed || (!parsed.videoId && !parsed.listId)) return null;
    const params = new URLSearchParams();
    params.set('modestbranding', '1');
    params.set('rel', '0');
    params.set('playsinline', '1');
    params.set('enablejsapi', '1');
    if (opts.autoplay) params.set('autoplay', '1');
    if (opts.origin) params.set('origin', opts.origin);
    if (parsed.listId) params.set('list', parsed.listId);

    if (parsed.videoId) {
      return (
        'https://www.youtube.com/embed/' +
        encodeURIComponent(parsed.videoId) +
        '?' +
        params.toString()
      );
    }
    return 'https://www.youtube.com/embed/videoseries?' + params.toString();
  }

  /**
   * @param {string} src
   * @returns {string | null}
   */
  function sanitizeEmbedSrc(src) {
    if (!src || typeof src !== 'string') return null;
    let url;
    try {
      url = new URL(src);
    } catch {
      return null;
    }
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
    if (!url.pathname.startsWith('/embed/')) return null;
    const allowed = {
      modestbranding: 1,
      rel: 1,
      playsinline: 1,
      enablejsapi: 1,
      autoplay: 1,
      origin: 1,
      list: 1,
      start: 1,
      end: 1,
      loop: 1,
      playlist: 1,
      controls: 1,
      fs: 1,
      listType: 1,
    };
    const keys = Array.from(url.searchParams.keys());
    for (let i = 0; i < keys.length; i++) {
      if (!allowed[keys[i]]) url.searchParams.delete(keys[i]);
    }
    return url.toString();
  }

  return {
    parseYouTubeInput: parseYouTubeInput,
    buildEmbedUrl: buildEmbedUrl,
    sanitizeEmbedSrc: sanitizeEmbedSrc,
    VIDEO_ID_RE: VIDEO_ID_RE,
  };
});

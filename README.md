# YouTube Overlay

Translucent, always-on-top YouTube player for coding. Paste a link, dial opacity, optionally enable click-through so mouse events reach your IDE underneath.

> **Why Electron?** A normal browser tab **cannot** sit translucent over other apps or stay always-on-top across the desktop. This Electron shell is required for real OS overlay behavior. A browser-only helper lives in `fallback/pip.html` (Chrome Document PiP) but is not a substitute.

## Quick start

```bash
cd youtube-overlay
npm install
npm start
```

### Platforms

| OS | Notes |
|----|--------|
| **Linux** | Uses `alwaysOnTop` level `screen-saver` so the window stays above many fullscreen apps. Transparency may need Chromium flags (already enabled: `--enable-transparent-visuals`). If the window is fully opaque on your GPU/driver, quit the app and start with `npx electron . --disable-gpu` (or `ELECTRON_DISABLE_GPU=1`). Opacity slider adjusts the **video stage** via CSS (30–100%); the toolbar stays opaque. Click-through uses `setIgnoreMouseEvents(true, { forward: true })`. |
| **macOS** | Works out of the box. Global shortcuts: `Cmd+Shift+C` (click-through), `Cmd+Shift+T` (pin). Grant Accessibility if prompted for global shortcuts. |
| **Windows** | Works out of the box. Same shortcuts with `Ctrl`. |

## Using it

1. **Paste a URL** into the top field (or focus the window and press `Ctrl/Cmd+V`) — supports:
   - `https://www.youtube.com/watch?v=…`
   - `https://youtu.be/…`
   - Shorts / embed / live paths
   - Playlist `list=` (with or without a video id)
   - Bare 11-character video IDs  
   Then press **Load** or Enter.
2. **Opacity** — drag the slider, or press `[` / `]` (±5%, range 30–100%).
3. **Click-through** — `Ctrl+Shift+C` (also a global shortcut). Mouse passes through to apps below so you can keep coding. A red **◎** grip stays interactive in the top-right so you can always turn click-through **off** (never get stuck).
4. **Always on top** — `Ctrl+Shift+T` or the **Pin** button.
5. **16:9** — toggle aspect lock while resizing.
6. **Space** — play/pause (via YouTube IFrame API).
7. **Escape** — hide the thin chrome bar (hover near the top to show it again).

Window position, size, opacity, aspect lock, pin state, and last video are restored from a small JSON file under Electron `userData`.


## How playback works

On launch the main process starts a tiny **loopback-only** static server (`http://127.0.0.1:<ephemeral>/`) and loads the UI from there. YouTube’s IFrame API needs a real `http` origin — loading the UI as `file://` often fails with embed error 153. Nothing is exposed on the LAN.

Videos are embedded via the official YouTube IFrame API (`youtube.com/embed/...` with `modestbranding=1`, `rel=0`, `playsinline=1`). No API key, no scraping, no downloads.
## Scripts

```bash
npm start          # launch overlay
npm run smoke      # unit-style URL parse/sanitize asserts (no Electron needed)
```

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- Preload exposes a narrow `window.overlay` bridge only
- Embeds use `youtube-nocookie.com` with sanitized `src`; no scraping, no downloads, no API key

## Fallback (browser only)

Open `fallback/pip.html` in Chrome/Edge for Document Picture-in-Picture experiments. It will **not** give translucency over your IDE — use `npm start` for that.

## License

MIT

'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

/** @typedef {{ x: number, y: number, width: number, height: number, opacity: number, lastVideo: string, lockAspect: boolean, alwaysOnTop: boolean }} PersistedState */

const DEFAULT_BOUNDS = { width: 480, height: 270, x: undefined, y: undefined };
const MIN_WIDTH = 240;
const MIN_HEIGHT = 160;
const DEFAULT_OPACITY = 0.92;
const OPACITY_MIN = 0.3;
const OPACITY_MAX = 1.0;

let mainWindow = null;
let clickThrough = false;
/** Video-layer opacity (applied in renderer CSS; window stays at 1.0 so chrome stays opaque). */
let contentOpacity = DEFAULT_OPACITY;
/** Keep a thin interactive strip so user can always exit click-through */
const GRIP_HEIGHT = 36;

function statePath() {
  return path.join(app.getPath('userData'), 'overlay-state.json');
}

/** @returns {Partial<PersistedState>} */
function loadState() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') return data;
  } catch {
    /* first run or corrupt — ignore */
  }
  return {};
}

/** @param {Partial<PersistedState>} partial */
function saveState(partial) {
  try {
    const current = loadState();
    const next = { ...current, ...partial };
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save state:', err.message);
  }
}

function clampOpacity(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_OPACITY;
  return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, n));
}


/** Tiny loopback static server so YouTube IFrame API gets an http origin (file:// breaks embeds). */
let localServer = null;
let localOrigin = null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

function startLocalServer() {
  return new Promise((resolve, reject) => {
    const root = path.resolve(__dirname);
    localServer = http.createServer((req, res) => {
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1');
        // Strip leading slashes so path.resolve(root, rel) cannot jump to FS root
        let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
        if (!rel || rel.endsWith('/')) rel = (rel || '') + 'index.html';
        const filePath = path.resolve(root, rel);
        const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
        if (filePath !== root && !filePath.startsWith(rootPrefix)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err && err.message ? err.message : err));
      }
    });
    localServer.listen(0, '127.0.0.1', () => {
      const { port } = localServer.address();
      localOrigin = `http://127.0.0.1:${port}`;
      resolve(localOrigin);
    });
    localServer.on('error', reject);
  });
}

function createWindow() {
  const saved = loadState();
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay().workArea;

  let width = Number(saved.width) || DEFAULT_BOUNDS.width;
  let height = Number(saved.height) || DEFAULT_BOUNDS.height;
  width = Math.max(MIN_WIDTH, Math.min(width, primary.width));
  height = Math.max(MIN_HEIGHT, Math.min(height, primary.height));

  let x = saved.x;
  let y = saved.y;
  // Validate bounds are on a visible display
  if (typeof x === 'number' && typeof y === 'number') {
    const onScreen = displays.some((d) => {
      const a = d.workArea;
      return x + width > a.x && x < a.x + a.width && y + height > a.y && y < a.y + a.height;
    });
    if (!onScreen) {
      x = undefined;
      y = undefined;
    }
  }

  const opacity = clampOpacity(saved.opacity ?? DEFAULT_OPACITY);
  contentOpacity = opacity;
  const alwaysOnTop = saved.alwaysOnTop !== false;

  // Linux transparency: Chromium sometimes needs these switches.
  // They are set earlier in app.commandLine; window still uses transparent:true.
  mainWindow = new BrowserWindow({
    width,
    height,
    x: typeof x === 'number' ? x : undefined,
    y: typeof y === 'number' ? y : undefined,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop,
    skipTaskbar: false,
    show: false,
    title: 'YouTube Overlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  // On Linux, 'screen-saver' level helps stay above many fullscreen apps
  if (alwaysOnTop) {
    try {
      mainWindow.setAlwaysOnTop(true, process.platform === 'linux' ? 'screen-saver' : 'floating');
    } catch {
      mainWindow.setAlwaysOnTop(true);
    }
  }

  // Keep the native window fully opaque so the toolbar is never dimmed by compositor opacity.
  mainWindow.setOpacity(1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (localOrigin) {
    mainWindow.loadURL(localOrigin + '/index.html');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Push initial state to renderer
    mainWindow.webContents.send('state:init', {
      opacity,
      lastVideo: typeof saved.lastVideo === 'string' ? saved.lastVideo : '',
      lockAspect: !!saved.lockAspect,
      alwaysOnTop,
      clickThrough: false,
      platform: process.platform,
    });
  });

  // Persist bounds on move/resize (debounced)
  let saveTimer = null;
  const scheduleSaveBounds = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const b = mainWindow.getBounds();
      saveState({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        opacity: contentOpacity,
      });
    }, 400);
  };
  mainWindow.on('move', scheduleSaveBounds);
  mainWindow.on('resize', scheduleSaveBounds);

  mainWindow.on('close', () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const b = mainWindow.getBounds();
        saveState({
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          opacity: contentOpacity,
          alwaysOnTop: mainWindow.isAlwaysOnTop(),
        });
      }
    } catch {
      /* ignore */
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in default browser (not inside overlay)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' || u.protocol === 'http:') {
        shell.openExternal(url);
      }
    } catch {
      /* ignore */
    }
    return { action: 'deny' };
  });

  // Aspect lock: enforce 16:9 on resize when enabled
  let lockAspect = !!saved.lockAspect;
  mainWindow.on('will-resize', (event, newBounds) => {
    if (!lockAspect) return;
    // Keep width, adjust height to 16:9 (chrome ~32px included roughly via content)
    const targetH = Math.round(newBounds.width * 9 / 16);
    if (Math.abs(newBounds.height - targetH) > 2) {
      event.preventDefault();
      mainWindow.setBounds({
        x: newBounds.x,
        y: newBounds.y,
        width: newBounds.width,
        height: Math.max(MIN_HEIGHT, targetH),
      });
    }
  });

  // Expose setters used by IPC
  mainWindow.__setLockAspect = (v) => {
    lockAspect = !!v;
    saveState({ lockAspect });
  };
}

function setClickThrough(enabled) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  clickThrough = !!enabled;
  try {
    if (clickThrough) {
      // forward: true lets mouse-move events still reach the window (for hover grip)
      if (process.platform === 'linux' || process.platform === 'darwin' || process.platform === 'win32') {
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        mainWindow.setIgnoreMouseEvents(true);
      }
    } else {
      mainWindow.setIgnoreMouseEvents(false);
    }
  } catch (err) {
    console.error('setIgnoreMouseEvents failed:', err.message);
  }
  mainWindow.webContents.send('clickthrough:changed', clickThrough);
}

function adjustOpacity(delta) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const next = clampOpacity(contentOpacity + delta);
  contentOpacity = next;
  saveState({ opacity: next });
  mainWindow.webContents.send('opacity:changed', next);
}

function toggleAlwaysOnTop() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const next = !mainWindow.isAlwaysOnTop();
  try {
    mainWindow.setAlwaysOnTop(next, process.platform === 'linux' ? 'screen-saver' : 'floating');
  } catch {
    mainWindow.setAlwaysOnTop(next);
  }
  saveState({ alwaysOnTop: next });
  mainWindow.webContents.send('alwaysontop:changed', next);
}

function registerIpc() {
  ipcMain.handle('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });
  ipcMain.handle('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
  ipcMain.handle('opacity:get', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return DEFAULT_OPACITY;
    return contentOpacity;
  });
  ipcMain.handle('opacity:set', (_e, value) => {
    if (!mainWindow || mainWindow.isDestroyed()) return DEFAULT_OPACITY;
    const next = clampOpacity(value);
    contentOpacity = next;
    saveState({ opacity: next });
    mainWindow.webContents.send('opacity:changed', next);
    return next;
  });
  ipcMain.handle('opacity:nudge', (_e, delta) => {
    adjustOpacity(Number(delta) || 0);
    return contentOpacity;
  });
  ipcMain.handle('clickthrough:set', (_e, enabled) => {
    setClickThrough(!!enabled);
    return clickThrough;
  });
  ipcMain.handle('clickthrough:toggle', () => {
    setClickThrough(!clickThrough);
    return clickThrough;
  });
  ipcMain.handle('clickthrough:get', () => clickThrough);
  ipcMain.handle('alwaysontop:toggle', () => {
    toggleAlwaysOnTop();
    return mainWindow ? mainWindow.isAlwaysOnTop() : true;
  });
  ipcMain.handle('alwaysontop:get', () =>
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.isAlwaysOnTop() : true
  );
  ipcMain.handle('aspect:set', (_e, locked) => {
    if (mainWindow && mainWindow.__setLockAspect) mainWindow.__setLockAspect(!!locked);
    return !!locked;
  });
  ipcMain.handle('state:saveVideo', (_e, lastVideo) => {
    if (typeof lastVideo === 'string') saveState({ lastVideo: lastVideo.slice(0, 500) });
    return true;
  });
  ipcMain.handle('grip:enter', () => {
    // Temporarily accept mouse so user can disable click-through from the grip
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (clickThrough) {
      try {
        mainWindow.setIgnoreMouseEvents(false);
      } catch {
        /* ignore */
      }
    }
  });
  ipcMain.handle('grip:leave', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (clickThrough) {
      try {
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
      } catch {
        try {
          mainWindow.setIgnoreMouseEvents(true);
        } catch {
          /* ignore */
        }
      }
    }
  });
}

function registerShortcuts() {
  // Global shortcuts — only a couple, so we don't steal too many keys from the IDE
  try {
    globalShortcut.register('CommandOrControl+Shift+C', () => {
      setClickThrough(!clickThrough);
    });
    globalShortcut.register('CommandOrControl+Shift+T', () => {
      toggleAlwaysOnTop();
    });
  } catch (err) {
    console.error('globalShortcut register failed:', err.message);
  }
}

// Linux transparent window quirks (must be before ready)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  // Some GPUs need disable-gpu for transparency; try without first.
  // Uncomment next line if the window is fully opaque on your distro:
  // app.commandLine.appendSwitch('disable-gpu');
}

app.whenReady().then(async () => {
  registerIpc();
  try {
    await startLocalServer();
  } catch (err) {
    console.error('Local server failed, falling back to loadFile:', err);
    localOrigin = null;
  }
  createWindow();
  registerShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (localServer) {
    try { localServer.close(); } catch { /* ignore */ }
    localServer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

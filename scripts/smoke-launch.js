'use strict';
/**
 * Opens the real app entry (main.js) briefly is heavy; instead mirror local-server load.
 * Prefer: node scripts/smoke-parse.js for parsers; this checks embed iframe appears.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('disable-gpu');
}

ipcMain.handle('state:saveVideo', () => true);
ipcMain.handle('opacity:get', () => 0.92);
ipcMain.handle('opacity:set', (_e, v) => v);
ipcMain.handle('opacity:nudge', () => 0.92);
ipcMain.handle('clickthrough:set', () => false);
ipcMain.handle('clickthrough:toggle', () => false);
ipcMain.handle('clickthrough:get', () => false);
ipcMain.handle('alwaysontop:toggle', () => true);
ipcMain.handle('alwaysontop:get', () => true);
ipcMain.handle('aspect:set', (_e, v) => v);
ipcMain.handle('window:minimize', () => {});
ipcMain.handle('window:close', () => { app.quit(); });
ipcMain.handle('grip:enter', () => {});
ipcMain.handle('grip:leave', () => {});
ipcMain.handle('window:beginMove', () => true);
ipcMain.handle('window:endMove', () => true);

function startServer(root) {
  return new Promise((resolve, reject) => {
    const rootResolved = path.resolve(root);
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (!rel || rel.endsWith('/')) rel = (rel || '') + 'index.html';
      const filePath = path.resolve(rootResolved, rel);
      const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
      if ((filePath !== rootResolved && !filePath.startsWith(prefix)) || !fs.existsSync(filePath)) {
        res.writeHead(404); res.end('no'); return;
      }
      res.writeHead(200);
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
    server.on('error', reject);
  });
}

app.whenReady().then(async () => {
  const root = path.join(__dirname, '..');
  const { server, origin } = await startServer(root);
  const win = new BrowserWindow({
    width: 480,
    height: 270,
    frame: false,
    transparent: true,
    show: true,
    webPreferences: {
      preload: path.join(root, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    console.log('[renderer]', level, message);
  });
  await win.loadURL(origin + '/index.html');

  const ready = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const t0 = Date.now();
      (function tick() {
        if (window.YouTubeUrl && window.YT && window.YT.Player) return resolve(true);
        if (Date.now() - t0 > 15000) return resolve(false);
        setTimeout(tick, 200);
      })();
    })
  `);
  if (!ready) {
    console.error('SMOKE-LAUNCH FAIL: API not ready');
    server.close();
    app.exit(1);
    return;
  }

  const result = await win.webContents.executeJavaScript(`
    (function () {
      document.getElementById('url-input').value = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
      document.getElementById('btn-load').click();
      return { protocol: location.protocol, origin: location.origin };
    })()
  `);
  console.log('load-result', JSON.stringify(result));
  await new Promise((r) => setTimeout(r, 5000));
  const state = await win.webContents.executeJavaScript(`
    ({
      hasIframe: !!document.querySelector('#player-host iframe'),
      iframeSrc: (document.querySelector('#player-host iframe') || {}).src || null,
      placeholderHidden: document.getElementById('placeholder').classList.contains('hidden'),
      toast: document.getElementById('toast').textContent,
    })
  `);
  console.log('dom-state', JSON.stringify(state, null, 2));
  server.close();
  if (!state.hasIframe || !state.placeholderHidden) {
    console.error('SMOKE-LAUNCH FAIL');
    app.exit(1);
    return;
  }
  console.log('SMOKE-LAUNCH OK');
  app.exit(0);
});

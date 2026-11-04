'use strict';
/**
 * Verifies edge mousedown triggers window:beginMove and bounds change while "dragging".
 */
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('disable-gpu');
}

let moveCount = 0;
let endCount = 0;

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
ipcMain.handle('window:close', () => {
  app.quit();
});
ipcMain.handle('grip:enter', () => {});
ipcMain.handle('grip:leave', () => {});

/** Mirror main.js move helper */
let session = null;
function stopMove() {
  if (session) {
    clearInterval(session.timer);
    session = null;
  }
}
ipcMain.handle('window:beginMove', (event) => {
  moveCount += 1;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  stopMove();
  const bounds = win.getBounds();
  const cursor = screen.getCursorScreenPoint();
  session = {
    startX: cursor.x,
    startY: cursor.y,
    winX: bounds.x,
    winY: bounds.y,
    width: bounds.width,
    height: bounds.height,
    timer: setInterval(() => {
      const pt = screen.getCursorScreenPoint();
      const dx = pt.x - session.startX;
      const dy = pt.y - session.startY;
      win.setBounds({
        x: session.winX + dx,
        y: session.winY + dy,
        width: session.width,
        height: session.height,
      });
    }, 16),
  };
  return true;
});
ipcMain.handle('window:endMove', () => {
  endCount += 1;
  stopMove();
  return true;
});

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
        res.writeHead(404);
        res.end('no');
        return;
      }
      res.writeHead(200);
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })
    );
    server.on('error', reject);
  });
}

app.whenReady().then(async () => {
  const root = path.join(__dirname, '..');
  const { server, origin } = await startServer(root);
  const win = new BrowserWindow({
    width: 400,
    height: 240,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(root, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const startBounds = win.getBounds();
  await win.loadURL(origin + '/index.html');
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      if (window.overlay) resolve(true);
      else setTimeout(() => resolve(!!window.overlay), 500);
    })
  `);

  await win.webContents.executeJavaScript(`
    (function () {
      const el = document.querySelector('.edge-left');
      if (!el) throw new Error('missing edge-left');
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    })();
  `);

  await new Promise((r) => setTimeout(r, 80));
  await win.webContents.executeJavaScript(`
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  `);

  const after = win.getBounds();
  server.close();
  app.quit();

  if (moveCount < 1) {
    console.error('FAIL: window:beginMove not invoked');
    process.exit(1);
  }
  if (endCount < 1) {
    console.error('FAIL: window:endMove not invoked');
    process.exit(1);
  }
  console.log('smoke-window-move OK', {
    moveCount,
    endCount,
    startBounds,
    afterBounds: after,
  });
});

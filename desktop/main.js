// Electron shell for Seton (issue #19). The Express server from server/
// runs inside this process on an ephemeral port; the window is just a
// native browser pointed at it. No preload / IPC — the web app is unchanged.

const { app, BrowserWindow, shell } = require('electron');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  // Packaged app keeps its data in ~/Library/Application Support/Seton/data;
  // `npm run app` during development uses the repo's data/ dir (server default).
  if (app.isPackaged && !process.env.SETON_DATA_DIR) {
    process.env.SETON_DATA_DIR = path.join(app.getPath('userData'), 'data');
  }
  process.env.PORT = '0';

  let baseUrl = null;
  let win = null;

  const boundsFile = path.join(app.getPath('userData'), 'window-bounds.json');

  function loadBounds() {
    try {
      return JSON.parse(fs.readFileSync(boundsFile, 'utf8'));
    } catch {
      return {};
    }
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1280,
      height: 850,
      minWidth: 720,
      minHeight: 480,
      ...loadBounds(),
      title: 'Seton',
      backgroundColor: '#0d1017', // --bg, avoids white flash on launch
    });

    win.on('close', () => {
      try {
        fs.writeFileSync(boundsFile, JSON.stringify(win.getNormalBounds()));
      } catch {}
    });
    win.on('closed', () => { win = null; });

    // Links out of the app (markdown docs, etc.) open in the system browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(baseUrl)) {
        e.preventDefault();
        shell.openExternal(url);
      }
    });

    win.loadURL(baseUrl);
  }

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // macOS: closing the window leaves the app (and Drive sync) running;
  // clicking the dock icon brings the window back.
  app.on('activate', () => {
    if (!win && baseUrl) createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.whenReady().then(async () => {
    const serverEntry = pathToFileURL(
      path.join(__dirname, '..', 'server', 'index.js')
    ).href;
    const { server } = await import(serverEntry);
    if (!server.listening) await once(server, 'listening');
    baseUrl = `http://localhost:${server.address().port}`;
    createWindow();
  });
}

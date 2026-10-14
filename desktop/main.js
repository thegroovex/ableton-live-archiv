// Live Archiv als eigenständige App (macOS + Windows).
// Startet den Python-Server unsichtbar im Hintergrund und zeigt die Oberfläche in einem eigenen Fenster
// (Chromium: Web MIDI für den FLX4 und Wahl des Audio-Ausgangs funktionieren wie in Chrome).
const { app, BrowserWindow, session, shell, Menu, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const lib = require("./lib");

app.setName("Live Archiv");
app.setAboutPanelOptions({
  applicationName: "Live Archiv",
  applicationVersion: app.getVersion(),
  copyright: "© 2026 BeatTactics · designed by groovex",
  website: "https://github.com/thegroovex/ableton-live-archiv",
});
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const DATA_DIR = path.join(os.homedir(), "LiveArchiv");
const LOG_DIR = path.join(DATA_DIR, "logs");
const RES_DIR = app.isPackaged ? process.resourcesPath : __dirname;

let server = null, serverAlive = false, win = null, base = null, quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function logTail(file, n = 25) {
  try { return fs.readFileSync(file, "utf8").split(/\r?\n/).slice(-n).join("\n"); } catch { return ""; }
}

async function startServer() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, "server.log");
  const out = fs.openSync(logFile, "w");
  const port = await lib.pickPort();
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, LIVE_ARCHIV_PORT: String(port), PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" };
  let ff = lib.ffmpegCandidate({ platform: process.platform, resourcesDir: RES_DIR, exists: fs.existsSync });
  if (!ff && !app.isPackaged) { try { ff = require("ffmpeg-static"); } catch { /* optional */ } }
  if (ff) env.LIVE_ARCHIV_FFMPEG = ff;
  const { cmd, args } = lib.serverCommand({
    platform: process.platform, resourcesDir: RES_DIR, devRoot: path.join(__dirname, ".."),
    exists: fs.existsSync, python: process.env.LIVE_ARCHIV_PYTHON,
  });
  server = spawn(cmd, args, { env, stdio: ["ignore", out, out], windowsHide: true });
  serverAlive = true;
  server.on("exit", code => {
    serverAlive = false;
    if (!quitting) {
      dialog.showErrorBox("Live Archiv", `Der Hintergrunddienst wurde beendet (Code ${code}).\nThe background service stopped.\n\n${logTail(logFile)}`);
      app.quit();
    }
  });
  server.on("error", err => { serverAlive = false; dialog.showErrorBox("Live Archiv", String(err)); app.quit(); });
  await lib.waitForServer(base + "/", { isAlive: () => serverAlive });
}

function stopServer() {
  quitting = true;
  if (server && serverAlive) { try { server.kill(); } catch { /* schon beendet */ } }
}

function setLang(lang) {
  if (win) win.webContents.executeJavaScript(`window.setLang(${JSON.stringify(lang)})`).catch(() => {});
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "Ansicht / View",
      submenu: [
        { label: "Sprache / Language", submenu: [
          { label: "Deutsch", click: () => setLang("de") },
          { label: "English", click: () => setLang("en") },
          { label: "Automatisch / Automatic", click: () => setLang("") },
        ] },
        { type: "separator" },
        { role: "reload" }, { role: "toggleDevTools" }, { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" },
      ],
    },
    {
      label: "Extras",
      submenu: [
        { label: "Im Browser öffnen / Open in browser", click: () => base && shell.openExternal(base) },
        { label: "Datenordner zeigen / Show data folder", click: () => shell.openPath(DATA_DIR) },
        { label: "Protokoll zeigen / Show log", click: () => shell.openPath(path.join(LOG_DIR, "server.log")) },
      ],
    },
    { role: "windowMenu" },
    { role: "help", submenu: [
      { label: "Über Live Archiv / About", click: () => app.showAboutPanel() },
      { label: "Projektseite / Project page", click: () => shell.openExternal("https://github.com/thegroovex/ableton-live-archiv") },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function guardWindow(w) {
  const wc = w.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (!lib.isAppUrl(url, base)) shell.openExternal(url);
    return { action: "deny" };
  });
  // Dateien, die nicht auf einer Ablagezone landen, sollen das Fenster nicht wegnavigieren.
  wc.on("will-navigate", (e, url) => {
    if (!lib.isAppUrl(url, base)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640,
    title: "Live Archiv", backgroundColor: "#121317", icon: path.join(__dirname, "app-icon.png"), show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.once("ready-to-show", () => win.show());
  await win.loadFile(path.join(__dirname, "loading.html"));
  try {
    await startServer();
  } catch (err) {
    if (!quitting) {
      dialog.showErrorBox("Live Archiv", `Start fehlgeschlagen / Start failed: ${err.message}\n\n${logTail(path.join(LOG_DIR, "server.log"))}`);
      app.quit();
    }
    return;
  }
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(lib.allowPermission(perm, (details && details.requestingUrl) || wc.getURL(), base)));
  ses.setPermissionCheckHandler((wc, perm, origin) => lib.allowPermission(perm, origin, base));
  guardWindow(win);
  await win.loadURL(base + "/");
}

app.whenReady().then(() => { buildMenu(); createWindow(); });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", stopServer);
app.on("will-quit", stopServer);
process.on("exit", stopServer);

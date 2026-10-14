// Reine Hilfsfunktionen der Electron-Hülle (ohne Electron testbar: tests/js/desktop.test.js).
const net = require("net");
const http = require("http");
const path = require("path");

// Fester Port, damit die Oberfläche ihre lokalen Einstellungen (Sprache, Blockgrößen …) behält.
// 5077 bleibt dem Skript-Start vorbehalten, so laufen beide Wege auch gleichzeitig.
const PREFERRED_PORT = 5078;

// Rechte, die die Oberfläche braucht: Web MIDI (FLX4), Audio-Geräte und Ausgabewahl.
const ALLOWED_PERMISSIONS = ["midi", "midiSysex", "media", "speaker-selection", "clipboard-sanitized-write", "fullscreen"];

function isAppUrl(url, base) {
  try {
    const u = new URL(url), b = new URL(base);
    return u.protocol === b.protocol && u.hostname === b.hostname && u.port === b.port;
  } catch {
    return false;
  }
}

function allowPermission(permission, requestingUrl, base) {
  return ALLOWED_PERMISSIONS.includes(permission) && isAppUrl(requestingUrl, base);
}

function portFree(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function pickPort(preferred = PREFERRED_PORT) {
  if (await portFree(preferred)) return preferred;
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

function waitForServer(url, { timeoutMs = 90000, intervalMs = 300, isAlive = () => true } = {}) {
  const until = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      if (!isAlive()) return reject(new Error("server-exited"));
      const req = http.get(url, res => { res.resume(); res.statusCode < 500 ? resolve() : retry(); });
      req.on("error", retry);
      req.setTimeout(2000, () => req.destroy());
    };
    const retry = () => (Date.now() > until ? reject(new Error("timeout")) : setTimeout(tryOnce, intervalMs));
    tryOnce();
  });
}

// Welcher Server gestartet wird: gebündelte Binary in der fertigen App, sonst python app.py (Entwicklung).
function serverCommand({ platform, resourcesDir, devRoot, exists, python }) {
  const exe = platform === "win32" ? "live-archiv-server.exe" : "live-archiv-server";
  const bundled = path.join(resourcesDir, "server", exe);
  if (exists(bundled)) return { cmd: bundled, args: ["--no-browser"] };
  const py = python || (platform === "win32" ? "python" : "python3");
  return { cmd: py, args: [path.join(devRoot, "desktop", "server_entry.py"), "--no-browser"] };
}

function ffmpegCandidate({ platform, resourcesDir, exists }) {
  const p = path.join(resourcesDir, "ffmpeg", platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  return exists(p) ? p : null;
}

module.exports = { PREFERRED_PORT, ALLOWED_PERMISSIONS, isAppUrl, allowPermission, portFree, pickPort, waitForServer, serverCommand, ffmpegCandidate };

// Standalone-App: Hilfsfunktionen der Electron-Hülle (ohne Electron).
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const http = require("http");
const lib = require("../../desktop/lib.js");

const BASE = "http://127.0.0.1:5078";

test("nur die eigene Oberfläche gilt als App-Adresse", () => {
  assert.ok(lib.isAppUrl("http://127.0.0.1:5078/static/js/dj.js", BASE));
  assert.ok(!lib.isAppUrl("http://127.0.0.1:5077/", BASE));
  assert.ok(!lib.isAppUrl("https://github.com/thegroovex", BASE));
  assert.ok(!lib.isAppUrl("file:///Users/x/Musik/song.mp3", BASE));
  assert.ok(!lib.isAppUrl("kaputt", BASE));
});

test("Rechte: Web MIDI (FLX4) und Audio ja, alles andere nein", () => {
  for (const p of ["midi", "midiSysex", "media", "speaker-selection"]) assert.ok(lib.allowPermission(p, BASE + "/", BASE), p);
  assert.ok(!lib.allowPermission("geolocation", BASE + "/", BASE));
  assert.ok(!lib.allowPermission("midi", "https://example.com/", BASE));
});

test("Server-Start: gebündelte Binary, sonst python server_entry.py", () => {
  const res = path.join("R", "res");
  const mac = lib.serverCommand({ platform: "darwin", resourcesDir: res, devRoot: "D", exists: () => true });
  assert.equal(mac.cmd, path.join(res, "server", "live-archiv-server"));
  const win = lib.serverCommand({ platform: "win32", resourcesDir: res, devRoot: "D", exists: () => true });
  assert.equal(win.cmd, path.join(res, "server", "live-archiv-server.exe"));
  const dev = lib.serverCommand({ platform: "darwin", resourcesDir: res, devRoot: "D", exists: () => false });
  assert.equal(dev.cmd, "python3");
  assert.deepEqual(dev.args, [path.join("D", "desktop", "server_entry.py"), "--no-browser"]);
  assert.equal(lib.serverCommand({ platform: "win32", resourcesDir: res, devRoot: "D", exists: () => false }).cmd, "python");
});

test("ffmpeg aus dem App-Paket", () => {
  assert.equal(lib.ffmpegCandidate({ platform: "win32", resourcesDir: "R", exists: () => true }), path.join("R", "ffmpeg", "ffmpeg.exe"));
  assert.equal(lib.ffmpegCandidate({ platform: "darwin", resourcesDir: "R", exists: () => false }), null);
});

test("Port: bevorzugt fester Port, sonst ein freier", async () => {
  const blocker = http.createServer(() => {});
  await new Promise(r => blocker.listen(0, "127.0.0.1", r));
  const busy = blocker.address().port;
  const p = await lib.pickPort(busy);
  assert.notEqual(p, busy);
  assert.ok(p > 0);
  blocker.close();
});

test("Warten auf den Server: klappt, sobald er antwortet; bricht ab, wenn er stirbt", async () => {
  const srv = http.createServer((q, s) => s.end("ok"));
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  await lib.waitForServer(`http://127.0.0.1:${srv.address().port}/`, { timeoutMs: 3000 });
  srv.close();
  await assert.rejects(lib.waitForServer("http://127.0.0.1:1/", { isAlive: () => false }), /server-exited/);
});

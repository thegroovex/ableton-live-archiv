"""Live Archiv – lokale Projektverwaltung für Ableton Live 12.

Start:  python3 app.py   →  öffnet http://127.0.0.1:5077 im Browser
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
import webbrowser

from flask import Flask, jsonify, request, send_file, send_from_directory, abort

from core import db
from core.als_parser import parse_set, find_sets, set_tempo_and_key
from core.classify import status_score
from core import platform_util

renderer = platform_util.renderer()

APP_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=os.path.join(APP_DIR, "static"), static_url_path="/static")


# ---------------------------------------------------------------- Hintergrund-Jobs
class Job:
    def __init__(self):
        self.lock = threading.Lock()
        self.reset()

    def reset(self):
        self.name, self.running, self.done, self.total = "", False, 0, 0
        self.log, self.cancel = [], False

    def state(self):
        return dict(name=self.name, running=self.running, done=self.done, total=self.total, log=self.log[-60:])

    def write(self, msg):
        self.log.append(time.strftime("%H:%M:%S ") + msg)


JOB = Job()


def run_job(name, fn, *args):
    if JOB.running:
        return False
    JOB.reset()
    JOB.name, JOB.running = name, True

    def runner():
        try:
            fn(*args)
        except Exception as exc:
            JOB.write(f"Fehler: {exc}")
            traceback.print_exc()
        finally:
            JOB.running = False
    threading.Thread(target=runner, daemon=True).start()
    return True


def index_set(path: str) -> int:
    info = parse_set(path).to_dict()
    st = os.stat(path)
    status, score, why = status_score(info)
    values = dict(info)
    values.update(
        folder=os.path.basename(os.path.dirname(path)), mtime=st.st_mtime, size=st.st_size,
        status=status, status_score=score, status_reasons=why, missing=0,
        key_source="set" if info.get("key_root") else None,
    )
    if not values.get("key_root"):
        values.pop("key_root", None); values.pop("key_mode", None); values.pop("key_source", None)
        old = db.db().execute("SELECT id, key_source FROM projects WHERE path=?", (path,)).fetchone()
        if old and old["key_source"] == "set":  # alte Standard-Tonart (C-Dur) aus früheren Scans entfernen
            values.update(key_root=None, key_mode=None, key_source=None)
    from core.analyzer import guess_genre
    pid = db.upsert(values)
    p = db.get(pid)
    if not p.get("genre"):
        db.update(pid, {"genre": guess_genre(p.get("tempo"), p.get("energy"))})
    return pid


def job_scan(roots):
    from core.als_parser import clean_path
    for r in roots:
        if not os.path.isdir(clean_path(r)):
            JOB.write(f"Ordner nicht gefunden: {clean_path(r)}")
    hidden = db.hidden_paths()
    paths = [p for p in find_sets(roots) if p not in hidden]
    JOB.total = len(paths)
    JOB.write(f"{len(paths)} Live-Sets gefunden.")
    known = {r["path"] for r in db.db().execute("SELECT path FROM projects")}
    if not paths:
        JOB.write("Keine .als-Dateien gefunden. Stimmt der Pfad unter ⚙?")
    new = 0
    matched = []
    from core.matcher import find_existing_audio
    for p in paths:
        if JOB.cancel:
            break
        try:
            new += p not in known
            pid = index_set(p)
            row = db.get(pid)
            if not row.get("mp3_path") or not os.path.exists(row["mp3_path"]):
                audio = find_existing_audio(p)
                if audio:
                    db.update(pid, {"mp3_path": audio, "error": None})
                    matched.append(pid)
            JOB.write(f"Gelesen: {os.path.basename(p)}")
        except Exception as exc:
            JOB.write(f"{os.path.basename(p)}: {exc}")
        JOB.done += 1
    gone = known - set(paths)
    for g in gone:  # nur als fehlend markieren, nie löschen
        if not os.path.exists(g):
            db.db().execute("UPDATE projects SET missing=1 WHERE path=?", (g,))
    db.db().commit()
    if matched:
        JOB.write(f"{len(matched)} vorhandene Exporte zugeordnet, analysiere …")
        JOB.done, JOB.total = 0, len(matched)
        for pid in matched:
            if JOB.cancel:
                break
            try:
                _analyze(pid)
            except Exception as exc:
                JOB.write(f"#{pid}: {exc}")
            JOB.done += 1
    JOB.write(f"Scan abgeschlossen: {len(paths)} Sets, davon {new} neu, {len(matched)} vorhandene MP3s zugeordnet.")


def _safe_name(pid, name):
    """Nur ASCII im Exportnamen: AppleScript tippt ihn per Tastatur, Umlaute gehen dabei verloren."""
    import unicodedata
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("Ä", "Ae"), ("Ö", "Oe"), ("Ü", "Ue"), ("ß", "ss")):
        name = unicodedata.normalize("NFC", name).replace(a, b)
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return f"{pid:05d}_" + re.sub(r"[^A-Za-z0-9\- ]+", "", name)[:60].strip()


def job_render(ids, analyze_after=True):
    """Rendert nacheinander in Live. Die Analyse läuft parallel im Hintergrund,
    damit Live schon das nächste Set öffnen kann."""
    import queue
    s = db.load_settings()
    JOB.total = len(ids)
    todo: "queue.Queue[int | None]" = queue.Queue()

    def analyst():
        while True:
            pid = todo.get()
            if pid is None:
                break
            try:
                _analyze(pid)
            except Exception as exc:
                JOB.write(f"Analyse fehlgeschlagen: {exc}")

    worker = threading.Thread(target=analyst, daemon=True)
    if analyze_after:
        worker.start()
    for pid in ids:
        if JOB.cancel:
            JOB.write("Abgebrochen."); break
        p = db.get(pid)
        if not p:
            continue
        try:
            mp3 = renderer.render_set(p["path"], db.RENDER_DIR, _safe_name(pid, p["name"]),
                                      app_name=s["live_app"], log=JOB.write)
            db.update(pid, {"mp3_path": mp3, "rendered_at": time.time(), "error": None})
            if analyze_after:
                todo.put(pid)
        except Exception as exc:
            db.update(pid, {"error": str(exc)})
            JOB.write(f"{p['name']}: {exc}")
        JOB.done += 1
    if analyze_after:
        todo.put(None)
        JOB.write("Warte auf letzte Analysen …")
        worker.join()
    JOB.write("Rendern abgeschlossen.")


def _analyze(pid):
    from core.analyzer import analyze_audio, guess_genre
    p = db.get(pid)
    if not p or not p.get("mp3_path") or not os.path.exists(p["mp3_path"]):
        return
    JOB.write(f"Analysiere {p['name']} …")
    a = analyze_audio(p["mp3_path"])
    try:
        from core import peaks
        peaks.cached(p["mp3_path"], db.PEAKS_DIR, f"p{pid}")
    except Exception:
        pass
    if a.get("error"):
        JOB.write(a["error"]); return
    vals = {"energy": a["energy"], "brightness": a["brightness"], "mood": a["mood"], "analyzed_at": time.time(),
            "genre": guess_genre(p.get("tempo") or a["tempo_audio"], a["energy"], a["onset_rate"])}
    if p.get("key_source") != "set":
        vals.update(key_root=a["key_root"], key_mode=a["key_mode"], key_source="audio")
    if not p.get("tempo"):
        vals["tempo"] = a["tempo_audio"]
    db.update(pid, vals)


def job_analyze(ids):
    JOB.total = len(ids)
    for pid in ids:
        if JOB.cancel:
            break
        try:
            _analyze(pid)
        except Exception as exc:
            JOB.write(f"#{pid}: {exc}")
        JOB.done += 1
    JOB.write("Analyse abgeschlossen.")


# ---------------------------------------------------------------- Routen
@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/projects")
def api_projects():
    return jsonify(db.query(request.args.to_dict()))


@app.get("/api/projects/<int:pid>")
def api_project(pid):
    p = db.get(pid)
    return jsonify(p) if p else abort(404)


@app.get("/api/peaks/<int:pid>")
def api_peaks(pid):
    """Mini-Waveform für die Listenansicht (wird zwischengespeichert)."""
    from core import peaks
    p = db.get(pid)
    if not p or not p.get("mp3_path") or not os.path.exists(p["mp3_path"]):
        return jsonify(error="kein Audio"), 404
    try:
        data = peaks.cached(p["mp3_path"], db.PEAKS_DIR, f"p{pid}")
    except Exception as exc:
        return jsonify(error=str(exc)), 500
    return jsonify({k: data[k] for k in ("amp", "low", "mid", "high", "duration")})


@app.get("/api/peaks/import/<int:iid>")
def api_peaks_import(iid):
    """Mini-Waveform für importierte Tracks im DJ-Tab."""
    from core import peaks
    t = db.get_import(iid)
    if not t or not t.get("path") or not os.path.exists(t["path"]):
        return jsonify(error="kein Audio"), 404
    try:
        data = peaks.cached(t["path"], db.PEAKS_DIR, f"i{iid}")
    except Exception as exc:
        return jsonify(error=str(exc)), 500
    return jsonify({k: data[k] for k in ("amp", "low", "mid", "high", "duration")})


@app.delete("/api/projects/<int:pid>")
def api_remove(pid):
    if JOB.running:
        return jsonify(error="Bitte warten, bis der laufende Vorgang fertig ist."), 409
    return jsonify(ok=db.remove_project(pid))


@app.post("/api/hidden/clear")
def api_unhide():
    return jsonify(restored=db.unhide_all())


@app.patch("/api/projects/<int:pid>")
def api_edit(pid):
    data = {k: v for k, v in (request.json or {}).items() if k in db.EDITABLE}
    db.update(pid, data, lock_fields=True)
    return jsonify(db.get(pid))


@app.get("/api/facets")
def api_facets():
    return jsonify(db.facets())


@app.get("/api/job")
def api_job():
    return jsonify(JOB.state())


@app.post("/api/job/cancel")
def api_cancel():
    JOB.cancel = True
    return jsonify(ok=True)


@app.post("/api/scan")
def api_scan():
    roots = (request.json or {}).get("roots") or db.load_settings()["roots"]
    return jsonify(started=run_job("Scan", job_scan, roots))


@app.post("/api/render")
def api_render():
    body = request.json or {}
    if renderer.live_is_running():
        return jsonify(started=False, error="Ableton Live ist noch offen. Bitte deine Sets speichern und Live beenden. "
                                            "Live Archiv öffnet Live dann selbst und verwirft beim Wechsel nur Sets, die es selbst geöffnet hat."), 409
    ids = body.get("ids")
    if body.get("missing"):
        ids = [r["id"] for r in db.db().execute("SELECT id FROM projects WHERE missing=0 AND mp3_path IS NULL ORDER BY mtime DESC")]
    return jsonify(started=run_job("Rendern", job_render, ids or []), count=len(ids or []))


@app.post("/api/analyze")
def api_analyze():
    ids = (request.json or {}).get("ids")
    if not ids:
        ids = [r["id"] for r in db.db().execute("SELECT id FROM projects WHERE mp3_path IS NOT NULL")]
    return jsonify(started=run_job("Analyse", job_analyze, ids))


@app.get("/audio/<int:pid>")
def api_audio(pid):
    p = db.get(pid)
    if not p or not p.get("mp3_path") or not os.path.exists(p["mp3_path"]):
        abort(404)
    return send_file(p["mp3_path"], mimetype="audio/mpeg", conditional=True)


@app.post("/api/open/<int:pid>")
def api_open(pid):
    p = db.get(pid) or abort(404)
    renderer.open_in_live(p["path"], db.load_settings()["live_app"])
    return jsonify(ok=True)


@app.post("/api/reveal/<int:pid>")
def api_reveal(pid):
    p = db.get(pid) or abort(404)
    platform_util.reveal(p["path"])
    return jsonify(ok=True)


@app.get("/api/settings")
def api_settings():
    return jsonify(db.load_settings())


@app.post("/api/settings")
def api_settings_save():
    return jsonify(db.save_settings(request.json or {}))


@app.post("/api/create")
def api_create():
    """Neues Projekt aus Vorlage: Ordner anlegen, Tempo/Tonart setzen, Metadaten speichern, in Live öffnen."""
    b = request.json or {}
    s = db.load_settings()
    name = re.sub(platform_util.INVALID_NAME_CHARS, "-", (b.get("name") or "").strip())
    if not name:
        return jsonify(error="Bitte einen Namen angeben."), 400
    template = os.path.expanduser(s.get("template") or "")
    if not template or not os.path.exists(template):
        return jsonify(error="Bitte in den Einstellungen eine Vorlage (.als) auswählen."), 400
    base = os.path.expanduser(b.get("folder") or s["new_project_dir"])
    proj_dir = os.path.join(base, f"{name} Project")
    if os.path.exists(proj_dir):
        return jsonify(error="Ein Projekt mit diesem Namen existiert schon."), 400
    dst = os.path.join(proj_dir, f"{name}.als")
    tempo = float(b["tempo"]) if b.get("tempo") else None
    set_tempo_and_key(template, dst, tempo, b.get("key_root") or None, b.get("key_mode") or None)
    pid = index_set(dst)
    meta = {k: b[k] for k in ("genre", "mood", "tags", "notes", "key_root", "key_mode") if b.get(k)}
    meta["status"] = "Skizze"
    db.update(pid, meta, lock_fields=True)
    db.db().execute("UPDATE projects SET created_here=1 WHERE id=?", (pid,)); db.db().commit()
    if b.get("open", True):
        renderer.open_in_live(dst, s["live_app"])
    return jsonify(db.get(pid))


# ---------------------------------------------------------------- DJ-Modus
AUDIO_EXT = (".mp3", ".wav", ".aif", ".aiff", ".flac", ".m4a", ".ogg")
LIBRARY_DIR = os.path.join(db.HOME, "library")


def _read_tags(path):
    title = os.path.splitext(os.path.basename(path))[0]
    artist = ""
    if " - " in title:
        artist, title = title.split(" - ", 1)
    try:
        from mutagen import File as MFile
        m = MFile(path, easy=True)
        if m is not None and m.tags:
            title = (m.tags.get("title") or [title])[0]
            artist = (m.tags.get("artist") or [artist])[0]
    except Exception:
        pass
    return title.strip(), artist.strip()


def add_audio_file(path):
    title, artist = _read_tags(path)
    return db.add_import(dict(path=path, title=title, artist=artist, added=time.time()))


def analyze_import(iid):
    from core.analyzer import analyze_audio, guess_genre
    t = db.get_import(iid)
    if not t:
        return
    a = analyze_audio(t["path"])
    if a.get("error"):
        JOB.write(a["error"]); return
    db.update_import(iid, dict(bpm=a["tempo_audio"], key_root=a["key_root"], key_mode=a["key_mode"],
                               duration=a["duration"], energy=a["energy"],  # Beatgrid erkennt der DJ-Tab genauer selbst
                               genre=guess_genre(a["tempo_audio"], a["energy"], a["onset_rate"]),
                               analyzed_at=time.time()))


def job_import(paths):
    files = []
    for p in paths:
        p = os.path.expanduser(p)
        if os.path.isdir(p):
            for dp, _, fs in os.walk(p):
                files += [os.path.join(dp, f) for f in fs if f.lower().endswith(AUDIO_EXT) and not f.startswith(".")]
        elif p.lower().endswith(AUDIO_EXT):
            files.append(p)
    JOB.total = len(files)
    JOB.write(f"{len(files)} Audiodateien gefunden.")
    for f in sorted(files):
        if JOB.cancel:
            break
        try:
            iid = add_audio_file(f)
            if not db.get_import(iid).get("analyzed_at"):
                analyze_import(iid)
        except Exception as exc:
            JOB.write(f"{os.path.basename(f)}: {exc}")
        JOB.done += 1
    JOB.write("Import abgeschlossen.")


@app.get("/api/dj/library")
def api_dj_library():
    return jsonify(db.dj_library())


@app.get("/api/dj/playlists")
def api_playlists():
    return jsonify(db.playlists())


@app.post("/api/dj/playlists")
def api_playlist_create():
    b = request.json or {}
    pid = db.playlist_create(str(b.get("name") or "Neue Playlist"))
    if b.get("uids"):
        db.playlist_add(pid, list(b["uids"]))
    return jsonify(next(p for p in db.playlists() if p["id"] == pid))


@app.put("/api/dj/playlists/order")
def api_playlist_order():
    db.playlist_reorder((request.json or {}).get("ids") or [])
    return jsonify(db.playlists())


@app.patch("/api/dj/playlists/<int:pid>")
def api_playlist_rename(pid):
    if not db.playlist_exists(pid):
        abort(404)
    db.playlist_rename(pid, str((request.json or {}).get("name") or ""))
    return jsonify(ok=True)


@app.delete("/api/dj/playlists/<int:pid>")
def api_playlist_delete(pid):
    db.playlist_delete(pid)
    return jsonify(ok=True)


@app.post("/api/dj/playlists/<int:pid>/tracks")
def api_playlist_add(pid):
    if not db.playlist_exists(pid):
        abort(404)
    b = request.json or {}
    idx = b.get("index")
    return jsonify(items=db.playlist_add(pid, list(b.get("uids") or []), int(idx) if isinstance(idx, int) else None))


@app.put("/api/dj/playlists/<int:pid>/tracks")
def api_playlist_set(pid):
    if not db.playlist_exists(pid):
        abort(404)
    return jsonify(items=db.playlist_set(pid, list((request.json or {}).get("uids") or [])))


@app.post("/api/dj/import")
def api_dj_import():
    paths = (request.json or {}).get("paths") or []
    return jsonify(started=run_job("Import", job_import, paths))


@app.post("/api/dj/upload")
def api_dj_upload():
    os.makedirs(LIBRARY_DIR, exist_ok=True)
    saved = []
    for f in request.files.getlist("files"):
        name = os.path.basename(f.filename or "")
        if not name.lower().endswith(AUDIO_EXT):
            continue
        dst = os.path.join(LIBRARY_DIR, name)
        f.save(dst)
        saved.append(dst)
    run_job("Import", job_import, saved)
    return jsonify(saved=len(saved))


@app.get("/audio/import/<int:iid>")
def api_audio_import(iid):
    t = db.get_import(iid)
    if not t or not os.path.exists(t["path"]):
        abort(404)
    import mimetypes
    return send_file(t["path"], mimetype=mimetypes.guess_type(t["path"])[0] or "audio/mpeg", conditional=True)


@app.get("/api/dj/cues/<kind>/<int:iid>")
def api_cues_get(kind, iid):
    if kind not in ("p", "i"):
        abort(400)
    return jsonify(db.get_cues(kind, iid))


@app.put("/api/dj/cues/<kind>/<int:iid>")
def api_cues_put(kind, iid):
    if kind not in ("p", "i"):
        abort(400)
    cues = request.json if isinstance(request.json, list) else []
    cues = [c if isinstance(c, (int, float)) else None for c in cues][:8]
    db.set_cues(kind, iid, cues)
    return jsonify(cues)


@app.patch("/api/dj/grid/<kind>/<int:iid>")
def api_grid(kind, iid):
    b = request.json or {}
    if kind == "p":
        vals = {}
        if "bpm" in b: vals["tempo"] = float(b["bpm"])
        if "grid_offset" in b: vals["grid_offset"] = float(b["grid_offset"])
        db.update(iid, vals, lock_fields=True)
    elif kind == "i":
        vals = {}
        if "bpm" in b: vals["bpm"] = float(b["bpm"])
        if "grid_offset" in b: vals["grid_offset"] = float(b["grid_offset"])
        if vals: db.update_import(iid, vals)
    else:
        abort(400)
    return jsonify(ok=True)


def open_browser(url):
    platform_util.open_browser(url)


def main():
    port = int(os.environ.get("LIVE_ARCHIV_PORT", "5077"))
    url = f"http://127.0.0.1:{port}"
    if "--no-browser" not in sys.argv:
        threading.Timer(1.2, lambda: open_browser(url)).start()
    print(f"Live Archiv läuft auf {url}  (Beenden mit Ctrl+C)")
    import logging
    logging.getLogger("werkzeug").setLevel(logging.WARNING)  # keine GET-Zeilen im Terminal
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()

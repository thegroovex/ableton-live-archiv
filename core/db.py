"""SQLite-Speicher für das Projektarchiv."""
from __future__ import annotations

import json
import os
import sqlite3
import threading

HOME = os.path.expanduser(os.environ.get("LIVE_ARCHIV_HOME", "~/LiveArchiv"))
DB_PATH = os.path.join(HOME, "archiv.db")
RENDER_DIR = os.path.join(HOME, "renders")
PEAKS_DIR = os.path.join(HOME, "peaks")
SETTINGS_PATH = os.path.join(HOME, "settings.json")

from core.platform_util import default_settings as _defaults

DEFAULT_SETTINGS = {**_defaults(), "lang": ""}

COLUMNS = {
    "path": "TEXT UNIQUE", "name": "TEXT", "folder": "TEXT", "mtime": "REAL", "size": "INTEGER",
    "live_version": "TEXT", "tempo": "REAL", "time_sig": "TEXT", "key_root": "TEXT", "key_mode": "TEXT",
    "key_source": "TEXT", "tracks_audio": "INTEGER", "tracks_midi": "INTEGER", "tracks_group": "INTEGER",
    "tracks_return": "INTEGER", "clips_arrangement": "INTEGER", "clips_session": "INTEGER",
    "length_sec": "REAL", "automation_count": "INTEGER", "plugins": "TEXT", "samples_total": "INTEGER",
    "samples_missing": "INTEGER", "status": "TEXT", "status_score": "INTEGER", "status_reasons": "TEXT",
    "genre": "TEXT", "mood": "TEXT", "energy": "REAL", "brightness": "REAL", "tags": "TEXT", "notes": "TEXT",
    "rating": "INTEGER", "color": "TEXT", "mp3_path": "TEXT", "rendered_at": "REAL", "analyzed_at": "REAL",
    "locked": "TEXT", "error": "TEXT", "cues": "TEXT", "grid_offset": "REAL", "missing": "INTEGER DEFAULT 0", "created_here": "INTEGER DEFAULT 0",
}

EDITABLE = {"name", "tempo", "key_root", "key_mode", "status", "genre", "mood", "tags", "notes", "rating", "color"}

_lock = threading.Lock()


def connect() -> sqlite3.Connection:
    os.makedirs(HOME, exist_ok=True)
    os.makedirs(RENDER_DIR, exist_ok=True)
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    cols = ", ".join(f"{k} {v}" for k, v in COLUMNS.items())
    con.execute(f"CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, {cols})")
    existing = {r[1] for r in con.execute("PRAGMA table_info(projects)")}
    for k, v in COLUMNS.items():  # spätere Schema-Erweiterungen
        if k not in existing:
            con.execute(f"ALTER TABLE projects ADD COLUMN {k} {v.replace(' UNIQUE', '')}")
    con.execute("""CREATE TABLE IF NOT EXISTS imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE, title TEXT, artist TEXT, bpm REAL,
        key_root TEXT, key_mode TEXT, duration REAL, grid_offset REAL, energy REAL, genre TEXT,
        cues TEXT, added REAL, analyzed_at REAL)""")
    con.execute("CREATE TABLE IF NOT EXISTS hidden (path TEXT UNIQUE)")
    # DJ-Playlists (Crates wie in Serato); Tracks über ihre uid ("p12" = Live-Projekt, "i3" = Import)
    con.execute("CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, pos INTEGER, created REAL)")
    con.execute("""CREATE TABLE IF NOT EXISTS playlist_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, playlist_id INTEGER, uid TEXT, pos INTEGER)""")
    con.commit()
    return con


CON = None


def db() -> sqlite3.Connection:
    global CON
    if CON is None:
        CON = connect()
    return CON


def row_to_dict(r: sqlite3.Row) -> dict:
    d = dict(r)
    for k in ("plugins", "status_reasons", "locked", "tags"):
        try:
            d[k] = json.loads(d[k]) if d.get(k) else []
        except (TypeError, ValueError):
            d[k] = []
    return d


def upsert(values: dict) -> int:
    """Fügt ein Set ein oder aktualisiert es. Vom Nutzer gesperrte Felder bleiben unangetastet."""
    with _lock:
        con = db()
        cur = con.execute("SELECT id, locked FROM projects WHERE path=?", (values["path"],))
        row = cur.fetchone()
        vals = {k: (json.dumps(v) if isinstance(v, (list, dict)) else v) for k, v in values.items() if k in COLUMNS}
        if row:
            locked = set(json.loads(row["locked"] or "[]"))
            vals = {k: v for k, v in vals.items() if k not in locked}
            if vals:
                sets = ", ".join(f"{k}=?" for k in vals)
                con.execute(f"UPDATE projects SET {sets} WHERE id=?", (*vals.values(), row["id"]))
            con.commit()
            return row["id"]
        keys = ", ".join(vals)
        qs = ", ".join("?" for _ in vals)
        cur = con.execute(f"INSERT INTO projects ({keys}) VALUES ({qs})", tuple(vals.values()))
        con.commit()
        return cur.lastrowid


def update(pid: int, values: dict, lock_fields: bool = False) -> None:
    with _lock:
        con = db()
        row = con.execute("SELECT locked FROM projects WHERE id=?", (pid,)).fetchone()
        if not row:
            return
        locked = set(json.loads(row["locked"] or "[]"))
        if lock_fields:
            locked |= set(values) & EDITABLE
        else:
            values = {k: v for k, v in values.items() if k not in locked}
        values = {k: (json.dumps(v) if isinstance(v, (list, dict)) else v) for k, v in values.items() if k in COLUMNS}
        values["locked"] = json.dumps(sorted(locked))
        sets = ", ".join(f"{k}=?" for k in values)
        con.execute(f"UPDATE projects SET {sets} WHERE id=?", (*values.values(), pid))
        con.commit()


def get(pid: int) -> dict | None:
    r = db().execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    return row_to_dict(r) if r else None


def query(f: dict) -> list[dict]:
    sql, args = ["SELECT * FROM projects WHERE missing=0"], []
    if f.get("q"):
        like = f"%{f['q']}%"
        sql.append("AND (name LIKE ? OR folder LIKE ? OR tags LIKE ? OR notes LIKE ? OR plugins LIKE ? OR genre LIKE ? OR mood LIKE ?)")
        args += [like] * 7
    if f.get("tempo_min"):
        sql.append("AND tempo >= ?"); args.append(float(f["tempo_min"]))
    if f.get("tempo_max"):
        sql.append("AND tempo <= ?"); args.append(float(f["tempo_max"]))
    for key in ("key_root", "key_mode", "genre", "mood", "status"):
        if f.get(key):
            sql.append(f"AND {key} = ?"); args.append(f[key])
    if f.get("mp3") == "yes":
        sql.append("AND mp3_path IS NOT NULL")
    elif f.get("mp3") == "no":
        sql.append("AND mp3_path IS NULL")
    if f.get("rating"):
        sql.append("AND rating >= ?"); args.append(int(f["rating"]))
    order = {"name": "name COLLATE NOCASE", "tempo": "tempo", "key": "key_root, key_mode", "mtime": "mtime DESC",
             "rating": "rating DESC", "length": "length_sec DESC", "status": "status"}.get(f.get("sort"), "mtime DESC")
    sql.append(f"ORDER BY {order}")
    return [row_to_dict(r) for r in db().execute(" ".join(sql), args)]


def facets() -> dict:
    con = db()
    out = {}
    for col in ("genre", "mood", "status", "key_root"):
        out[col] = [dict(value=r[0], count=r[1]) for r in con.execute(
            f"SELECT {col}, COUNT(*) FROM projects WHERE missing=0 AND {col} IS NOT NULL AND {col} != '' GROUP BY {col} ORDER BY COUNT(*) DESC")]
    out["total"] = con.execute("SELECT COUNT(*) FROM projects WHERE missing=0").fetchone()[0]
    out["imports"] = con.execute("SELECT COUNT(*) FROM imports").fetchone()[0]
    out["with_mp3"] = con.execute("SELECT COUNT(*) FROM projects WHERE missing=0 AND mp3_path IS NOT NULL").fetchone()[0]
    return out


def load_settings() -> dict:
    s = dict(DEFAULT_SETTINGS)
    if os.path.exists(SETTINGS_PATH):
        with open(SETTINGS_PATH, encoding="utf-8") as fh:
            s.update(json.load(fh))
    return s


def save_settings(s: dict) -> dict:
    cur = load_settings()
    cur.update({k: v for k, v in s.items() if k in DEFAULT_SETTINGS})
    from core.als_parser import clean_path
    if isinstance(cur.get("roots"), list):
        cur["roots"] = [clean_path(r) for r in cur["roots"] if r.strip()]
    for k in ("template", "new_project_dir"):
        if isinstance(cur.get(k), str) and cur[k].strip():
            cur[k] = clean_path(cur[k])
    os.makedirs(HOME, exist_ok=True)
    with open(SETTINGS_PATH, "w", encoding="utf-8") as fh:
        json.dump(cur, fh, indent=2, ensure_ascii=False)
    return cur


# ---------------------------------------------------------------- DJ-Bibliothek
def dj_library() -> list[dict]:
    """Gerenderte Live-Projekte + importierte Tracks als eine Liste."""
    con = db()
    out = []
    for r in con.execute("SELECT * FROM projects WHERE missing=0 AND mp3_path IS NOT NULL ORDER BY mtime DESC"):
        d = row_to_dict(r)
        out.append(dict(uid=f"p{d['id']}", kind="p", id=d["id"], title=d["name"], artist="Live-Projekt",
                        bpm=d.get("tempo"), key_root=d.get("key_root"), key_mode=d.get("key_mode"),
                        genre=d.get("genre"), mood=d.get("mood"), status=d.get("status"),
                        duration=d.get("length_sec"), grid_offset=d.get("grid_offset"),
                        url=f"/audio/{d['id']}", source="Live"))
    for r in con.execute("SELECT * FROM imports ORDER BY added DESC"):
        d = dict(r)
        out.append(dict(uid=f"i{d['id']}", kind="i", id=d["id"], title=d["title"], artist=d.get("artist") or "",
                        bpm=d.get("bpm"), key_root=d.get("key_root"), key_mode=d.get("key_mode"),
                        genre=d.get("genre"), mood=None, status=None, duration=d.get("duration"),
                        grid_offset=d.get("grid_offset"), url=f"/audio/import/{d['id']}", source="Import"))
    return out


def add_import(values: dict) -> int:
    with _lock:
        con = db()
        row = con.execute("SELECT id FROM imports WHERE path=?", (values["path"],)).fetchone()
        if row:
            return row["id"]
        keys = ", ".join(values)
        cur = con.execute(f"INSERT INTO imports ({keys}) VALUES ({', '.join('?' for _ in values)})", tuple(values.values()))
        con.commit()
        return cur.lastrowid


def update_import(iid: int, values: dict) -> None:
    with _lock:
        con = db()
        sets = ", ".join(f"{k}=?" for k in values)
        con.execute(f"UPDATE imports SET {sets} WHERE id=?", (*values.values(), iid))
        con.commit()


def get_import(iid: int) -> dict | None:
    r = db().execute("SELECT * FROM imports WHERE id=?", (iid,)).fetchone()
    return dict(r) if r else None


def get_cues(kind: str, iid: int) -> list:
    table = "projects" if kind == "p" else "imports"
    r = db().execute(f"SELECT cues FROM {table} WHERE id=?", (iid,)).fetchone()
    try:
        return json.loads(r["cues"]) if r and r["cues"] else []
    except ValueError:
        return []


def set_cues(kind: str, iid: int, cues: list) -> None:
    table = "projects" if kind == "p" else "imports"
    with _lock:
        db().execute(f"UPDATE {table} SET cues=? WHERE id=?", (json.dumps(cues), iid))
        db().commit()


def remove_project(pid: int) -> bool:
    """Nimmt ein Projekt aus der Liste und merkt es sich, damit ein neuer Scan es nicht zurückholt.
    Die .als-Datei bleibt unangetastet; nur eine von Live Archiv gerenderte MP3 wird gelöscht."""
    with _lock:
        con = db()
        row = con.execute("SELECT path, mp3_path FROM projects WHERE id=?", (pid,)).fetchone()
        if not row:
            return False
        mp3 = row["mp3_path"]
        if mp3 and os.path.abspath(mp3).startswith(os.path.abspath(RENDER_DIR)) and os.path.exists(mp3):
            os.remove(mp3)
        con.execute("INSERT OR IGNORE INTO hidden (path) VALUES (?)", (row["path"],))
        con.execute("DELETE FROM projects WHERE id=?", (pid,))
        con.commit()
        return True


def hidden_paths() -> set:
    return {r["path"] for r in db().execute("SELECT path FROM hidden")}


def unhide_all() -> int:
    with _lock:
        n = db().execute("DELETE FROM hidden").rowcount
        db().commit()
        return n


# ---------------------------------------------------------------- DJ-Playlists
def _valid_uid(u) -> bool:
    return isinstance(u, str) and len(u) > 1 and u[0] in "pi" and u[1:].isdigit()


def playlists() -> list[dict]:
    con = db()
    out = []
    for r in con.execute("SELECT * FROM playlists ORDER BY pos, id"):
        items = [x["uid"] for x in con.execute("SELECT uid FROM playlist_items WHERE playlist_id=? ORDER BY pos, id", (r["id"],))]
        out.append(dict(id=r["id"], name=r["name"], items=items, count=len(items)))
    return out


def playlist_create(name: str) -> int:
    import time
    with _lock:
        con = db()
        pos = (con.execute("SELECT COALESCE(MAX(pos), -1) FROM playlists").fetchone()[0]) + 1
        cur = con.execute("INSERT INTO playlists (name, pos, created) VALUES (?,?,?)", (name.strip() or "Neue Playlist", pos, time.time()))
        con.commit()
        return cur.lastrowid


def playlist_rename(pid: int, name: str) -> None:
    with _lock:
        db().execute("UPDATE playlists SET name=? WHERE id=?", (name.strip() or "Playlist", pid)); db().commit()


def playlist_delete(pid: int) -> None:
    with _lock:
        con = db()
        con.execute("DELETE FROM playlist_items WHERE playlist_id=?", (pid,))
        con.execute("DELETE FROM playlists WHERE id=?", (pid,))
        con.commit()


def playlist_exists(pid: int) -> bool:
    return db().execute("SELECT 1 FROM playlists WHERE id=?", (pid,)).fetchone() is not None


def playlist_set(pid: int, uids: list) -> list[str]:
    """Reihenfolge komplett setzen (Sortieren/Entfernen). Doppelte Einträge werden entfernt."""
    seen, clean = set(), []
    for u in uids:
        if _valid_uid(u) and u not in seen:
            seen.add(u); clean.append(u)
    with _lock:
        con = db()
        con.execute("DELETE FROM playlist_items WHERE playlist_id=?", (pid,))
        con.executemany("INSERT INTO playlist_items (playlist_id, uid, pos) VALUES (?,?,?)", [(pid, u, i) for i, u in enumerate(clean)])
        con.commit()
    return clean


def playlist_add(pid: int, uids: list, index: int | None = None) -> list[str]:
    """Tracks anhängen (oder an index einfügen); schon enthaltene Tracks werden nicht doppelt aufgenommen."""
    cur = next((p["items"] for p in playlists() if p["id"] == pid), [])
    new = [u for u in uids if _valid_uid(u) and u not in cur]
    if index is None or index < 0 or index > len(cur):
        index = len(cur)
    return playlist_set(pid, cur[:index] + new + cur[index:])


def playlist_reorder(ids: list) -> None:
    with _lock:
        con = db()
        con.executemany("UPDATE playlists SET pos=? WHERE id=?", [(i, int(x)) for i, x in enumerate(ids)])
        con.commit()

import io
import json
import os
import time

from tests.conftest import write_tone


def wait_job(client, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = client.get("/api/job").get_json()
        if not j["running"]:
            return j
        time.sleep(0.1)
    raise AssertionError("Job hängt")


def test_scan_filter_edit_flow(home, tmp_path, make_set):
    import app as appmod
    lib = tmp_path / "music"
    make_set(str(lib / "Nachtfahrt Project" / "Nachtfahrt.als"), tempo=124, root=9, scale="Minor", arr_clips=30)
    make_set(str(lib / "idea 7 Project" / "idea 7.als"), tempo=174, root=0, scale="Major", arr_clips=1, midi=2, audio=0, automations=0)
    make_set(str(lib / "Dub Project" / "Dub.als"), tempo=140, in_key=False, arr_clips=20)
    c = appmod.app.test_client()
    c.post("/api/settings", json={"roots": [str(lib)]})
    assert c.post("/api/scan", json={}).get_json()["started"]
    j = wait_job(c)
    assert "3 Live-Sets" in j["log"][0]

    all_ = c.get("/api/projects").get_json()
    assert {p["name"] for p in all_} == {"Nachtfahrt", "idea 7", "Dub"}
    by = {p["name"]: p for p in all_}
    assert by["Nachtfahrt"]["status"] == "Fertig" and by["idea 7"]["status"] == "Skizze"
    assert by["Nachtfahrt"]["genre"] == "House" or by["Nachtfahrt"]["genre"] == "Deep House"

    # Suchmaske
    assert [p["name"] for p in c.get("/api/projects?tempo_min=120&tempo_max=130").get_json()] == ["Nachtfahrt"]
    assert [p["name"] for p in c.get("/api/projects?key_root=A&key_mode=Moll").get_json()] == ["Nachtfahrt"]
    assert [p["name"] for p in c.get("/api/projects?status=Skizze").get_json()] == ["idea 7"]
    assert [p["name"] for p in c.get("/api/projects?q=serum&sort=name").get_json()] == ["Dub", "idea 7", "Nachtfahrt"]

    # Bearbeiten sperrt Felder gegen Überschreiben beim nächsten Scan
    pid = by["idea 7"]["id"]
    r = c.patch(f"/api/projects/{pid}", json={"status": "Fertig", "genre": "Liquid DnB", "tags": ["vocal", "summer"], "rating": 4, "path": "/hack"})
    p = r.get_json()
    assert p["status"] == "Fertig" and p["tags"] == ["vocal", "summer"] and p["path"].endswith("idea 7.als")
    c.post("/api/scan", json={}); wait_job(c)
    p = c.get(f"/api/projects/{pid}").get_json()
    assert p["status"] == "Fertig" and p["genre"] == "Liquid DnB"
    assert [x["name"] for x in c.get("/api/projects?q=summer").get_json()] == ["idea 7"]
    assert c.get("/api/projects?rating=4").get_json()[0]["id"] == pid

    f = c.get("/api/facets").get_json()
    assert f["total"] == 3 and f["with_mp3"] == 0


def test_deleted_set_marked_missing(home, tmp_path, make_set):
    import app as appmod
    lib = tmp_path / "m"
    p = make_set(str(lib / "X Project" / "X.als"))
    c = appmod.app.test_client()
    c.post("/api/scan", json={"roots": [str(lib)]}); wait_job(c)
    os.remove(p)
    c.post("/api/scan", json={"roots": [str(lib)]}); wait_job(c)
    assert c.get("/api/projects").get_json() == []


def test_create_project_from_template(home, tmp_path, make_set, monkeypatch):
    import app as appmod
    opened = []
    monkeypatch.setattr(appmod.renderer, "open_in_live", lambda path, app: opened.append(path))
    tpl = make_set(str(tmp_path / "tpl" / "Default.als"), tempo=120, arr_clips=0, in_key=False)
    c = appmod.app.test_client()
    assert c.post("/api/create", json={"name": "Neu"}).status_code == 400  # ohne Vorlage
    c.post("/api/settings", json={"template": tpl, "new_project_dir": str(tmp_path / "out")})
    r = c.post("/api/create", json={"name": "Morgengrauen", "tempo": "122", "key_root": "D", "key_mode": "Moll", "genre": "Deep House", "tags": ["pad"]})
    p = r.get_json()
    assert r.status_code == 200, p
    assert p["tempo"] == 122 and p["key_root"] == "D" and p["genre"] == "Deep House" and p["status"] == "Skizze"
    assert os.path.exists(tmp_path / "out" / "Morgengrauen Project" / "Morgengrauen.als")
    assert opened and opened[0].endswith("Morgengrauen.als")
    assert c.post("/api/create", json={"name": "Morgengrauen"}).status_code == 400  # Duplikat


def test_render_job_with_fake_live(home, tmp_path, make_set, monkeypatch):
    """Rendern ohne Live: der Renderer wird durch eine Fake-Funktion ersetzt, die ein WAV schreibt."""
    import app as appmod
    lib = tmp_path / "m"
    make_set(str(lib / "R Project" / "R.als"), tempo=124)
    c = appmod.app.test_client()
    c.post("/api/scan", json={"roots": [str(lib)]}); wait_job(c)

    def fake_render(als, out_dir, name, app_name=None, log=print):
        os.makedirs(out_dir, exist_ok=True)
        return write_tone(os.path.join(out_dir, name + ".mp3.wav"), bpm=124, seconds=8)
    monkeypatch.setattr(appmod.renderer, "render_set", fake_render)
    r = c.post("/api/render", json={"missing": True}).get_json()
    assert r["count"] == 1
    wait_job(c, timeout=120)
    p = c.get("/api/projects").get_json()[0]
    assert p["mp3_path"] and p["analyzed_at"] and p["mood"]
    assert p["key_root"] == "A"  # aus der Audio-Analyse (Set hat Skala A, Analyse bestätigt)
    assert c.get(f"/audio/{p['id']}").status_code == 200
    lib = c.get("/api/dj/library").get_json()
    assert lib[0]["kind"] == "p" and lib[0]["bpm"] == 124


def test_dj_import_upload_cues_grid(home, tmp_path):
    import app as appmod
    c = appmod.app.test_client()
    folder = tmp_path / "dj"
    folder.mkdir()
    write_tone(str(folder / "DJ Test - Track Eins.wav"), bpm=128, seconds=10)
    (folder / "notiz.txt").write_text("x")
    c.post("/api/dj/import", json={"paths": [str(folder)]}); wait_job(c, 120)
    lib = c.get("/api/dj/library").get_json()
    assert len(lib) == 1
    t = lib[0]
    assert t["artist"] == "DJ Test" and t["title"] == "Track Eins" and t["source"] == "Import"
    assert t["bpm"] and t["key_root"]
    assert c.get(t["url"]).status_code == 200

    # Upload per Drag & Drop
    buf = io.BytesIO(open(folder / "DJ Test - Track Eins.wav", "rb").read())
    r = c.post("/api/dj/upload", data={"files": (buf, "Zweiter.wav")}, content_type="multipart/form-data")
    assert r.get_json()["saved"] == 1
    wait_job(c, 120)
    assert len(c.get("/api/dj/library").get_json()) == 2

    # Hot Cues speichern (max. 8, nur Zahlen/None)
    r = c.put(f"/api/dj/cues/i/{t['id']}", json=[1.5, None, 3, "x", 5, 6, 7, 8, 9, 10])
    assert r.get_json() == [1.5, None, 3, None, 5, 6, 7, 8]
    assert c.get(f"/api/dj/cues/i/{t['id']}").get_json()[0] == 1.5
    assert c.get("/api/dj/cues/x/1").status_code == 400

    c.patch(f"/api/dj/grid/i/{t['id']}", json={"bpm": 127.5, "grid_offset": 0.12})
    t2 = [x for x in c.get("/api/dj/library").get_json() if x["id"] == t["id"]][0]
    assert t2["bpm"] == 127.5 and t2["grid_offset"] == 0.12


def test_static_files_served(home):
    import app as appmod
    c = appmod.app.test_client()
    html = c.get("/").get_data(as_text=True)
    for js in ("common.js", "archive.js", "flx4.js", "dj-logic.js", "dj.js"):
        assert f"/static/js/{js}" in html
        assert c.get(f"/static/js/{js}").status_code == 200
    assert c.get("/static/js/deck-worklet.js").status_code == 200
    assert c.get("/static/css/app.css").status_code == 200


def test_remove_project_stays_hidden_after_rescan(home, tmp_path):
    import app as appmod
    from core import db
    c = appmod.app.test_client()
    pid = db.upsert({"path": "/x/Weg.als", "name": "Weg"})
    assert c.delete(f"/api/projects/{pid}").get_json()["ok"]
    assert db.get(pid) is None
    assert "/x/Weg.als" in db.hidden_paths()
    assert c.post("/api/hidden/clear").get_json()["restored"] == 1

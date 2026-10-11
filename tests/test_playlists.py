def test_playlists_crud(home):
    import app as appmod
    c = appmod.app.test_client()
    assert c.get("/api/dj/playlists").get_json() == []
    a = c.post("/api/dj/playlists", json={"name": "Warm-up"}).get_json()
    b = c.post("/api/dj/playlists", json={"name": "Peak", "uids": ["p1", "i2"]}).get_json()
    assert a["name"] == "Warm-up" and a["count"] == 0
    assert b["items"] == ["p1", "i2"]

    # anhängen, keine Duplikate, ungültige uids ignorieren
    r = c.post(f"/api/dj/playlists/{a['id']}/tracks", json={"uids": ["p3", "p3", "x9", "i1"]}).get_json()
    assert r["items"] == ["p3", "i1"]
    r = c.post(f"/api/dj/playlists/{a['id']}/tracks", json={"uids": ["p5"], "index": 1}).get_json()
    assert r["items"] == ["p3", "p5", "i1"]

    # sortieren / entfernen
    r = c.put(f"/api/dj/playlists/{a['id']}/tracks", json={"uids": ["i1", "p3"]}).get_json()
    assert r["items"] == ["i1", "p3"]

    # umbenennen, Reihenfolge der Playlists, löschen
    assert c.patch(f"/api/dj/playlists/{a['id']}", json={"name": "Opener"}).status_code == 200
    order = c.put("/api/dj/playlists/order", json={"ids": [b["id"], a["id"]]}).get_json()
    assert [p["name"] for p in order] == ["Peak", "Opener"]
    c.delete(f"/api/dj/playlists/{b['id']}")
    left = c.get("/api/dj/playlists").get_json()
    assert [p["name"] for p in left] == ["Opener"] and left[0]["items"] == ["i1", "p3"]
    assert c.post("/api/dj/playlists/999/tracks", json={"uids": ["p1"]}).status_code == 404


def test_parallel_requests_do_not_share_connection(home):
    """Viele gleichzeitige Anfragen (Mini-Waveforms) dürfen SQLite nicht durcheinanderbringen."""
    import threading
    import app as appmod
    from core import db
    pid = db.upsert({"path": "/x/A.als", "name": "A"})
    errors = []

    def worker():
        c = appmod.app.test_client()
        for _ in range(30):
            r = c.get(f"/api/peaks/{pid}")
            if r.status_code >= 500:
                errors.append(r.status_code)
            db.playlists()
    ts = [threading.Thread(target=worker) for _ in range(12)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert errors == []


def test_folder_browser_analyze_and_tag_editor(home, tmp_path, monkeypatch):
    import app as appmod
    from core import db
    music = tmp_path / "Musik"; (music / "House").mkdir(parents=True)
    (music / "a.mp3").write_bytes(b"x"); (music / "notes.txt").write_text("x"); (music / ".hidden").mkdir()
    c = appmod.app.test_client()
    r = c.get(f"/api/fs/list?path={music}").get_json()
    assert [d["name"] for d in r["dirs"]] == ["House"] and r["files"] == ["a.mp3"] and r["parent"] == str(tmp_path)
    assert r["places"][0]["path"]

    iid = db.add_import(dict(path=str(music / "a.mp3"), title="a", artist="", added=0))
    uid = f"i{iid}"
    r = c.patch("/api/dj/tags", json={"uids": [uid], "values": {"title": "Nachtzug", "artist": "Groove X", "genre": "Deep House",
                                                              "bpm": "122", "tags": "warm, opener", "rating": 4}}).get_json()
    assert r["ok"]
    t = next(x for x in c.get("/api/dj/library").get_json() if x["uid"] == uid)
    assert (t["title"], t["artist"], t["genre"], t["bpm"], t["tags"], t["rating"]) == ("Nachtzug", "Groove X", "Deep House", 122.0, ["warm", "opener"], 4)
    # Analyse überschreibt die Nutzerwerte nicht
    db.update_import(iid, {"genre": "Techno", "bpm": 130.0, "energy": 0.7})
    t = db.get_import(iid)
    assert t["genre"] == "Deep House" and t["bpm"] == 122.0 and t["energy"] == 0.7

    started = []
    monkeypatch.setattr(appmod, "run_job", lambda name, fn, uids: started.append(uids) or True)
    assert c.post("/api/dj/analyze", json={"uids": [uid, "i999"]}).get_json()["count"] == 1
    assert c.post("/api/dj/analyze", json={"mode": "missing"}).get_json()["count"] == 1
    assert started == [[uid], [uid]]

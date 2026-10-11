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

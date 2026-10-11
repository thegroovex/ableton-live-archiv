import os

from core.matcher import find_existing_audio, norm
from tests.conftest import write_tone


def test_norm():
    assert norm("Gestern waren wir noch niemand Project") == norm("Gestern waren wir noch niemand.mp3") == norm("gestern waren wir noch niemand.als")
    assert norm("frozen flakes.mp3.asd Project") == "frozenflakes"


def test_matches_mp3_next_to_project_folder(tmp_path, make_set):
    root = tmp_path / "Own Tracks"
    als = make_set(str(root / "Gestern waren wir noch niemand Project" / "Gestern waren wir noch niemand.als"))
    (root / "Gestern waren wir noch niemand.mp3").write_bytes(b"x")
    (root / "Gestern waren wir noch niemand.mp3.asd").write_bytes(b"x")
    assert find_existing_audio(als) == str(root / "Gestern waren wir noch niemand.mp3")


def test_folder_name_only_when_single_set(tmp_path, make_set):
    root = tmp_path / "t"
    a = make_set(str(root / "aris beat Project" / "aris beat.als"))
    b = make_set(str(root / "aris beat Project" / "absynthisia.als"))
    (root / "aris beat.mp3").write_bytes(b"x")
    assert find_existing_audio(a).endswith("aris beat.mp3")
    assert find_existing_audio(b) is None
    c = make_set(str(root / "New Happy Beat Project" / "Neuer Entwurf.als"))
    (root / "New Happy Beat.wav").write_bytes(b"x")
    (root / "New Happy Beat.mp3").write_bytes(b"x")
    assert find_existing_audio(c).endswith("New Happy Beat.mp3")


def test_scan_assigns_and_analyzes(home, tmp_path, make_set):
    import app as appmod
    from tests.test_db_and_api import wait_job
    root = tmp_path / "Own Tracks"
    make_set(str(root / "Lass es bleiben Project" / "Lass es bleiben.als"), tempo=124)
    write_tone(str(root / "Lass es bleiben.wav"), bpm=124, seconds=8)
    c = appmod.app.test_client()
    c.post("/api/scan", json={"roots": [str(root)]})
    j = wait_job(c, 120)
    assert "1 vorhandene MP3s zugeordnet" in j["log"][-1]
    p = c.get("/api/projects").get_json()[0]
    assert p["mp3_path"].endswith("Lass es bleiben.wav") and p["analyzed_at"]

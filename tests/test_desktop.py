"""Standalone-App: Python-Seite (ffmpeg aus dem App-Paket, Pfade im gebündelten Zustand)."""
import importlib
import os
import sys

from core import platform_util


def test_ffmpeg_aus_app_paket(tmp_path, monkeypatch):
    ff = tmp_path / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    ff.write_bytes(b"")
    monkeypatch.setenv("LIVE_ARCHIV_FFMPEG", str(ff))
    assert platform_util.ffmpeg_path() == str(ff)


def test_ffmpeg_variable_ohne_datei_wird_ignoriert(tmp_path, monkeypatch):
    monkeypatch.setenv("LIVE_ARCHIV_FFMPEG", str(tmp_path / "gibtsnicht"))
    assert platform_util.ffmpeg_path() != str(tmp_path / "gibtsnicht")


def test_static_ordner_im_gebuendelten_zustand(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    import app
    try:
        app = importlib.reload(app)
        assert app.APP_DIR == str(tmp_path)
        assert app.app.static_folder == os.path.join(str(tmp_path), "static")
    finally:
        monkeypatch.delattr(sys, "_MEIPASS")
        importlib.reload(app)


def test_spec_und_einstieg_vorhanden():
    root = os.path.join(os.path.dirname(__file__), "..", "desktop")
    for f in ("server_entry.py", "live-archiv-server.spec", "main.js", "lib.js", "package.json", "build/icon.png", "app-icon.png", "brand-logo.svg", "loading.html"):
        assert os.path.exists(os.path.join(root, f)), f


def test_branding_beattactics():
    import json
    root = os.path.join(os.path.dirname(__file__), "..")
    pkg = json.load(open(os.path.join(root, "desktop", "package.json"), encoding="utf-8"))
    assert pkg["author"] == "BeatTactics"
    assert "designed by groovex" in pkg["build"]["copyright"]
    for f in pkg["build"]["files"]:
        assert os.path.exists(os.path.join(root, "desktop", f)), f
    html = open(os.path.join(root, "static", "index.html"), encoding="utf-8").read()
    assert "BeatTactics" in html and "designed by groovex" in html
    assert os.path.exists(os.path.join(root, "static", "img", "app-icon.png"))

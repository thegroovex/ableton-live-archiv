"""Windows-Port: plattformunabhängige Teile laufen überall, der Rest auf windows-latest in GitHub Actions."""
import os
import sys

import pytest

from core import platform_util, renderer_win


def test_title_matching_windows_titles():
    assert renderer_win._title_is("Song", "Song - Ableton Live 12 Suite")
    assert renderer_win._title_is("Song", "Song* [C:\\Users\\dj\\Music\\Song Project] - Ableton Live 12 Suite")
    assert renderer_win._title_is("Bücherschrank", "Bu\u0308cherschrank - Ableton Live 12 Suite")
    assert not renderer_win._title_is("Song", "Song 2 - Ableton Live 12 Suite")


def test_find_live_exe(tmp_path, monkeypatch):
    exe = tmp_path / "Ableton" / "Live 12 Suite" / "Program" / "Ableton Live 12 Suite.exe"
    exe.parent.mkdir(parents=True)
    exe.write_text("")
    monkeypatch.setenv("PROGRAMDATA", str(tmp_path))
    assert renderer_win.find_live_exe("Live 12 Suite") or renderer_win.find_live_exe("Ableton Live 12 Suite")


def test_renderer_choice():
    mod = platform_util.renderer()
    assert mod.__name__ == ("core.renderer_win" if sys.platform == "win32" else "core.renderer")


def test_default_settings_per_platform():
    s = platform_util.default_settings()
    assert s["roots"] and s["new_project_dir"]
    if sys.platform == "win32":
        assert "Documents" in s["roots"][0]


def test_render_flow_mocked(tmp_path, monkeypatch):
    """Ablauf ohne echtes Live: Fenster erscheint, Export-Dialog, Datei wächst und wird fertig."""
    out = tmp_path / "out"
    als = tmp_path / "Song.als"; als.write_text("x")
    monkeypatch.setattr(renderer_win, "quit_live_hard", lambda log=print: None)
    monkeypatch.setattr(renderer_win, "open_in_live", lambda *a, **k: None)
    monkeypatch.setattr(renderer_win, "_window_titles", lambda: ["Song - Ableton Live 12 Suite"])
    monkeypatch.setattr(renderer_win, "_wait_until_idle", lambda log=print: None)
    monkeypatch.setattr(renderer_win, "_raise_set_window", lambda n: None)
    counts = iter([1, 2])
    monkeypatch.setattr(renderer_win, "_window_count", lambda: next(counts, 2))
    monkeypatch.setattr(renderer_win, "_file_dialog", lambda: 42)
    monkeypatch.setattr(renderer_win, "_focus", lambda h: None)
    monkeypatch.setattr(renderer_win, "_combo", lambda *k: None)
    typed = []

    def fake_type(text):
        typed.append(text)
        (out / "00001_Song.mp3").write_bytes(b"ID3" + b"0" * 1000)
    monkeypatch.setattr(renderer_win, "_type", fake_type)
    monkeypatch.setattr(renderer_win.time, "sleep", lambda s: None)
    res = renderer_win.render_set(str(als), str(out), "00001_Song", log=lambda m: None)
    assert res.endswith("00001_Song.mp3") and os.path.exists(res)
    assert typed and typed[0].endswith("00001_Song")


@pytest.mark.skipif(sys.platform != "win32", reason="nur unter Windows")
def test_win32_window_enumeration_runs():
    assert isinstance(renderer_win._windows(set()), list)

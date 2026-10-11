import os
import subprocess
import sys

import pytest

# macOS-Renderer (AppleScript); Windows hat core/renderer_win.py mit eigenen Tests
pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="macOS-Renderer")


@pytest.fixture(autouse=True)
def _files_exist(monkeypatch):
    monkeypatch.setattr(renderer.os.path, "isfile", lambda p: True)
    counter = {"n": 0}
    def windows():  # jeder Aufruf "sieht" ein Fenster mehr: Export-Dialog geht sofort auf
        counter["n"] += 1
        return counter["n"]
    monkeypatch.setattr(renderer, "_window_count", windows)
    monkeypatch.setattr(renderer, "_wait_until_idle", lambda log=print: None)
    monkeypatch.setattr(renderer, "_find_save_dialog", lambda: None)

from core import renderer


def test_render_flow_with_mocked_live(tmp_path, monkeypatch):
    calls = []
    out = tmp_path / "renders"

    def fake_run(cmd, **kw):
        calls.append(cmd)
        class R: returncode = 0; stdout = ""; stderr = ""
        if cmd[0] == "osascript" and "keystroke \"r\"" in cmd[2]:
            (out / "00001_Song.mp3").write_bytes(b"ID3" + b"0" * 2048)  # Live "exportiert"
        return R()

    monkeypatch.setattr(renderer.subprocess, "run", fake_run)
    monkeypatch.setattr(renderer, "_front_window_title", lambda: "Song  - Ableton Live 12 Suite")
    monkeypatch.setattr(renderer.time, "sleep", lambda s: None)
    res = renderer.render_set("/x/Song Project/Song.als", str(out), "00001_Song", app_name="Ableton Live 12 Suite", log=lambda m: None)
    assert res == str(out / "00001_Song.mp3") and os.path.getsize(res) > 2000
    assert ["open", "-a", "Ableton Live 12 Suite", "/x/Song Project/Song.als"] in calls
    # Ohne hängenden Dialog bleibt Live offen (schneller Weg, kein Neustart)
    assert ["pkill", "-9", "-x", "Live"] not in calls

    assert any(c[0] == "osascript" and "command down, shift down" in c[2] for c in calls)
    script = [c for c in calls if c[0] == "osascript" and "key code 36" in c[2]][0][2]
    assert str(out) in script and "00001_Song" in script


def test_load_timeout(tmp_path, monkeypatch):
    monkeypatch.setattr(renderer.subprocess, "run", lambda *a, **k: type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})())
    monkeypatch.setattr(renderer, "_front_window_title", lambda: "Anderes Set")
    monkeypatch.setattr(renderer.time, "sleep", lambda s: None)
    with pytest.raises(TimeoutError):
        renderer.render_set("/x/Song.als", str(tmp_path), "n", load_timeout=0.05, log=lambda m: None)


@pytest.mark.skipif(sys.platform != "darwin", reason="nur auf macOS")
def test_macos_tools_available():
    """Auf dem Mac müssen osascript und open vorhanden sein und AppleScript ausführbar."""
    r = subprocess.run(["osascript", "-e", "return 1 + 1"], capture_output=True, text=True)
    assert r.returncode == 0 and r.stdout.strip() == "2"
    assert subprocess.run(["which", "open"], capture_output=True).returncode == 0


@pytest.mark.skipif(sys.platform != "darwin", reason="nur auf macOS")
def test_apple_script_compiles():
    """Das Export-Skript muss für AppleScript syntaktisch gültig sein (ohne es auszuführen)."""
    import inspect, re, tempfile
    src = inspect.getsource(renderer.render_set)
    body = re.search(r"script = f'''(.*?)'''", src, re.S).group(1)
    body = body.replace("{{", "{").replace("}}", "}")
    body = body.replace("{app_name}", "Finder").replace("{LIVE_PROCESS}", "Finder").replace("{esc_name}", "x").replace("{esc_dir}", "/tmp")
    with tempfile.NamedTemporaryFile("w", suffix=".applescript", delete=False) as fh:
        fh.write(body)
    out = fh.name + ".scpt"
    r = subprocess.run(["osacompile", "-o", out, fh.name], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_umlaut_set_name_matches_window_title(tmp_path, monkeypatch):
    """Dateiname zerlegt (NFD), Fenstertitel zusammengesetzt (NFC): muss trotzdem erkannt werden."""
    import unicodedata
    out = tmp_path / "r"
    def fake_run(cmd, **kw):
        class R: returncode = 0; stdout = ""; stderr = ""
        if cmd[0] == "osascript" and 'keystroke "r"' in cmd[2]:
            (out / "00007_Buecherschrank.mp3").write_bytes(b"ID3" + b"0" * 2048)
        return R()
    monkeypatch.setattr(renderer.subprocess, "run", fake_run)
    titles = iter(["Untitled"] * 2)
    monkeypatch.setattr(renderer, "_front_window_title", lambda: next(titles, "Bücherschrank - Ableton Live 12 Suite"))
    monkeypatch.setattr(renderer.time, "sleep", lambda s: None)
    nfd = unicodedata.normalize("NFD", "/x/Bücherschrank.als")
    res = renderer.render_set(nfd, str(out), "00007_Buecherschrank", load_timeout=5, log=lambda m: None)
    assert res.endswith("00007_Buecherschrank.mp3")


def test_safe_name_is_ascii(home):
    import app as appmod
    assert appmod._safe_name(7, "Bücherschrank (Größe) – v2") == "00007_Buecherschrank Groesse  v2"


def test_falls_back_to_restart_when_dialog_sticks(monkeypatch):
    calls = []
    def fake_run(cmd, **kw):
        calls.append(cmd)
        class R: returncode = 0; stdout = ""; stderr = ""
        return R()
    monkeypatch.setattr(renderer.subprocess, "run", fake_run)
    monkeypatch.setattr(renderer.time, "sleep", lambda s: None)
    monkeypatch.setattr(renderer, "_find_save_dialog", lambda: (533, 440, 504, 149))
    monkeypatch.setattr(renderer, "_dismiss_save_dialog", lambda: "still-open")
    assert renderer._try_switch_with_dialog("/x/A.als", "Ableton Live 12 Suite", log=lambda m: None) is False

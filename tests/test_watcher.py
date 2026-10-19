"""Auto-Erfassung: beobachtet nur, solange Live läuft, liest gespeicherte Sets einzeln ein."""
import os
import time

import pytest

from core.watcher import AutoWatcher, is_set_file

pytest.importorskip("watchdog")


def wait_for(cond, timeout=8.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


def test_is_set_file():
    assert is_set_file(os.path.join("Musik", "Song Project", "Song.als"))
    assert not is_set_file(os.path.join("Musik", "Song Project", "Backup", "Song [2026].als"))
    assert not is_set_file(os.path.join("Musik", "Song Project", "._Song.als"))
    assert not is_set_file(os.path.join("Musik", ".Trash", "Song.als"))
    assert not is_set_file(os.path.join("Musik", "Song Project", "Song.wav"))


def make(tmp_path, live, changed, closed=None, enabled=None):
    return AutoWatcher(get_roots=lambda: [str(tmp_path)], on_set_changed=changed.append,
                       on_live_closed=closed or (lambda: None), is_enabled=enabled,
                       is_live_running=lambda: live["on"], interval=0.1, debounce=0.3)


def test_no_observer_without_live(tmp_path):
    live, changed = {"on": False}, []
    w = make(tmp_path, live, changed)
    w.start()
    try:
        time.sleep(0.4)
        (tmp_path / "Idee.als").write_bytes(b"x")
        time.sleep(0.8)
        assert w.watching == [] and changed == [] and not w.live
    finally:
        w.stop()


def test_captures_saved_set_while_live_and_stops_after(tmp_path):
    live, changed, closed = {"on": True}, [], []
    w = make(tmp_path, live, changed, closed=lambda: closed.append(1))
    w.start()
    try:
        assert wait_for(lambda: w.watching)
        proj = tmp_path / "Neu Project"; proj.mkdir()
        (proj / "Backup").mkdir()
        (proj / "Backup" / "Neu [alt].als").write_bytes(b"x")
        f = proj / "Neu.als"
        for _ in range(3):           # mehrfaches Speichern → nur ein Einlesen nach der Ruhezeit
            f.write_bytes(b"x"); time.sleep(0.05)
        assert wait_for(lambda: changed)
        time.sleep(0.5)
        assert [os.path.basename(p) for p in changed] == ["Neu.als"]
        live["on"] = False
        assert wait_for(lambda: closed)
        assert w.watching == [] and not w.live
    finally:
        w.stop()


def test_saved_just_before_quit_is_not_lost(tmp_path):
    live, changed = {"on": True}, []
    w = AutoWatcher(get_roots=lambda: [str(tmp_path)], on_set_changed=changed.append,
                    is_live_running=lambda: live["on"], interval=0.1, debounce=30)
    w.start()
    try:
        assert wait_for(lambda: w.watching)
        (tmp_path / "Spät.als").write_bytes(b"x")
        assert wait_for(lambda: w.state()["pending"] == 1)
        live["on"] = False
        assert wait_for(lambda: changed)
    finally:
        w.stop()


def test_disabled_never_watches(tmp_path):
    live, changed = {"on": True}, []
    w = make(tmp_path, live, changed, enabled=lambda: False)
    w.start()
    try:
        time.sleep(0.5)
        assert w.watching == [] and not w.live
    finally:
        w.stop()


def test_app_indexes_set_and_defers_analysis(home, make_set, monkeypatch, tmp_path):
    import app
    started = []
    monkeypatch.setattr(app, "run_job", lambda name, fn, *a: started.append((name, a)) or True)
    path = make_set(str(tmp_path / "Nachtfahrt Project" / "Nachtfahrt.als"))
    app.auto_set_changed(path)
    row = app.db.db().execute("SELECT id, name FROM projects WHERE path=?", (path,)).fetchone()
    assert row is not None
    assert app.AUTO["recent"][0]["new"] is True
    app.AUTO["deferred"].add(row["id"])
    app.auto_live_closed()
    assert started and started[0][0] == "Analyse" and row["id"] in started[0][1][0]
    assert not app.AUTO["deferred"]

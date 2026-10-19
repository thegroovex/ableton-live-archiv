"""Automatische Erfassung neuer und geänderter Live-Sets – ressourcenschonend.

Grundsatz: Es wird nur beobachtet, solange Ableton Live läuft.
- Alle `interval` Sekunden ein billiger Prozess-Check (pgrep bzw. psutil).
- Läuft Live, hängt sich ein Dateisystem-Beobachter (watchdog: FSEvents auf macOS,
  ReadDirectoryChangesW auf Windows) an die Projektordner. Das kostet im Leerlauf praktisch nichts,
  es wird kein Ordner durchsucht.
- Speichert Live ein Set (.als), wird es nach `debounce` Sekunden Ruhe einzeln eingelesen.
- Wird Live beendet, stoppt der Beobachter, und `on_live_closed` darf die rechenintensive Arbeit
  erledigen (z. B. Analyse), die bewusst nicht parallel zu Live läuft.
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import time

IS_MAC = sys.platform == "darwin"
IS_WIN = sys.platform == "win32"


def live_running() -> bool:
    """Läuft Ableton Live gerade? Billiger Check, ohne Live zu stören."""
    try:
        if IS_MAC:
            # Der Prozess von "Ableton Live 12 Suite.app" heißt "Live".
            r = subprocess.run(["pgrep", "-x", "Live"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return r.returncode == 0
        if IS_WIN:
            import psutil
            for p in psutil.process_iter(["name"]):
                n = (p.info.get("name") or "").lower()
                if n.startswith("ableton live") and n.endswith(".exe"):
                    return True
            return False
    except Exception:
        return False
    return False


def is_set_file(path: str) -> bool:
    """Nur echte Live-Sets: .als, keine Backups, keine macOS-Ressourcendateien, kein Papierkorb."""
    if not path or not path.lower().endswith(".als"):
        return False
    base = os.path.basename(path)
    if base.startswith("._") or base.startswith("~"):
        return False
    parts = os.path.normpath(path).split(os.sep)
    return not any(p in ("Backup", ".Trash") or (p.startswith(".") and p not in (".", "..")) for p in parts[:-1])


class AutoWatcher:
    def __init__(self, get_roots, on_set_changed, on_live_closed=None, is_enabled=None,
                 is_live_running=live_running, interval=15.0, debounce=20.0):
        self.get_roots = get_roots
        self.on_set_changed = on_set_changed
        self.on_live_closed = on_live_closed or (lambda: None)
        self.is_enabled = is_enabled or (lambda: True)
        self.is_live_running = is_live_running
        self.interval, self.debounce = interval, debounce
        self.live = False
        self.watching: list[str] = []
        self.available = True
        self.error = ""
        self._pending: dict[str, float] = {}
        self._lock = threading.Lock()
        self._observer = None
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread = None
        self._sig = ()

    # ---------------------------------------------------------------- Steuerung
    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="live-archiv-watch", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set(); self._wake.set()
        if self._thread:
            self._thread.join(timeout=5)
        self._stop_observer()

    def poke(self):
        """Sofort neu prüfen (z. B. nach geänderten Einstellungen)."""
        self._wake.set()

    def state(self) -> dict:
        return dict(enabled=bool(self.is_enabled()), available=self.available, live=self.live,
                    watching=list(self.watching), pending=len(self._pending), error=self.error)

    # ---------------------------------------------------------------- Ereignisse
    def notify(self, path: str):
        if is_set_file(path):
            with self._lock:
                self._pending[os.path.abspath(path)] = time.monotonic()
            self._wake.set()

    def _due(self, force=False) -> list[str]:
        now = time.monotonic()
        with self._lock:
            due = [p for p, t in self._pending.items() if force or now - t >= self.debounce]
            for p in due:
                self._pending.pop(p, None)
        return due

    def _process(self, force=False):
        for p in self._due(force):
            if os.path.isfile(p):
                try:
                    self.on_set_changed(p)
                except Exception as exc:  # ein kaputtes Set darf den Beobachter nicht beenden
                    self.error = f"{os.path.basename(p)}: {exc}"

    # ---------------------------------------------------------------- Beobachter
    def _start_observer(self):
        try:
            from watchdog.observers import Observer
            from watchdog.events import FileSystemEventHandler
        except Exception as exc:
            self.available, self.error = False, f"watchdog fehlt: {exc}"
            return
        watcher = self

        class Handler(FileSystemEventHandler):
            def on_any_event(self, event):
                if event.is_directory or event.event_type not in ("created", "modified", "moved", "closed"):
                    return
                watcher.notify(getattr(event, "dest_path", "") or event.src_path)

        from core.als_parser import clean_path
        obs = Observer()
        roots = []
        for r in self.get_roots() or []:
            r = clean_path(r)
            if os.path.isdir(r):
                obs.schedule(Handler(), r, recursive=True)
                roots.append(r)
        if not roots:
            return
        obs.daemon = True
        obs.start()
        self._observer, self.watching = obs, roots

    def _stop_observer(self):
        obs, self._observer, self.watching = self._observer, None, []
        if obs:
            try:
                obs.stop(); obs.join(timeout=5)
            except Exception:
                pass

    def _roots_sig(self):
        try:
            return tuple(self.get_roots() or [])
        except Exception:
            return ()

    # ---------------------------------------------------------------- Schleife
    def _loop(self):
        while not self._stop.is_set():
            enabled = bool(self.is_enabled())
            live = enabled and bool(self.is_live_running())
            if live and self._observer and self._roots_sig() != self._sig:
                self._stop_observer()            # Projektordner in den Einstellungen geändert
            if live and not self._observer:
                self._sig = self._roots_sig()
                self._start_observer()
            elif not live and self._observer:
                self._stop_observer()
            was_live, self.live = self.live, live
            if was_live and not live:
                self._process(force=True)        # nichts verlieren, was kurz vor dem Beenden gespeichert wurde
                try:
                    self.on_live_closed()
                except Exception as exc:
                    self.error = str(exc)
            elif live:
                self._process()
            wait = min(self.interval, max(0.05, self.debounce / 4)) if self._pending else self.interval
            self._wake.wait(wait)
            self._wake.clear()

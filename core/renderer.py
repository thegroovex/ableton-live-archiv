"""Automatischer Export über Ableton Live 12 (macOS, per AppleScript/System Events).

Voraussetzungen (einmalig):
  * Systemeinstellungen > Datenschutz & Sicherheit > Bedienungshilfen: Terminal (bzw. die App,
    aus der Live Archiv gestartet wird) erlauben.
  * In Live einmal manuell "Audio/Video exportieren" öffnen und einstellen:
      Gerenderte Spur: Main, Render-Start/-Länge: ganzes Arrangement,
      "MP3 kodieren" an (WAV/PCM darf aus). Live merkt sich diese Einstellungen.
"""
from __future__ import annotations

import glob
import os
import shutil
import subprocess
import time
import unicodedata

LIVE_PROCESS = "Live"


def _n(text: str) -> str:
    """Umlaute vergleichbar machen: macOS liefert Dateinamen oft zerlegt (u + ¨), Live zeigt sie zusammengesetzt."""
    return unicodedata.normalize("NFC", text or "").casefold()


def _osa(script: str, timeout: int = 60) -> str:
    res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or "AppleScript-Fehler")
    return res.stdout.strip()


def _front_window_title() -> str:
    try:
        return _osa(f'tell application "System Events" to tell process "{LIVE_PROCESS}" to get name of front window')
    except Exception:
        return ""


def _window_titles() -> list[str]:
    """Namen aller Live-Fenster. Bei Sets mit Video liegt das Videofenster vorne, nicht das Set."""
    try:
        out = _osa(f'tell application "System Events" to tell process "{LIVE_PROCESS}" to get name of every window', timeout=10)
    except Exception:
        return []
    return [t.strip() for t in out.split(", ") if t.strip() and t.strip() != "missing value"]


def _raise_set_window(set_name: str) -> None:
    """Holt das Hauptfenster des Sets nach vorne (z. B. vor ein Videofenster)."""
    esc = set_name.replace('"', '\\"')
    script = f'''
    tell application "System Events" to tell process "{LIVE_PROCESS}"
        set frontmost to true
        repeat with w in windows
            try
                if (name of w as text) starts with "{esc}" then
                    perform action "AXRaise" of w
                    return "ok"
                end if
            end try
        end repeat
    end tell
    return "none"'''
    try:
        _osa(script, timeout=10)
    except Exception:
        pass


def _front_document() -> str:
    """Datei-URL des vorderen Live-Fensters (AXDocument), falls macOS sie liefert."""
    try:
        return _osa(f'tell application "System Events" to tell process "{LIVE_PROCESS}" to get value of attribute "AXDocument" of front window', timeout=10)
    except Exception:
        return ""


def _title_is(set_name: str, title: str) -> bool:
    """Exakter Vergleich: Live zeigt nur den Set-Namen (evtl. mit * oder ' - Ableton Live …')."""
    t = _n(title).strip()
    t = t.split(" - ableton")[0].strip().rstrip("*").strip()
    return t == _n(set_name)


def _doc_is(als_path: str, doc: str) -> bool:
    from urllib.parse import unquote
    return bool(doc) and _n(unquote(doc)).rstrip("/").endswith(_n(als_path))


def _mouse_click(x: float, y: float) -> None:
    """Echter Mausklick über CoreGraphics. Lives selbst gezeichnete Knöpfe reagieren nur darauf,
    nicht auf 'click at' von System Events (das drückt nur Bedienungshilfe-Elemente)."""
    import ctypes
    import ctypes.util

    class CGPoint(ctypes.Structure):
        _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

    cg = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices")
    cf = ctypes.cdll.LoadLibrary(ctypes.util.find_library("CoreFoundation"))
    cg.CGEventCreateMouseEvent.restype = ctypes.c_void_p
    cg.CGEventCreateMouseEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint32, CGPoint, ctypes.c_uint32]
    cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
    cf.CFRelease.argtypes = [ctypes.c_void_p]
    pt = CGPoint(x, y)
    for kind in (5, 1, 2):  # bewegen, Taste runter, Taste hoch
        ev = cg.CGEventCreateMouseEvent(None, kind, pt, 0)
        cg.CGEventPost(0, ev)
        cf.CFRelease(ev)
        time.sleep(0.08)


def _find_save_dialog() -> tuple[float, float, float, float] | None:
    """Position und Größe von Lives Sichern-Dialog in Punkten (AXDialog, ca. 504 x 149 pt)."""
    script = f'''
    tell application "System Events" to tell process "{LIVE_PROCESS}"
        repeat with w in windows
            try
                set sr to ""
                try
                    set sr to subrole of w
                end try
                set t to ""
                try
                    set t to (name of w) as text
                end try
                set {{wx, wy}} to position of w
                set {{ww, wh}} to size of w
                if sr is "AXDialog" or (t is "" and ww > 220 and ww < 720 and wh > 60 and wh < 260) then
                    return (wx as text) & "," & (wy as text) & "," & (ww as text) & "," & (wh as text)
                end if
            end try
        end repeat
    end tell
    return "none"'''
    try:
        out = _osa(script, timeout=10)
    except Exception:
        return None
    if out == "none" or out.count(",") != 3:
        return None
    try:
        x, y, w, h = (float(v.replace(" ", "")) for v in out.split(","))
    except ValueError:
        return None
    if w > 720 or h > 260:  # Sicherheitsnetz: nie ins Hauptfenster klicken
        return None
    return x, y, w, h


def _dismiss_save_dialog() -> str:
    """Beantwortet Lives Frage "Save changes …?" mit 'Don’t Save' (links unten im Dialog).

    Sicher, weil Live Archiv nur rendert, wenn Live vorher geschlossen war: jede Frage betrifft
    also ein Set, das das Tool selbst geöffnet hat.
    """
    box = _find_save_dialog()
    if not box:
        return "none"
    x, y, w, h = box
    try:
        _osa(f'tell application "System Events" to set frontmost of process "{LIVE_PROCESS}" to true', timeout=5)
        time.sleep(0.3)
        _mouse_click(x + w * 0.15, y + h * 0.8)
    except Exception:
        return "error"
    time.sleep(0.8)
    return "clicked" if not _find_save_dialog() else "still-open"


def live_is_running() -> bool:
    res = subprocess.run(["pgrep", "-x", LIVE_PROCESS], capture_output=True)
    return res.returncode == 0


def _clear_crash_markers() -> None:
    """Damit Live nach dem harten Beenden nicht 'Wiederherstellen?' fragt."""
    base = os.path.expanduser("~/Library/Preferences/Ableton")
    for d in glob.glob(os.path.join(base, "Live 12*")):
        for f in ("CrashDetection.cfg", "CrashRecoveryInfo.cfg"):
            try:
                os.remove(os.path.join(d, f))
            except OSError:
                pass


def quit_live_hard(log=print) -> None:
    """Beendet Live ohne Rückfrage. Nur für Sets, die Live Archiv selbst geöffnet hat
    (Rendern startet nur bei geschlossenem Live), deshalb geht nichts verloren."""
    if not live_is_running():
        return
    log("Schließe Live für das nächste Set …")
    subprocess.run(["pkill", "-9", "-x", LIVE_PROCESS], capture_output=True)
    for _ in range(40):
        if not live_is_running():
            break
        time.sleep(0.5)
    time.sleep(1)
    _clear_crash_markers()


def open_in_live(als_path: str, app_name: str, attempt: int = 0) -> None:
    if attempt % 2 == 0:
        subprocess.run(["open", "-a", app_name, als_path], check=True)
    else:  # zweiter Weg, falls Live das erste Öffnen verschluckt hat
        esc = als_path.replace("\\", "\\\\").replace('"', '\\"')
        _osa(f'tell application "{app_name}" to open (POSIX file "{esc}")', timeout=30)


def render_set(als_path: str, out_dir: str, out_name: str, app_name: str = "Ableton Live 12 Suite",
               load_timeout: int = 180, render_timeout: int = 900, start_timeout: int = 150, log=print) -> str:
    """Öffnet das Set in Live, exportiert es und gibt den Pfad zur MP3 zurück."""
    os.makedirs(out_dir, exist_ok=True)
    set_name = os.path.splitext(os.path.basename(als_path))[0]
    for old in glob.glob(os.path.join(out_dir, out_name + ".*")):
        os.remove(old)

    if not os.path.isfile(als_path):
        raise FileNotFoundError(f"Datei nicht gefunden: {als_path}. Übersprungen, bitte neu scannen.")
    # Live vor jedem Set frisch starten: so gibt es nie "Save changes …?" und kein Untitled dazwischen.
    quit_live_hard(log)
    # Heißt das Set wie das, was Live schon zeigt (z. B. "Untitled"), reicht der Fenstertitel nicht:
    # dann zählt die Datei hinter dem Fenster, oder mindestens ein Titelwechsel bzw. 15 s Ladezeit.
    ambiguous = _title_is(set_name, _front_window_title())
    log(f"Öffne {set_name} in Live …")
    open_in_live(als_path, app_name)
    title_changed = False
    t0 = time.time()
    next_note = 20
    reopen_at, attempt = 75, 0  # Kaltstart von Live mit Plug-ins dauert
    title = ""
    while time.time() - t0 < load_timeout:
        _dismiss_save_dialog()
        title = _front_window_title()
        titles = _window_titles()
        if title and title not in titles:
            titles.append(title)
        if any(_title_is(set_name, t) for t in titles):
            title = next(t for t in titles if _title_is(set_name, t))
        waited = time.time() - t0
        doc = _front_document()
        if _doc_is(als_path, doc):
            break
        if _title_is(set_name, title):
            if not ambiguous or title_changed or (not doc and waited >= 15):
                break
        elif title:
            title_changed = True
        if waited >= reopen_at:  # Live hat die Datei nicht übernommen: erneut schicken
            attempt += 1
            try:
                open_in_live(als_path, app_name, attempt)
            except Exception:
                pass
            reopen_at += 45
        if waited >= next_note:
            log(f"Warte auf {set_name} ({int(waited)} s) … Live zeigt gerade „{title or 'kein Fenster'}“")
            next_note += 20
        time.sleep(1.5)
    else:
        raise TimeoutError(f"Set wurde nicht geladen, Live zeigt „{title}“. Übersprungen.")
    time.sleep(4)  # Plug-ins/Samples fertig laden lassen

    _raise_set_window(set_name)
    time.sleep(0.5)
    log("Export-Dialog …")
    esc_dir = out_dir.replace('"', '\\"')
    esc_name = out_name.replace('"', '\\"')
    script = f'''
    tell application "{app_name}" to activate
    delay 0.6
    tell application "System Events" to tell process "{LIVE_PROCESS}"
        keystroke "r" using {{command down, shift down}}
        delay 1.5
        key code 36 -- Enter: Export im Live-Dialog bestätigen
        delay 1.5
        keystroke "a" using {{command down}}
        keystroke "{esc_name}"
        delay 0.3
        keystroke "g" using {{command down, shift down}}
        delay 0.8
        keystroke "{esc_dir}"
        delay 0.5
        key code 36
        delay 0.8
        key code 36 -- Sichern
        delay 0.8
        -- Falls "Ersetzen?" gefragt wird
        try
            repeat with b in (buttons of front window)
                if name of b is in {{"Replace", "Ersetzen"}} then click b
            end repeat
        end try
    end tell'''
    _osa(script, timeout=60)

    log("Rendere …")
    t0 = time.time()
    last_size, stable = -1, 0
    target = None
    while time.time() - t0 < render_timeout:
        if target is None and time.time() - t0 > start_timeout:
            raise TimeoutError("Export ist nicht gestartet (evtl. Video im Set oder ein Live-Dialog). Übersprungen.")
        mp3s = glob.glob(os.path.join(out_dir, out_name + "*.mp3"))
        wavs = glob.glob(os.path.join(out_dir, out_name + "*.wav")) + glob.glob(os.path.join(out_dir, out_name + "*.aif*"))
        cand = mp3s or wavs
        if cand:
            target = cand[0]
            size = os.path.getsize(target)
            stable = stable + 1 if size == last_size and size > 0 else 0
            last_size = size
            if stable >= 3 and (mp3s or not wavs):
                break
            if stable >= 3 and wavs and not mp3s:
                break
        time.sleep(2)
    else:
        raise TimeoutError("Rendern hat zu lange gedauert")

    if target and not target.lower().endswith(".mp3"):
        target = _to_mp3(target)
    final = os.path.join(out_dir, out_name + ".mp3")
    if target != final:
        shutil.move(target, final)
    for extra in glob.glob(os.path.join(out_dir, out_name + "*.wav")):
        os.remove(extra)
    for _ in range(3):  # Live fragt nach dem Export oft nach dem Sichern
        time.sleep(1)
        if _dismiss_save_dialog() == "clicked":
            break
    log("Fertig gerendert.")
    return final


def _to_mp3(src: str) -> str:
    ffmpeg = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
    if not os.path.exists(ffmpeg):
        raise RuntimeError("Live hat kein MP3 erzeugt und ffmpeg fehlt. Aktiviere 'MP3 kodieren' im Export-Dialog "
                           "oder installiere ffmpeg (brew install ffmpeg).")
    dst = os.path.splitext(src)[0] + ".mp3"
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", src, "-b:a", "256k", dst], check=True)
    os.remove(src)
    return dst


if __name__ == "__main__":  # Test: bei offenem Sichern-Dialog  ./.venv/bin/python -m core.renderer
    print("Dialog:", _find_save_dialog())
    print("Ergebnis:", _dismiss_save_dialog())

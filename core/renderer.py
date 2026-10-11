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


def _dismiss_save_dialog() -> str:
    """Beantwortet Lives Frage "Änderungen sichern?" mit 'Don’t Save'.

    Live zeichnet seine Dialoge selbst, die Knöpfe sind für macOS oft unsichtbar. Darum zuerst
    echte Knöpfe suchen, sonst das kleine Dialogfenster ohne Titel finden und auf die Stelle klicken,
    an der Live 'Don’t Save' immer zeichnet (links unten). Sicher, weil Live Archiv nur rendert,
    wenn Live vorher geschlossen war: jede Frage betrifft also ein Set, das das Tool selbst geöffnet hat.
    """
    script = f'''
    tell application "System Events" to tell process "{LIVE_PROCESS}"
        repeat with w in windows
            repeat with b in (buttons of w)
                set n to ""
                try
                    set n to (name of b) as text
                end try
                if (n starts with "Don" and n contains "Save") or n contains "Nicht sichern" or n contains "Nicht speichern" then
                    click b
                    return "clicked"
                end if
            end repeat
        end repeat
        repeat with w in windows
            set t to ""
            try
                set t to (name of w) as text
            end try
            set {{wx, wy}} to position of w
            set {{ww, wh}} to size of w
            if t is "" and ww > 400 and ww < 950 and wh > 120 and wh < 330 then
                set frontmost to true
                delay 0.2
                click at {{(wx + ww * 0.15) as integer, (wy + wh * 0.8) as integer}}
                return "clicked"
            end if
        end repeat
    end tell
    return "none"'''
    try:
        return _osa(script, timeout=10)
    except Exception:
        return "error"


def live_is_running() -> bool:
    res = subprocess.run(["pgrep", "-x", LIVE_PROCESS], capture_output=True)
    return res.returncode == 0


def open_in_live(als_path: str, app_name: str, attempt: int = 0) -> None:
    if attempt % 2 == 0:
        subprocess.run(["open", "-a", app_name, als_path], check=True)
    else:  # zweiter Weg, falls Live das erste Öffnen verschluckt hat
        esc = als_path.replace("\\", "\\\\").replace('"', '\\"')
        _osa(f'tell application "{app_name}" to open (POSIX file "{esc}")', timeout=30)


def render_set(als_path: str, out_dir: str, out_name: str, app_name: str = "Ableton Live 12 Suite",
               load_timeout: int = 120, render_timeout: int = 900, log=print) -> str:
    """Öffnet das Set in Live, exportiert es und gibt den Pfad zur MP3 zurück."""
    os.makedirs(out_dir, exist_ok=True)
    set_name = os.path.splitext(os.path.basename(als_path))[0]
    for old in glob.glob(os.path.join(out_dir, out_name + ".*")):
        os.remove(old)

    if not os.path.isfile(als_path):
        raise FileNotFoundError(f"Datei nicht gefunden: {als_path}. Übersprungen, bitte neu scannen.")
    # Heißt das Set wie das, was Live schon zeigt (z. B. "Untitled"), reicht der Fenstertitel nicht:
    # dann zählt die Datei hinter dem Fenster, oder mindestens ein Titelwechsel bzw. 15 s Ladezeit.
    ambiguous = _title_is(set_name, _front_window_title())
    log(f"Öffne {set_name} in Live …")
    open_in_live(als_path, app_name)
    title_changed = False
    t0 = time.time()
    next_note = 20
    reopen_at, attempt = 25, 0
    title = ""
    while time.time() - t0 < load_timeout:
        _dismiss_save_dialog()
        title = _front_window_title()
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
            reopen_at += 30
        if waited >= next_note:
            log(f"Warte auf {set_name} ({int(waited)} s) … Live zeigt gerade „{title or 'kein Fenster'}“")
            next_note += 20
        time.sleep(1.5)
    else:
        raise TimeoutError(f"Set wurde nicht geladen, Live zeigt „{title}“. Übersprungen.")
    time.sleep(4)  # Plug-ins/Samples fertig laden lassen

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

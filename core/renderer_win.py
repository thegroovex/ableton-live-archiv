"""Automatischer Export über Ableton Live 12 unter Windows.

Gleicher Ablauf wie auf macOS (core/renderer.py), nur mit Win32 statt AppleScript:
  * Live wird mit dem Set gestartet (Live.exe <set.als> bzw. Dateizuordnung).
  * Fenster werden über user32 gefunden, Tasten per SendInput (Unicode, also auch Umlaute) geschickt.
  * Zwischen zwei Sets wird Live hart beendet. Das ist sicher, weil Rendern nur bei geschlossenem
    Live startet: jedes offene Set hat Live Archiv selbst geöffnet.

Einmalig in Live: "Audio/Video exportieren" (Strg+Shift+R) öffnen, Gerenderte Spur "Main",
ganzes Arrangement, "MP3 kodieren" an. Live merkt sich das.
"""
from __future__ import annotations

import glob
import os
import shutil
import subprocess
import sys
import time
import unicodedata

IS_WIN = sys.platform == "win32"


def _n(text: str) -> str:
    return unicodedata.normalize("NFC", text or "").casefold()


# ---------------------------------------------------------------- Prozesse
def _live_procs():
    """Laufende Live-Prozesse (Ableton Live 12 Suite.exe, … Standard.exe, … Intro.exe)."""
    try:
        import psutil
    except ImportError:
        return []
    out = []
    for p in psutil.process_iter(["name", "pid"]):
        name = (p.info.get("name") or "").lower()
        if name.startswith("ableton live") and name.endswith(".exe"):
            out.append(p)
    return out


def live_is_running() -> bool:
    return bool(_live_procs())


def _live_pids() -> set[int]:
    return {p.pid for p in _live_procs()}


def _live_cpu() -> float:
    total = 0.0
    for p in _live_procs():
        try:
            total += p.cpu_percent(interval=0.3)
        except Exception:
            pass
    return total


def find_live_exe(app_name: str) -> str | None:
    """Sucht die Live-EXE in den Standard-Installationsorten."""
    bases = [os.environ.get("PROGRAMDATA", r"C:\ProgramData"), os.environ.get("PROGRAMFILES", r"C:\Program Files")]
    for base in bases:
        for pattern in (os.path.join(base, "Ableton", app_name, "Program", app_name + ".exe"),
                        os.path.join(base, "Ableton", "Live 12*", "Program", "Ableton Live 12*.exe")):
            hits = sorted(glob.glob(pattern))
            if hits:
                return hits[-1]
    return None


def open_in_live(als_path: str, app_name: str, attempt: int = 0) -> None:
    exe = find_live_exe(app_name)
    if exe and attempt % 2 == 0:
        subprocess.Popen([exe, os.path.normpath(als_path)])
    elif IS_WIN:
        os.startfile(os.path.normpath(als_path))  # Dateizuordnung .als → Live
    else:
        raise RuntimeError("Ableton Live wurde nicht gefunden.")


def _clear_crash_markers() -> None:
    """Damit Live nach dem harten Beenden nicht 'Wiederherstellen?' fragt."""
    base = os.path.join(os.environ.get("APPDATA", ""), "Ableton")
    for d in glob.glob(os.path.join(base, "Live 12*", "Preferences")):
        for f in ("CrashDetection.cfg", "CrashRecoveryInfo.cfg"):
            try:
                os.remove(os.path.join(d, f))
            except OSError:
                pass


def quit_live_hard(log=print) -> None:
    procs = _live_procs()
    if not procs:
        return
    log("Schließe Live für das nächste Set …")
    for p in procs:
        try:
            p.kill()
        except Exception:
            pass
    for _ in range(40):
        if not live_is_running():
            break
        time.sleep(0.5)
    time.sleep(1)
    _clear_crash_markers()


# ---------------------------------------------------------------- Fenster und Tastatur (user32)
if IS_WIN:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    INPUT_KEYBOARD, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE = 1, 0x0002, 0x0004

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                    ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                    ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]

    class _U(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT)]

    class INPUT(ctypes.Structure):
        _fields_ = [("type", wintypes.DWORD), ("u", _U)]


def _windows(pids: set[int] | None = None) -> list[tuple[int, str, str]]:
    """Sichtbare Top-Level-Fenster der Live-Prozesse: (hwnd, Titel, Fensterklasse)."""
    if not IS_WIN:
        return []
    pids = pids if pids is not None else _live_pids()
    found = []

    def cb(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids:
            buf = ctypes.create_unicode_buffer(512)
            user32.GetWindowTextW(hwnd, buf, 512)
            cls = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(hwnd, cls, 256)
            found.append((hwnd, buf.value, cls.value))
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return found


def _window_titles() -> list[str]:
    return [t for _, t, _ in _windows() if t]


def _window_count() -> int:
    return len(_windows())


def _file_dialog() -> int | None:
    """Der Windows-Speichern-Dialog hat die Fensterklasse #32770."""
    for hwnd, _, cls in _windows():
        if cls == "#32770":
            return hwnd
    return None


def _focus(hwnd: int) -> None:
    if not IS_WIN:
        return
    # Windows lässt SetForegroundWindow nur zu, wenn gerade eine Taste gedrückt wurde: Alt antippen.
    _key(0x12, up=False); _key(0x12, up=True)
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.3)


def _raise_set_window(set_name: str) -> None:
    for hwnd, title, _ in _windows():
        if _title_is(set_name, title):
            _focus(hwnd); return
    wins = _windows()
    if wins:
        _focus(wins[0][0])


def _send(inputs) -> None:
    arr = (INPUT * len(inputs))(*inputs)
    user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT))


def _key(vk: int, up: bool = False) -> None:
    if not IS_WIN:
        return
    _send([INPUT(type=INPUT_KEYBOARD, u=_U(ki=KEYBDINPUT(wVk=vk, dwFlags=KEYEVENTF_KEYUP if up else 0)))])


def _combo(*vks: int) -> None:
    for vk in vks:
        _key(vk)
    time.sleep(0.05)
    for vk in reversed(vks):
        _key(vk, up=True)
    time.sleep(0.1)


def _type(text: str) -> None:
    """Tippt beliebigen Text inkl. Umlaute (KEYEVENTF_UNICODE, unabhängig vom Tastaturlayout)."""
    if not IS_WIN:
        return
    for ch in text:
        code = ord(ch)
        _send([INPUT(type=INPUT_KEYBOARD, u=_U(ki=KEYBDINPUT(wScan=code, dwFlags=KEYEVENTF_UNICODE))),
               INPUT(type=INPUT_KEYBOARD, u=_U(ki=KEYBDINPUT(wScan=code, dwFlags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)))])
        time.sleep(0.01)


VK_RETURN, VK_CONTROL, VK_SHIFT, VK_MENU, VK_A, VK_R = 0x0D, 0x11, 0x10, 0x12, 0x41, 0x52


def _title_is(set_name: str, title: str) -> bool:
    """Live zeigt unter Windows z. B. 'Song - Ableton Live 12 Suite' oder 'Song* [C:\\…] - Ableton Live 12'."""
    t = _n(title).strip()
    t = t.split(" - ableton")[0].split(" [")[0].strip().rstrip("*").strip()
    return t == _n(set_name)


def _wait_until_idle(log=print, max_wait: int = 45) -> None:
    time.sleep(3)
    calm, t0 = 0, time.time()
    while time.time() - t0 < max_wait:
        calm = calm + 1 if _live_cpu() < 60 else 0
        if calm >= 2:
            return
        time.sleep(1.5)
    log("Live ist noch beschäftigt, versuche den Export trotzdem …")


# ---------------------------------------------------------------- Rendern
def render_set(als_path: str, out_dir: str, out_name: str, app_name: str = "Ableton Live 12 Suite",
               load_timeout: int = 180, render_timeout: int = 900, start_timeout: int = 150, log=print) -> str:
    """Öffnet das Set in Live, exportiert es und gibt den Pfad zur MP3 zurück."""
    os.makedirs(out_dir, exist_ok=True)
    set_name = os.path.splitext(os.path.basename(als_path))[0]
    for old in glob.glob(os.path.join(out_dir, out_name + ".*")):
        os.remove(old)
    if not os.path.isfile(als_path):
        raise FileNotFoundError(f"Datei nicht gefunden: {als_path}. Übersprungen, bitte neu scannen.")

    quit_live_hard(log)  # Windows: immer frisch starten, keine "Änderungen speichern?"-Frage
    log(f"Öffne {set_name} in Live …")
    open_in_live(als_path, app_name)
    t0, reopen_at, attempt, title = time.time(), 75, 0, ""
    next_note = 20
    while time.time() - t0 < load_timeout:
        titles = _window_titles()
        hit = next((t for t in titles if _title_is(set_name, t)), None)
        if hit:
            title = hit; break
        title = titles[0] if titles else ""
        waited = time.time() - t0
        if waited >= reopen_at:
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
    _wait_until_idle(log)

    log("Export-Dialog …")
    opened = False
    for attempt in range(3):
        _raise_set_window(set_name)
        before = _window_count()
        _combo(VK_CONTROL, VK_SHIFT, VK_R)
        for _ in range(12):
            time.sleep(0.5)
            if _window_count() > before:
                opened = True; break
        if opened:
            break
        log(f"Export-Dialog ging nicht auf, neuer Versuch ({attempt + 2}/3) …")
        time.sleep(3)
    if not opened:
        raise TimeoutError("Live hat den Export-Dialog nicht geöffnet. Übersprungen.")
    time.sleep(0.5)
    _combo(VK_RETURN)  # Export im Live-Dialog bestätigen
    dlg = None
    for _ in range(20):
        time.sleep(0.5)
        dlg = _file_dialog()
        if dlg:
            break
    if not dlg:
        raise TimeoutError("Der Speichern-Dialog ist nicht erschienen. Übersprungen.")
    _focus(dlg)
    _combo(VK_CONTROL, VK_A)
    _type(os.path.join(os.path.normpath(out_dir), out_name))  # voller Pfad im Dateinamenfeld
    time.sleep(0.3)
    _combo(VK_RETURN)

    log("Rendere …")
    t0, last_size, stable, target = time.time(), -1, 0, None
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
            if stable >= 3:
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
    log("Fertig gerendert.")
    return final


def _to_mp3(src: str) -> str:
    from core.platform_util import ffmpeg_path, ffmpeg_hint
    ffmpeg = ffmpeg_path()
    if not ffmpeg:
        raise RuntimeError("Live hat kein MP3 erzeugt und ffmpeg fehlt. Aktiviere 'MP3 kodieren' im Export-Dialog "
                           f"oder installiere ffmpeg ({ffmpeg_hint()}).")
    dst = os.path.splitext(src)[0] + ".mp3"
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", src, "-b:a", "256k", dst], check=True)
    os.remove(src)
    return dst

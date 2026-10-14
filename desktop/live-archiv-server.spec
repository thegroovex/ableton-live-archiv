# PyInstaller-Rezept für den Python-Server der Standalone-App.
# Bauen (im Ordner desktop/):  pyinstaller --noconfirm --workpath pyi-work live-archiv-server.spec
# Ergebnis: dist/live-archiv-server/  (Ordner mit Binary, wird von electron-builder ins App-Paket gelegt)
import os
from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))

datas = [(os.path.join(ROOT, "static"), "static")]
binaries = []
hiddenimports = collect_submodules("core") + ["app", "soundfile", "audioread"]
for pkg in ("librosa", "mutagen", "lazy_loader", "soxr", "_soundfile_data"):
    try:
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hiddenimports += h
    except Exception:
        pass

a = Analysis(
    [os.path.join(SPECPATH, "server_entry.py")],
    pathex=[ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "matplotlib", "IPython", "pytest", "PyQt5", "PyQt6", "PySide6"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="live-archiv-server",
    console=True,          # kein eigenes Fenster: die Electron-Hülle startet den Prozess unsichtbar
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="live-archiv-server")

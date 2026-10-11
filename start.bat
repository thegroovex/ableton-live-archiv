@echo off
REM Doppelklick im Explorer startet Live Archiv (Windows)
cd /d "%~dp0"
if not exist .venv (
  echo Erster Start: richte Python-Umgebung ein ...
  py -3 -m venv .venv || python -m venv .venv
  .venv\Scripts\python -m pip install -q -r requirements.txt
)
.venv\Scripts\python app.py
pause

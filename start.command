#!/bin/bash
# Doppelklick im Finder startet Live Archiv
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "Erster Start: richte Python-Umgebung ein …"
  python3 -m venv .venv && ./.venv/bin/pip install -q -r requirements.txt
fi
./.venv/bin/python app.py

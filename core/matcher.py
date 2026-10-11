"""Ordnet bereits exportierte Audiodateien (z. B. „Song.mp3“ neben „Song Project“) einem Live-Set zu."""
from __future__ import annotations

import os
import re

AUDIO_EXT = (".mp3", ".wav", ".aif", ".aiff", ".flac", ".m4a")
EXT_RANK = {e: i for i, e in enumerate(AUDIO_EXT)}  # MP3 bevorzugt


def norm(name: str) -> str:
    n = re.sub(r"\s+project$", "", name.lower().strip())
    while True:  # „Song.mp3.asd“, „Song.als“ → „song“
        base, ext = os.path.splitext(n)
        if ext in AUDIO_EXT + (".asd", ".als") and base:
            n = base
        else:
            break
    return re.sub(r"[^0-9a-zäöüß]+", "", n)


def _audio_in(folder: str) -> list[str]:
    try:
        return [os.path.join(folder, f) for f in os.listdir(folder)
                if f.lower().endswith(AUDIO_EXT) and not f.startswith(".")]
    except OSError:
        return []


def find_existing_audio(als_path: str) -> str | None:
    set_dir = os.path.dirname(als_path)
    parent = os.path.dirname(set_dir)
    names = [norm(os.path.basename(als_path))]
    # Projektordnername nur, wenn der Ordner genau ein Set enthält (sonst Verwechslungsgefahr)
    try:
        sets_here = [f for f in os.listdir(set_dir) if f.lower().endswith(".als") and not f.startswith("._")]
    except OSError:
        sets_here = []
    if len(sets_here) == 1:
        names.append(norm(os.path.basename(set_dir)))
    names = [n for n in names if n]
    candidates = []
    for folder in dict.fromkeys([set_dir, parent]):
        candidates += _audio_in(folder)
    for n in names:  # Set-Name zuerst, dann Ordnername
        hits = [c for c in candidates if norm(os.path.basename(c)) == n]
        if hits:
            hits.sort(key=lambda c: (EXT_RANK.get(os.path.splitext(c)[1].lower(), 9), -os.path.getmtime(c)))
            return hits[0]
    return None

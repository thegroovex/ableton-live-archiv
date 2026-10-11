"""Heuristik: fertiger Track oder Skizze?"""
from __future__ import annotations

import re

FINISHED_WORDS = re.compile(r"(final|master|mixdown|release|fertig|v\d+_final)", re.I)
SKETCH_WORDS = re.compile(r"(idea|idee|skizze|sketch|demo|untitled|loop|jam|test|wip)", re.I)


def status_score(info: dict) -> tuple[str, int, list[str]]:
    """Gibt (Status, Punkte, Gründe) zurück. Ab 4 Punkten gilt ein Set als fertig."""
    score, why = 0, []
    length = info.get("length_sec") or 0
    if length >= 150:
        score += 2; why.append("Arrangement über 2:30")
    elif length >= 90:
        score += 1; why.append("Arrangement über 1:30")
    if (info.get("clips_arrangement") or 0) >= 12:
        score += 1; why.append("viele Clips im Arrangement")
    tracks = sum(info.get(k) or 0 for k in ("tracks_audio", "tracks_midi"))
    if tracks >= 8:
        score += 1; why.append(f"{tracks} Spuren")
    if (info.get("automation_count") or 0) >= 5:
        score += 1; why.append("Automationen vorhanden")
    name = info.get("name") or ""
    if FINISHED_WORDS.search(name):
        score += 2; why.append("Name klingt nach fertig")
    if SKETCH_WORDS.search(name):
        score -= 2; why.append("Name klingt nach Skizze")
    if (info.get("clips_arrangement") or 0) == 0 and (info.get("clips_session") or 0) > 0:
        score -= 2; why.append("nur Session-Clips")
    return ("Fertig" if score >= 4 else "Skizze"), score, why

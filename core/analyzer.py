"""Audio-Analyse eines gerenderten MP3: Tonart, Tempo, Energie, Stimmung, Genre-Vorschlag."""
from __future__ import annotations

import numpy as np

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Schmuckler-Profile
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def analyze_audio(path: str, max_seconds: float = 120.0) -> dict:
    import warnings
    with warnings.catch_warnings():  # librosa/numpy-Hinweise nicht ins Terminal schreiben
        warnings.simplefilter("ignore")
        with np.errstate(all="ignore"):
            return _analyze(path, max_seconds)


def _analyze(path: str, max_seconds: float) -> dict:
    import os
    import librosa  # erst hier laden, Start bleibt schnell

    duration = librosa.get_duration(path=path)
    offset = max(0.0, (duration - max_seconds) / 2) if duration > max_seconds else 0.0
    y, sr = librosa.load(path, sr=22050, mono=True, offset=offset, duration=max_seconds)
    name = os.path.basename(path)
    if y.size < sr * 3:
        return {"error": f"{name}: zu kurz für eine Analyse (unter 3 s), übersprungen"}
    if float(np.sqrt(np.mean(y ** 2))) < 1e-4:
        return {"error": f"{name}: stumm, übersprungen"}

    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    tempo = float(np.atleast_1d(tempo)[0])
    grid_offset = 0.0
    if len(beats) and tempo > 0:
        period = 60.0 / tempo
        t0 = offset + float(librosa.frames_to_time(beats[0], sr=sr))
        grid_offset = round(t0 % period, 4)

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    best = (-2.0, "C", "Dur")
    for i in range(12):
        for profile, mode in ((MAJOR, "Dur"), (MINOR, "Moll")):
            r = float(np.corrcoef(np.roll(profile, i), chroma)[0, 1])
            if np.isfinite(r) and r > best[0]:
                best = (r, NOTE_NAMES[i], mode)

    rms = float(np.sqrt(np.mean(y ** 2)))
    loudness_db = 20 * np.log10(rms + 1e-9)
    centroid = float(librosa.feature.spectral_centroid(y=y, sr=sr).mean())
    onsets = librosa.onset.onset_detect(y=y, sr=sr)
    onset_rate = len(onsets) / (len(y) / sr)

    # Energie 0..1 aus Lautheit und Ereignisdichte
    energy = float(np.clip((loudness_db + 30) / 22, 0, 1) * 0.6 + np.clip(onset_rate / 6, 0, 1) * 0.4)
    brightness = float(np.clip((centroid - 1000) / 3000, 0, 1))

    return {
        "duration": round(duration, 1),
        "tempo_audio": round(tempo, 1),
        "grid_offset": grid_offset,
        "key_root": best[1],
        "key_mode": best[2],
        "key_confidence": round(best[0], 2),
        "energy": round(energy, 2),
        "brightness": round(brightness, 2),
        "onset_rate": round(onset_rate, 2),
        "mood": guess_mood(energy, brightness, best[2]),
    }


def guess_mood(energy: float, brightness: float, mode: str | None) -> str:
    bright = brightness > 0.45 or mode == "Dur"
    if energy >= 0.55:
        return "Euphorisch" if bright else "Dunkel & treibend"
    if energy >= 0.35:
        return "Groovy" if bright else "Melancholisch"
    return "Entspannt" if bright else "Atmosphärisch"


def guess_genre(tempo: float | None, energy: float | None, onset_rate: float | None = None) -> str:
    if not tempo:
        return "Unbekannt"
    e = energy if energy is not None else 0.5
    if onset_rate is not None and onset_rate < 1.0 and e < 0.35:
        return "Ambient"
    if tempo < 90:
        return "Hip-Hop / Lo-Fi" if e >= 0.3 else "Downtempo"
    if tempo < 115:
        return "Downtempo / Pop" if e < 0.5 else "Nu-Disco / Funk"
    if tempo < 126:
        return "Deep House" if e < 0.55 else "House"
    if tempo < 132:
        return "Tech House" if e < 0.6 else "Techno"
    if tempo < 145:
        return "Techno" if e >= 0.5 else "Trance / Progressive"
    if tempo < 165:
        return "Dubstep / Trap" if e >= 0.5 else "Breaks"
    if tempo < 182:
        return "Drum & Bass"
    return "Hardcore / Footwork"

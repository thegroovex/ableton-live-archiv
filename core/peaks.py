"""Mini-Waveform wie in Rekordbox: Lautstärke pro Abschnitt plus Anteil von Bässen, Mitten und Höhen.

Wird einmal pro Audiodatei berechnet und als kleine JSON-Datei zwischengespeichert.
"""
from __future__ import annotations

import json
import os

BINS = 160


def compute(path: str, bins: int = BINS) -> dict:
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        import numpy as np
        import librosa

        y, sr = librosa.load(path, sr=11025, mono=True)
        if y.size < sr // 2:
            return {"amp": [], "low": [], "mid": [], "high": [], "duration": float(y.size / sr)}
        n_fft, hop = 1024, 256
        spec = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop)) ** 2
        freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
        bands = [spec[freqs < 200].sum(0), spec[(freqs >= 200) & (freqs < 2000)].sum(0), spec[freqs >= 2000].sum(0)]
        frames = spec.shape[1]
        edges = np.linspace(0, frames, bins + 1).astype(int)
        amp, low, mid, high = [], [], [], []
        rms = librosa.feature.rms(y=y, frame_length=n_fft, hop_length=hop)[0][:frames]
        for a, b in zip(edges[:-1], edges[1:]):
            b = max(b, a + 1)
            amp.append(float(rms[a:b].max()) if rms[a:b].size else 0.0)
            e = [float(np.sqrt(x[a:b].mean())) if x[a:b].size else 0.0 for x in bands]
            s = sum(e) or 1.0
            low.append(e[0] / s); mid.append(e[1] / s); high.append(e[2] / s)
        peak = max(amp) or 1.0
        r = lambda v: [round(x, 3) for x in v]
        return {"amp": r([x / peak for x in amp]), "low": r(low), "mid": r(mid), "high": r(high),
                "duration": float(y.size / sr)}


def cached(path: str, cache_dir: str, key: str) -> dict:
    """Liest die Waveform aus dem Cache oder berechnet sie neu, wenn sich die Audiodatei geändert hat."""
    os.makedirs(cache_dir, exist_ok=True)
    cache = os.path.join(cache_dir, f"{key}.json")
    mtime = os.path.getmtime(path)
    if os.path.exists(cache):
        try:
            with open(cache, encoding="utf-8") as fh:
                data = json.load(fh)
            if data.get("src_mtime") == mtime and data.get("src") == path:
                return data
        except (OSError, ValueError):
            pass
    data = compute(path)
    data.update(src=path, src_mtime=mtime)
    with open(cache, "w", encoding="utf-8") as fh:
        json.dump(data, fh)
    return data

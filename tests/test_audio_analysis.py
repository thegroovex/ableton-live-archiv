"""Echte Audio-Analyse mit librosa auf synthetischen Tracks."""
import pytest

from tests.conftest import write_tone

librosa = pytest.importorskip("librosa")
from core.analyzer import analyze_audio  # noqa: E402


def test_detects_a_minor_and_tempo(tmp_path):
    f = write_tone(str(tmp_path / "am.wav"), freqs=(220.0, 261.63, 329.63), bpm=124, seconds=15)
    a = analyze_audio(f)
    assert a["key_root"] == "A" and a["key_mode"] == "Moll"
    # Beat-Tracker darf auf halbes/doppeltes Tempo fallen
    assert any(abs(a["tempo_audio"] * m - 124) < 4 for m in (0.5, 1, 2))
    assert 0 <= a["energy"] <= 1 and a["mood"]
    assert 0 <= a["grid_offset"] < 60 / 60


def test_detects_c_major(tmp_path):
    f = write_tone(str(tmp_path / "c.wav"), freqs=(261.63, 329.63, 392.0), bpm=100, seconds=12)
    a = analyze_audio(f)
    assert (a["key_root"], a["key_mode"]) == ("C", "Dur")

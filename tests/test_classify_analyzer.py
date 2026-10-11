import pytest

from core.classify import status_score
from core.analyzer import guess_genre, guess_mood


def test_finished_track():
    st, score, why = status_score(dict(name="Nachtfahrt", length_sec=320, clips_arrangement=40,
                                       tracks_audio=6, tracks_midi=8, automation_count=20))
    assert st == "Fertig" and score >= 4 and why


def test_sketch_track():
    st, *_ = status_score(dict(name="idea 3", length_sec=30, clips_arrangement=2, tracks_audio=1, tracks_midi=2))
    assert st == "Skizze"
    st, *_ = status_score(dict(name="Groove", clips_arrangement=0, clips_session=12, tracks_midi=10, automation_count=9))
    assert st == "Skizze"


def test_name_hint_final():
    st, *_ = status_score(dict(name="Sunrise FINAL master", length_sec=200))
    assert st == "Fertig"


@pytest.mark.parametrize("bpm,energy,expected", [
    (85, 0.5, "Hip-Hop / Lo-Fi"), (122, 0.4, "Deep House"), (124, 0.7, "House"),
    (130, 0.7, "Techno"), (140, 0.3, "Trance / Progressive"), (174, 0.8, "Drum & Bass"), (None, 0.5, "Unbekannt"),
])
def test_genre_guess(bpm, energy, expected):
    assert guess_genre(bpm, energy) == expected


def test_ambient_detection():
    assert guess_genre(100, 0.2, onset_rate=0.3) == "Ambient"


def test_mood_quadrants():
    assert guess_mood(0.8, 0.7, "Dur") == "Euphorisch"
    assert guess_mood(0.8, 0.1, "Moll") == "Dunkel & treibend"
    assert guess_mood(0.2, 0.1, "Moll") == "Atmosphärisch"

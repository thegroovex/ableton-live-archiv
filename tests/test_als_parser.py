import gzip
import os

from core.als_parser import parse_set, find_sets, set_tempo_and_key, _decode_timesig


def test_parses_tempo_key_tracks(tmp_path, make_set):
    p = make_set(str(tmp_path / "Song Project" / "Song.als"), tempo=126.5, root=9, scale="Minor")
    info = parse_set(p)
    assert info.error is None
    assert info.tempo == 126.5
    assert info.key_root == "A" and info.key_mode == "Moll"
    assert (info.tracks_audio, info.tracks_midi, info.tracks_return) == (3, 5, 2)
    assert info.time_sig == "4/4"
    assert info.live_version.startswith("Ableton Live 12")


def test_arrangement_length_from_clips(tmp_path, make_set):
    # 14 Clips à 16 Beats = 224 Beats bei 120 BPM = 112 s
    p = make_set(str(tmp_path / "a.als"), tempo=120, arr_clips=14, clip_len_beats=16)
    info = parse_set(p)
    assert info.clips_arrangement == 14
    assert info.length_sec == 112.0


def test_major_key_and_out_of_key(tmp_path, make_set):
    assert parse_set(make_set(str(tmp_path / "m.als"), root=7, scale="Major")).key_mode == "Dur"
    assert parse_set(make_set(str(tmp_path / "c.als"), root=0, scale="Major")).key_root is None  # Live-Standard
    assert parse_set(make_set(str(tmp_path / "d.als"), root=2, scale="Dorian")).key_mode == "Moll"
    assert parse_set(make_set(str(tmp_path / "n.als"), in_key=False)).key_root is None


def test_older_master_track_tag(tmp_path, make_set):
    info = parse_set(make_set(str(tmp_path / "old.als"), tempo=90, main_tag="MasterTrack", creator="Ableton Live 10.1"))
    assert info.tempo == 90


def test_plugins_and_missing_samples(tmp_path, make_set):
    real = tmp_path / "kick.wav"
    real.write_bytes(b"x")
    p = make_set(str(tmp_path / "s.als"), samples=(str(real), "/nicht/da/snare.wav"))
    info = parse_set(p)
    assert info.plugins == ["Serum", "Valhalla VintageVerb"]
    assert info.samples_total == 2 and info.samples_missing == 1


def test_corrupt_file_reports_error(tmp_path):
    bad = tmp_path / "kaputt.als"
    bad.write_bytes(b"kein gzip")
    info = parse_set(str(bad))
    assert info.error and "nicht lesen" in info.error


def test_find_sets_skips_backups(tmp_path, make_set):
    make_set(str(tmp_path / "A Project" / "A.als"))
    make_set(str(tmp_path / "A Project" / "Backup" / "A [2024].als"))
    make_set(str(tmp_path / "B Project" / "B.als"))
    (tmp_path / "B Project" / "._B.als").write_bytes(b"")
    found = find_sets([str(tmp_path)])
    assert [os.path.basename(f) for f in found] == ["A.als", "B.als"]


def test_template_tempo_and_key_rewrite(tmp_path, make_set):
    src = make_set(str(tmp_path / "tpl.als"), tempo=120, root=0, scale="Major", in_key=False)
    dst = str(tmp_path / "Neu Project" / "Neu.als")
    set_tempo_and_key(src, dst, 128.0, "F#", "Moll")
    info = parse_set(dst)
    assert info.tempo == 128.0
    assert info.key_root == "F#" and info.key_mode == "Moll"
    with gzip.open(dst) as fh:
        assert b"<?xml" in fh.read(100)


def test_timesig_decoding():
    assert _decode_timesig("201") == "4/4"
    assert _decode_timesig("200") == "3/4"
    assert _decode_timesig("303") == "7/8"


def test_clean_path_handles_copied_paths(tmp_path, make_set):
    from core.als_parser import clean_path
    d = tmp_path / "Own Tracks"
    make_set(str(d / "A Project" / "A.als"))
    assert clean_path(str(tmp_path) + "/Own%20Tracks") == str(d)
    assert clean_path("file://" + str(tmp_path) + "/Own%20Tracks/") == str(d)
    assert clean_path('"' + str(d) + '"') == str(d)
    assert len(find_sets([str(tmp_path) + "/Own%20Tracks"])) == 1


def test_default_c_major_without_inkey_is_ignored(tmp_path):
    """Live speichert immer C-Dur als Standard. Ohne aktive Skala darf das nicht als Tonart gelten."""
    xml = ('<?xml version="1.0"?><Ableton Creator="Ableton Live 12.1"><LiveSet>'
           '<ScaleInformation><Root Value="0"/><Name Value="Major"/></ScaleInformation>'
           '<Tracks/></LiveSet></Ableton>')
    p = tmp_path / "d.als"
    with gzip.open(p, "wb") as fh:
        fh.write(xml.encode())
    assert parse_set(str(p)).key_root is None
    xml2 = xml.replace('Root Value="0"', 'Root Value="9"').replace('"Major"', '"Minor"')
    with gzip.open(p, "wb") as fh:
        fh.write(xml2.encode())
    assert parse_set(str(p)).key_root == "A"

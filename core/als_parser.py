"""Liest Ableton-Live-Sets (.als = gzip-komprimiertes XML) aus, ohne Live zu öffnen."""
from __future__ import annotations

import gzip
import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field, asdict

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Live 12 speichert Skalen teils als Name, teils als Index
SCALE_INDEX = {0: "Major", 1: "Minor"}
MINOR_LIKE = ("minor", "dorian", "phrygian", "aeolian", "locrian", "moll")


@dataclass
class SetInfo:
    path: str
    name: str
    live_version: str = ""
    tempo: float | None = None
    time_sig: str = ""
    key_root: str | None = None
    key_mode: str | None = None  # "Dur" / "Moll"
    scale_name: str | None = None
    tracks_audio: int = 0
    tracks_midi: int = 0
    tracks_group: int = 0
    tracks_return: int = 0
    clips_arrangement: int = 0
    clips_session: int = 0
    length_sec: float | None = None
    automation_count: int = 0
    plugins: list[str] = field(default_factory=list)
    samples_total: int = 0
    samples_missing: int = 0
    error: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def _val(el, path: str):
    if el is None:
        return None
    node = el.find(path)
    if node is None:
        return None
    return node.get("Value")


def _float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def load_xml(path: str) -> ET.Element:
    with gzip.open(path, "rb") as fh:
        data = fh.read()
    return ET.fromstring(data)


def parse_set(path: str) -> SetInfo:
    info = SetInfo(path=path, name=os.path.splitext(os.path.basename(path))[0])
    try:
        root = load_xml(path)
    except Exception as exc:  # beschädigt oder kein gzip
        info.error = f"Konnte Set nicht lesen: {exc}"
        return info

    info.live_version = root.get("Creator", "")
    live = root.find("LiveSet")
    if live is None:
        info.error = "Kein LiveSet gefunden"
        return info

    # Master-/Main-Spur (Live 12: MainTrack, ältere: MasterTrack)
    main = live.find("MainTrack")
    if main is None:
        main = live.find("MasterTrack")
    if main is not None:
        info.tempo = _float(_val(main, "DeviceChain/Mixer/Tempo/Manual"))
        num = _val(main, "DeviceChain/Mixer/TimeSignature/Manual")
        # TimeSignature wird als codierter Integer gespeichert; 4/4 ist am häufigsten
        if num is not None:
            info.time_sig = _decode_timesig(num)
    if info.tempo is not None:
        info.tempo = round(info.tempo, 2)

    # Tonart (Live 12 Skalen-Info)
    scale = live.find("ScaleInformation")
    if scale is not None:
        root_note = _val(scale, "RootNote") or _val(scale, "Root")
        name = _val(scale, "Name")
        in_key = _val(live, "InKey")
        if name is not None and name.isdigit():
            name = SCALE_INDEX.get(int(name), name)
        if root_note is not None and root_note.isdigit() and (in_key in (None, "true")):
            info.key_root = NOTE_NAMES[int(root_note) % 12]
            info.scale_name = name
            if name:
                info.key_mode = "Moll" if name.lower().startswith(MINOR_LIKE) else "Dur"

    tracks = live.find("Tracks")
    if tracks is not None:
        for t in tracks:
            if t.tag == "AudioTrack":
                info.tracks_audio += 1
            elif t.tag == "MidiTrack":
                info.tracks_midi += 1
            elif t.tag == "GroupTrack":
                info.tracks_group += 1
            elif t.tag == "ReturnTrack":
                info.tracks_return += 1
    rets = live.find("ReturnTracks")  # sehr alte Sets
    if rets is not None:
        info.tracks_return += len(list(rets))

    # Clips im Arrangement vs. Session
    end_beats = 0.0
    for events in live.iter("Events"):
        for clip in events:
            if clip.tag in ("AudioClip", "MidiClip"):
                info.clips_arrangement += 1
                end = _float(_val(clip, "CurrentEnd"))
                if end and end > end_beats:
                    end_beats = end
    for slot in live.iter("ClipSlot"):
        if slot.find(".//AudioClip") is not None or slot.find(".//MidiClip") is not None:
            info.clips_session += 1
    if end_beats and info.tempo:
        info.length_sec = round(end_beats * 60.0 / info.tempo, 1)

    info.automation_count = sum(1 for _ in live.iter("AutomationEnvelope"))

    plugins = set()
    for tag, sub in (("VstPluginInfo", "PlugName"), ("Vst3PluginInfo", "Name"), ("AuPluginInfo", "Name")):
        for p in live.iter(tag):
            n = _val(p, sub)
            if n:
                plugins.add(n)
    info.plugins = sorted(plugins)

    set_dir = os.path.dirname(path)
    seen = set()
    for ref in live.iter("FileRef"):
        p = _val(ref, "Path")
        rel = _val(ref, "RelativePath")
        key = p or rel
        if not key or key in seen:
            continue
        seen.add(key)
        info.samples_total += 1
        candidates = [c for c in (p, os.path.join(set_dir, rel) if rel else None) if c]
        if candidates and not any(os.path.exists(c) for c in candidates):
            info.samples_missing += 1
    return info


def _decode_timesig(raw: str) -> str:
    """Live speichert die Taktart als Index: (zaehler-1) + 99 * log2(nenner)."""
    try:
        v = int(float(raw))
    except ValueError:
        return ""
    import math
    den_exp, num = divmod(v, 99)
    return f"{num + 1}/{int(math.pow(2, den_exp))}"


def set_tempo_and_key(src: str, dst: str, tempo: float | None, key_root: str | None, mode: str | None) -> None:
    """Kopiert ein Template-Set und setzt Tempo und (Live 12) Skala."""
    with gzip.open(src, "rb") as fh:
        xml = fh.read().decode("utf-8")
    if tempo:
        xml = re.sub(
            r'(<Tempo>.*?<Manual Value=")[0-9.]+(")',
            lambda m: f"{m.group(1)}{tempo:g}{m.group(2)}",
            xml, count=1, flags=re.S,
        )
    if key_root and key_root in NOTE_NAMES:
        idx = NOTE_NAMES.index(key_root)
        xml = re.sub(r'(<ScaleInformation>\s*<RootNote Value=")\d+(")', rf"\g<1>{idx}\g<2>", xml, count=1)
        if mode:
            name = "Minor" if mode == "Moll" else "Major"
            xml = re.sub(r'(<ScaleInformation>.*?<Name Value=")[^"]*(")', rf"\g<1>{name}\g<2>", xml, count=1, flags=re.S)
        xml = re.sub(r'<InKey Value="false"', '<InKey Value="true"', xml, count=1)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with gzip.open(dst, "wb") as fh:
        fh.write(xml.encode("utf-8"))


def clean_path(p: str) -> str:
    """Macht kopierte Pfade nutzbar: file://-URLs, %20, Anführungszeichen, \\-Leerzeichen, ~."""
    from urllib.parse import unquote
    p = (p or "").strip().strip('"').strip("'")
    if p.startswith("file://"):
        p = p[7:]
    if "%" in p:
        p = unquote(p)
    p = p.replace("\\ ", " ")
    return os.path.expanduser(p).rstrip("/") or "/"


def find_sets(roots: list[str]) -> list[str]:
    """Findet alle .als-Dateien, ignoriert Backup-Ordner."""
    found = []
    for root in roots:
        root = clean_path(root)
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in ("Backup", ".Trash") and not d.startswith(".")]
            for f in filenames:
                if f.lower().endswith(".als") and not f.startswith("._"):
                    found.append(os.path.join(dirpath, f))
    return sorted(found)

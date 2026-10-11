import gzip
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


def make_als(path, tempo=124.0, root=9, scale="Minor", in_key=True, audio=3, midi=5, returns=2,
             arr_clips=14, clip_len_beats=16.0, session_clips=0, automations=6, plugins=("Serum", "Valhalla VintageVerb"),
             samples=(), creator="Ableton Live 12.0.25", main_tag="MainTrack"):
    tracks = "".join("<AudioTrack Id='%d'/>" % i for i in range(audio))
    tracks += "".join("<MidiTrack Id='%d'/>" % i for i in range(midi))
    tracks += "".join("<ReturnTrack Id='%d'/>" % i for i in range(returns))
    clips = "".join(
        f"<MidiClip Id='{i}' Time='{i*clip_len_beats}'><CurrentStart Value='{i*clip_len_beats}'/>"
        f"<CurrentEnd Value='{(i+1)*clip_len_beats}'/></MidiClip>" for i in range(arr_clips))
    slots = "".join("<ClipSlot><ClipSlot><Value><MidiClip Id='s'/></Value></ClipSlot></ClipSlot>" for _ in range(session_clips))
    autos = "".join("<AutomationEnvelope Id='%d'/>" % i for i in range(automations))
    plugs = "".join(f"<PluginDevice><PluginDesc><VstPluginInfo><PlugName Value='{p}'/></VstPluginInfo></PluginDesc></PluginDevice>" for p in plugins)
    refs = "".join(f"<SampleRef><FileRef><RelativePath Value='{r}'/><Path Value='{r}'/></FileRef></SampleRef>" for r in samples)
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12049" Creator="{creator}">
 <LiveSet>
  <Tracks>{tracks}</Tracks>
  <{main_tag}><DeviceChain><Mixer>
    <Tempo><LomId Value="0"/><Manual Value="{tempo}"/></Tempo>
    <TimeSignature><Manual Value="201"/></TimeSignature>
  </Mixer></DeviceChain></{main_tag}>
  <MainSequencer><ClipTimeable><ArrangerAutomation><Events>{clips}</Events></ArrangerAutomation></ClipTimeable></MainSequencer>
  <SessionClips>{slots}</SessionClips>
  <Automation>{autos}</Automation>
  <Devices>{plugs}</Devices>
  <Samples>{refs}</Samples>
  <ScaleInformation><RootNote Value="{root}"/><Name Value="{scale}"/></ScaleInformation>
  <InKey Value="{'true' if in_key else 'false'}"/>
 </LiveSet>
</Ableton>"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, "wb") as fh:
        fh.write(xml.encode())
    return path


@pytest.fixture
def make_set():
    return make_als


@pytest.fixture
def home(tmp_path, monkeypatch):
    """Isoliertes Archiv-Verzeichnis pro Test."""
    h = tmp_path / "home"
    monkeypatch.setenv("LIVE_ARCHIV_HOME", str(h))
    import importlib
    from core import db
    importlib.reload(db)
    import app as appmod
    importlib.reload(appmod)
    return h


def write_tone(path, freqs=(220.0, 261.63, 329.63), bpm=124, seconds=12, sr=22050):
    """Synthetischer Track: A-Moll-Akkord + Kickdrum im angegebenen Tempo."""
    import numpy as np
    import soundfile as sf
    t = np.arange(int(seconds * sr)) / sr
    y = sum(0.18 * np.sin(2 * np.pi * f * t) for f in freqs)
    period = 60.0 / bpm
    kick_len = int(0.12 * sr)
    kt = np.arange(kick_len) / sr
    kick = 0.9 * np.sin(2 * np.pi * (50 + 120 * np.exp(-kt * 30)) * kt) * np.exp(-kt * 25)
    for b in np.arange(0, seconds, period):
        i = int(b * sr)
        y[i:i + kick_len] += kick[: len(y[i:i + kick_len])]
    y = y / np.max(np.abs(y)) * 0.9
    sf.write(path, y.astype("float32"), sr)
    return path

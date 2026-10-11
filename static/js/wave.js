/* Farbige Wellenform wie in Rekordbox (gleiches Farbschema wie die Mini-Waveforms im Archiv):
   Bässe (< 200 Hz) blau, Mitten (200 Hz – 2 kHz) orange, Höhen (> 2 kHz) weiß.
   Die Bänder werden im Browser mit einfachen Filtern aus dem AudioBuffer berechnet. */
(function (root) {
  const LOW_HZ = 200, HIGH_HZ = 2000;

  // Mischfarbe aus Bandanteilen (lo + mi + hi ≈ 1) – identisch zu drawMini() im Archiv
  function bandRGB(lo, mi, hi) {
    return [
      Math.min(255, 30 * lo + 255 * mi + 255 * hi) | 0,
      Math.min(255, 110 * lo + 150 * mi + 255 * hi) | 0,
      Math.min(255, 255 * lo + 40 * mi + 255 * hi) | 0,
    ];
  }
  function bandColor(lo, mi, hi, alpha = 1) {
    const [r, g, b] = bandRGB(lo, mi, hi);
    return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
  }

  // Spitzenwerte + Bandanteile je Block. ch1 darf gleich ch0 sein (Mono).
  function computeBands(ch0, ch1, sampleRate, perSecond = 150) {
    ch1 = ch1 || ch0;
    const block = Math.max(1, Math.floor(sampleRate / perSecond));
    const n = Math.floor(ch0.length / block);
    const peaks = new Float32Array(n), low = new Float32Array(n), mid = new Float32Array(n), high = new Float32Array(n);
    const aL = 1 - Math.exp(-2 * Math.PI * LOW_HZ / sampleRate);
    const aH = 1 - Math.exp(-2 * Math.PI * HIGH_HZ / sampleRate);
    let lp1 = 0, lp2 = 0, lpH = 0;
    for (let i = 0; i < n; i++) {
      let m = 0, eL = 0, eM = 0, eH = 0;
      for (let j = i * block, e = j + block; j < e; j++) {
        const x = (ch0[j] + ch1[j]) * 0.5;
        const ax = Math.abs(ch0[j]) + Math.abs(ch1[j]);
        if (ax > m) m = ax;
        lp1 += aL * (x - lp1); lp2 += aL * (lp1 - lp2);   // Tiefpass 200 Hz (2. Ordnung)
        lpH += aH * (x - lpH);                             // Tiefpass 2 kHz
        const lo = lp2, hi = x - lpH, mi = lpH - lp2;
        eL += lo * lo; eM += mi * mi; eH += hi * hi;
      }
      peaks[i] = Math.min(1, m / 2);
      const sL = Math.sqrt(eL / block), sM = Math.sqrt(eM / block), sH = Math.sqrt(eH / block), s = sL + sM + sH || 1;
      low[i] = sL / s; mid[i] = sM / s; high[i] = sH / s;
    }
    return { peaks, low, mid, high, perSecond: sampleRate / block };
  }

  /* Onset-Hüllkurve für die Beatgrid-Erkennung: Energie je Fenster (hop Sekunden) und deren positiver Anstieg.
     Bässe/Kick werden betont (Tiefpass ~150 Hz), Höhen (Hi-Hats/Snare-Attack) über Differenz mitgenommen. */
  function onsetEnvelope(ch0, ch1, sampleRate, hop = 0.005) {
    ch1 = ch1 || ch0;
    const step = Math.max(1, Math.round(sampleRate * hop)), n = Math.floor(ch0.length / step);
    const rms = new Float32Array(n), flux = new Float32Array(n);
    const aL = 1 - Math.exp(-2 * Math.PI * 150 / sampleRate);
    let lp = 0, prevL = 0, prevF = 0, prevX = 0;
    for (let i = 0; i < n; i++) {
      let e = 0, eL = 0, eH = 0;
      for (let j = i * step, end = j + step; j < end; j++) {
        const x = (ch0[j] + ch1[j]) * 0.5;
        lp += aL * (x - lp);
        const d = x - prevX; prevX = x;
        e += x * x; eL += lp * lp; eH += d * d;
      }
      rms[i] = Math.sqrt(e / step);
      const l = Math.log1p(1000 * Math.sqrt(eL / step)), f = Math.log1p(1000 * Math.sqrt(eH / step));
      flux[i] = Math.max(0, l - prevL) + 0.5 * Math.max(0, f - prevF);
      prevL = l; prevF = f;
    }
    return { rms, flux, hop: step / sampleRate };
  }

  function fromBuffer(buffer, perSecond = 150) {
    const ch0 = buffer.getChannelData(0), ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
    return computeBands(ch0, ch1, buffer.sampleRate, perSecond);
  }

  const api = { LOW_HZ, HIGH_HZ, bandRGB, bandColor, computeBands, fromBuffer, onsetEnvelope };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Wave = api;
})(typeof window !== "undefined" ? window : globalThis);

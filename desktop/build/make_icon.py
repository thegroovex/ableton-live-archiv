# Live Archiv App-Icon im BeatTactics-Look: dunkles Squircle, Wellenform im Markenverlauf, Abspielkopf, Archiv-Ablage.
# Erzeugt icon.svg + icon.png (1024 px). Aufruf: python3 make_icon.py   (braucht cairosvg)
import math, os, cairosvg
S = 1024; m = 100; size = S - 2*m; rx = size*0.225; cx = S/2
HERE = os.path.dirname(os.path.abspath(__file__))

def bars():
    n = 11; w = 46; gap = 20; total = n*w + (n-1)*gap; x0 = cx - total/2
    hs = [0.30, 0.55, 0.85, 1.0, 0.70, 0.40, 0.75, 1.0, 0.80, 0.50, 0.28]
    out = ""
    for i, h in enumerate(hs):
        H = 330*h; x = x0 + i*(w+gap); y = 425 - H/2
        out += f'<rect x="{x:.1f}" y="{y:.1f}" width="{w}" height="{H:.1f}" rx="{w/2}" fill="url(#g)"/>'
    return out

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">
<defs>
 <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="170" y1="250" x2="860" y2="640"><stop offset="0" stop-color="#FF7A18"/><stop offset="0.55" stop-color="#FF2D6F"/><stop offset="1" stop-color="#B14BFF"/></linearGradient>
 <linearGradient id="gh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FF7A18"/><stop offset="0.55" stop-color="#FF2D6F"/><stop offset="1" stop-color="#B14BFF"/></linearGradient>
 <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A2C33"/><stop offset="1" stop-color="#121317"/></linearGradient>
 <radialGradient id="glow" cx="0.5" cy="0.45" r="0.5"><stop offset="0" stop-color="#FF2D6F" stop-opacity="0.30"/><stop offset="1" stop-color="#FF2D6F" stop-opacity="0"/></radialGradient>
<clipPath id="sq"><rect x="{m}" y="{m}" width="{size}" height="{size}" rx="{rx}"/></clipPath>
</defs>
<rect x="{m}" y="{m}" width="{size}" height="{size}" rx="{rx}" fill="url(#bg)"/>
<rect x="{m+3}" y="{m+3}" width="{size-6}" height="{size-6}" rx="{rx-3}" fill="none" stroke="#FFFFFF" stroke-opacity="0.08" stroke-width="6"/>
<circle cx="{cx}" cy="425" r="340" fill="url(#glow)" clip-path="url(#sq)"/>
{bars()}
<rect x="{cx-7}" y="215" width="14" height="410" rx="7" fill="#FFFFFF"/>
<path d="M{cx-34},192 L{cx+34},192 L{cx},238 Z" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="10" stroke-linejoin="round"/>
<path d="M245,640 L245,742 Q245,790 293,790 L731,790 Q779,790 779,742 L779,640" fill="none" stroke="#FFFFFF" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>
<rect x="{cx-90}" y="700" width="180" height="34" rx="17" fill="url(#gh)"/>
</svg>'''
open(os.path.join(HERE, "icon.svg"), "w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(HERE, "icon.png"), output_width=S, output_height=S)

# CIRCINUS — cinematic intro (proto-5)

Three.js + React intro: procedural gold low-poly world, 10 video monoliths, singularity collapse,
explosion and the compass logo. `?t=<seconds>` freezes the film at a time (handy for QA),
`?look=logo` gives a close-up of the logo.

## Changes in this iteration

- `src/intro/logoDust.ts` – the emblem now **assembles from ~9000 gold sparks** that fly out of the
  singularity along curved paths and settle on the real logo pixels (sampled from the SVG alpha).
  The sheen that crosses the emblem also ignites the sparks, with tiny cross glints.
- Emblem: brushed-gold grade, alpha-derived bevel (light from top-left), 9-layer fake extrusion for real
  thickness and a slow pendulum turn + pointer parallax so the edges catch the light.
- Post: volumetric **god rays** radiating from behind the emblem (HDR-thresholded, only after the blast flash).

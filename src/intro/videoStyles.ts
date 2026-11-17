/** Stable identifiers are persisted with the rest of the creative settings. */
export const VIDEO_STYLES = [
  { id: 'original', label: 'Оригинал', code: 0 },
  { id: 'warm', label: 'Тёплый свет', code: 1 },
  { id: 'mono', label: 'Чёрно-белый', code: 2 },
  { id: 'sepia', label: 'Сепия', code: 3 },
  { id: 'cinema', label: 'Кино · холодные тени', code: 4 },
  { id: 'archive', label: 'Архивная плёнка', code: 5 },
] as const;
export type VideoStyle = (typeof VIDEO_STYLES)[number]['id'];
export const isVideoStyle = (value: unknown): value is VideoStyle => VIDEO_STYLES.some(style => style.id === value);
export const videoStyleCode = (style: VideoStyle) => VIDEO_STYLES.find(item => item.id === style)?.code ?? 0;

/** Applied to footage only, before the screen frame, reflections and scene lighting. */
export const VIDEO_STYLE_GLSL = /* glsl */ `
vec3 gradeVideo(vec3 original, vec2 uv, float time, float style, float strength) {
  if (style < 0.5 || strength <= 0.0) return original;
  float lum = dot(original, vec3(0.2126, 0.7152, 0.0722));
  vec3 graded = original;
  if (style < 1.5) {
    graded = max((original - 0.18) * 1.04 + 0.18, 0.0) * vec3(1.08, 1.01, 0.86);
  } else if (style < 2.5) {
    graded = vec3(lum);
  } else if (style < 3.5) {
    graded = vec3(lum) * vec3(1.13, 0.87, 0.59);
  } else if (style < 4.5) {
    float highlight = smoothstep(0.12, 0.65, lum);
    vec3 tint = mix(vec3(0.85, 0.98, 1.13), vec3(1.08, 1.01, 0.89), highlight);
    graded = max((original - 0.18) * 1.12 + 0.18, 0.0) * tint;
  } else {
    // Deterministic 30-fps grain, sampled in source UV coordinates so offline
    // renders remain stable even when individual frames are generated out of order.
    float frame = floor(time * 30.0 + 0.0001);
    vec2 cell = floor(uv * vec2(960.0, 540.0));
    float noise = fract(sin(dot(cell, vec2(12.9898, 78.233)) + frame * 19.19) * 43758.5453) - 0.5;
    vec2 centred = (uv - 0.5) * vec2(1.2, 1.0);
    float vignette = 1.0 - 0.2 * smoothstep(0.18, 0.78, length(centred));
    graded = (mix(original, vec3(lum), 0.22) * vec3(1.05, 0.98, 0.82) * 0.86 + 0.025 + noise * 0.035) * vignette;
    graded = max(graded, 0.0);
  }
  return mix(original, graded, clamp(strength, 0.0, 1.0));
}
`;

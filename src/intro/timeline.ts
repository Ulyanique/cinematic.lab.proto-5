import * as THREE from "three";
import { clamp, easeOutCubic, lerp, mulberry32, terrainHeight } from "./math";

/** Master timeline of the intro (seconds). */
export const TL = {
  visit0: 9.0,
  visitStep: 1.9,
  riseLead: 4.2,
  riseDur: 3.4,
  implodeStart: 27.2,
  explode: 31.5,
  logoText: 34.9,
  tagline: 36.3,
  end: 43.5,
};

export const HERO_COUNT = 10;

export interface HeroPlacement {
  x: number;
  z: number;
  yaw: number;
  theta: number;
  radius: number;
}

export function heroPlacement(i: number): HeroPlacement {
  const rand = mulberry32(900 + i * 17);
  const theta = ((18 + 36 * i) * Math.PI) / 180 + (rand() - 0.5) * 0.06;
  const radius = 27.5 + (i % 3) * 1.6 + rand() * 1.2;
  const x = Math.sin(theta) * radius;
  const z = Math.cos(theta) * radius;
  // local +Z (screen normal) should look at the centre
  const yaw = Math.atan2(-x, -z) + (rand() - 0.5) * 0.35;
  return { x, z, yaw, theta, radius };
}

export const visitTime = (i: number) => TL.visit0 + i * TL.visitStep;
export const riseStart = (i: number) => visitTime(i) - TL.riseLead;

interface Key {
  t: number;
  p: THREE.Vector3;
  l: THREE.Vector3;
  fov: number;
  roll: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const key = (t: number, p: [number, number, number], l: [number, number, number], fov: number, roll = 0): Key => ({
  t,
  p: V(...p),
  l: V(...l),
  fov,
  roll,
});

function buildKeys(): Key[] {
  const keys: Key[] = [
    key(0, [5, 3.3, 176], [0, 8, 120], 56, 0.03),
    key(2.2, [-4, 3.1, 134], [8, 9, 80], 53, -0.045),
    key(4.4, [5, 4.4, 92], [-3, 10, 46], 51, 0.04),
    key(6.6, [-1.5, 5.6, 58], [0, 10, 16], 49, -0.02),
    key(7.9, [0.6, 5.0, 33], [4, 8.5, 8], 52, 0.0),
  ];
  const deltas = [-0.4, 0.05, -0.35, 0.1, -0.3, 0.15, -0.4, 0.05, -0.35, 0.1];
  const heights = [4.2, 8.5, 3.0, 9.5, 4.5, 8.0, 3.0, 9.0, 4.0, 7.5];
  const radii = [11, 13, 9, 14, 10, 13, 9, 14, 10, 12];
  const tys = [6.5, 9, 7, 8.5, 6, 9, 7.5, 8, 6.5, 8.5];
  const fovs = [44, 48, 42, 50, 44, 48, 40, 50, 44, 46];
  const rolls = [0.04, -0.05, 0.06, -0.04, 0.05, -0.06, 0.04, -0.05, 0.05, -0.03];
  for (let i = 0; i < HERO_COUNT; i++) {
    const h = heroPlacement(i);
    const phi = h.theta + deltas[i];
    keys.push(
      key(
        visitTime(i),
        [Math.sin(phi) * radii[i], heights[i], Math.cos(phi) * radii[i]],
        [h.x, tys[i], h.z],
        fovs[i],
        rolls[i]
      )
    );
  }
  keys.push(key(28.7, [6.5, 7.0, 19], [0, 5.6, 0], 62, 0.06));
  keys.push(key(30.2, [-1.2, 5.8, 11.5], [0, 5.6, 0], 70, -0.04));
  keys.push(key(TL.explode, [0, 5.5, 7.5], [0, 5.6, 0], 78, 0));
  return keys;
}

const KEYS = buildKeys();

function cr(p0: number, p1: number, p2: number, p3: number, s: number) {
  const s2 = s * s;
  const s3 = s2 * s;
  return 0.5 * (2 * p1 + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
}
function crV(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, s: number) {
  out.set(cr(a.x, b.x, c.x, d.x, s), cr(a.y, b.y, c.y, d.y, s), cr(a.z, b.z, c.z, d.z, s));
}

export interface CamState {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  roll: number;
}

export const FINAL = {
  pos: V(0, 5.5, 21),
  target: V(0, 4.8, 0),
  fov: 36,
};

export const BLAST_POS = V(0, 5.6, 0);
export const LOGO_POS = V(0, 5.8, 0);

export function sampleCamera(t: number, out: CamState) {
  const tl = t - TL.explode;
  if (tl >= 0) {
    const last = KEYS[KEYS.length - 1];
    const e = easeOutCubic(tl / 5.2);
    const ef = easeOutCubic(tl / 6.0);
    out.pos.lerpVectors(last.p, FINAL.pos, e);
    out.target.lerpVectors(last.l, FINAL.target, e);
    out.fov = lerp(last.fov, FINAL.fov, ef);
    out.roll = 0;
    // slow cinematic push-in with a hint of sway while the logo shines
    const drift = clamp((tl - 3) / 10);
    out.pos.z -= drift * 1.6;
    out.pos.x += Math.sin(tl * 0.35) * 0.5 * clamp(tl / 4);
    out.pos.y += Math.sin(tl * 0.27) * 0.18 * clamp(tl / 4);
    return out;
  }
  let i = 0;
  while (i < KEYS.length - 2 && t >= KEYS[i + 1].t) i++;
  const k1 = KEYS[i];
  const k2 = KEYS[i + 1];
  const k0 = KEYS[Math.max(0, i - 1)];
  const k3 = KEYS[Math.min(KEYS.length - 1, i + 2)];
  const s = clamp((t - k1.t) / (k2.t - k1.t));
  crV(out.pos, k0.p, k1.p, k2.p, k3.p, s);
  crV(out.target, k0.l, k1.l, k2.l, k3.l, s);
  out.fov = cr(k0.fov, k1.fov, k2.fov, k3.fov, s);
  out.roll = cr(k0.roll, k1.roll, k2.roll, k3.roll, s);
  // never dive into the dunes
  const minY = terrainHeight(out.pos.x, out.pos.z) + 2.4;
  if (out.pos.y < minY) out.pos.y = minY;
  return out;
}

import * as THREE from "three";
import { clamp, easeInOutCubic, easeOutBack, easeOutCubic, lerp } from "./math";

/** Procedural warm studio environment -> PMREM, used for the real metallic logo. */
export function createGoldEnv(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(70, 46, 70),
    new THREE.MeshBasicMaterial({ color: 0x1b0d03, side: THREE.BackSide })
  );
  scene.add(room);
  const add = (w: number, h: number, pos: [number, number, number], color: number, intensity: number) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
    mat.toneMapped = false;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  add(24, 24, [0, 20, 0], 0xffe2b0, 5);
  add(4, 28, [-22, 4, 7], 0xffc070, 8);
  add(5, 26, [22, 6, -9], 0xffb050, 7);
  add(34, 9, [0, 5, -28], 0xff9a30, 3.2);
  add(30, 5, [0, -9, 24], 0xff8a20, 2.2);
  add(3, 22, [12, 3, 24], 0xffd9a0, 6);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  return rt.texture;
}

function sparkTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,240,200,1)");
  gr.addColorStop(0.25, "rgba(255,190,90,0.7)");
  gr.addColorStop(1, "rgba(255,150,40,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class CompassLogo {
  group = new THREE.Group();
  private inner = new THREE.Group();
  private leftPivot = new THREE.Group();
  private rightPivot = new THREE.Group();
  private mats: THREE.MeshStandardMaterial[] = [];
  private arc!: THREE.Mesh;
  private arcSegments = 160;
  private arcIndexCount = 0;
  private spark: THREE.Mesh;
  private sparkles: THREE.Points;
  private sparkMat: THREE.PointsMaterial;
  private baseScale = 0.97;
  private emissiveCol = new THREE.Color();
  private arcPoint = (a: number) => new THREE.Vector3(Math.cos(a) * 5.0, 2.3 + Math.sin(a) * 5.0, 0);

  constructor(env: THREE.Texture) {
    const mk = (opts: THREE.MeshStandardMaterialParameters) => {
      const m = new THREE.MeshStandardMaterial({
        metalness: 1,
        roughness: 0.2,
        envMap: env,
        envMapIntensity: 2.0,
        emissive: 0xff8a18,
        emissiveIntensity: 0,
        ...opts,
      });
      this.mats.push(m);
      return m;
    };
    const gold = mk({ color: 0xffc04d, flatShading: true });
    const goldSmooth = mk({ color: 0xffc860, roughness: 0.16 });
    const dark = mk({ color: 0x3a2008, roughness: 0.4, envMapIntensity: 1.2 });

    this.inner.position.y = -0.65;
    this.group.add(this.inner);

    const hinge = new THREE.Group();
    hinge.position.set(0, 2.3, 0);
    this.inner.add(hinge);

    // hinge barrel (hex), side rings, screw
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.32, 6), goldSmooth);
    barrel.rotation.x = Math.PI / 2;
    hinge.add(barrel);
    for (const z of [-0.2, 0.2]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 6), gold);
      ring.position.z = z;
      hinge.add(ring);
    }
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 6), dark);
    screw.rotation.x = Math.PI / 2;
    screw.position.z = 0.26;
    hinge.add(screw);

    // handle
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.12, 0.75, 6), goldSmooth);
    stem.position.y = 0.62;
    hinge.add(stem);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 6, 6), gold);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.98;
    hinge.add(collar);
    const knob = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), gold);
    knob.scale.set(1, 1.45, 1);
    knob.position.y = 1.32;
    hinge.add(knob);

    // legs
    hinge.add(this.leftPivot, this.rightPivot);
    const L1 = 3.3;
    const L2 = 1.7;
    const diamond = (g: THREE.BufferGeometry) => {
      g.rotateY(Math.PI / 4);
      return g;
    };
    const buildLeg = (pivot: THREE.Group, side: "needle" | "pencil") => {
      const upper = new THREE.Mesh(diamond(new THREE.CylinderGeometry(0.19, 0.115, L1, 4)), gold);
      upper.position.y = -L1 / 2;
      upper.scale.z = 0.75;
      pivot.add(upper);
      const knee = new THREE.Mesh(new THREE.OctahedronGeometry(0.21, 0), goldSmooth);
      knee.position.y = -L1;
      pivot.add(knee);
      if (side === "needle") {
        const lower = new THREE.Mesh(diamond(new THREE.CylinderGeometry(0.105, 0.012, L2, 4)), gold);
        lower.position.y = -L1 - L2 / 2;
        lower.scale.z = 0.75;
        pivot.add(lower);
      } else {
        const holder = new THREE.Mesh(diamond(new THREE.CylinderGeometry(0.115, 0.09, 1.15, 4)), gold);
        holder.position.y = -L1 - 0.575;
        holder.scale.z = 0.75;
        pivot.add(holder);
        const lead = new THREE.Mesh(diamond(new THREE.CylinderGeometry(0.075, 0.008, L2 - 1.15, 4)), dark);
        lead.position.y = -L1 - 1.15 - (L2 - 1.15) / 2;
        pivot.add(lead);
      }
    };
    buildLeg(this.leftPivot, "needle");
    buildLeg(this.rightPivot, "pencil");

    // the arc drawn by the compass
    const a0 = -Math.PI / 2 - 0.66;
    const a1 = -Math.PI / 2 + 0.66;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) pts.push(this.arcPoint(lerp(a0, a1, i / 64)));
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, this.arcSegments, 0.055, 6, false);
    this.arcIndexCount = tube.index!.count;
    this.arc = new THREE.Mesh(tube, gold);
    this.inner.add(this.arc);
    tube.setDrawRange(0, 0);
    (this.arc as THREE.Mesh & { curve?: THREE.Curve<THREE.Vector3> }).curve = curve;

    // glowing pencil tip
    const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.6, 1.8), toneMapped: false });
    this.spark = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), sparkMat);
    this.inner.add(this.spark);

    // orbiting sparkles
    const n = 420;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3.6 + Math.random() * 3.2;
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 8.5;
      arr[i * 3 + 2] = Math.sin(a) * r * 0.55;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    this.sparkMat = new THREE.PointsMaterial({
      map: sparkTexture(),
      size: 0.28,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xffc070,
    });
    this.sparkles = new THREE.Points(sg, this.sparkMat);
    this.sparkles.frustumCulled = false;
    this.group.add(this.sparkles);

    this.group.visible = false;
  }

  /** tl = seconds since the explosion; time = global time. */
  update(tl: number, time: number) {
    const vis = tl > 0.12;
    this.group.visible = vis;
    if (!vis) return;

    const sIn = easeOutBack((tl - 0.12) / 1.3, 1.1);
    const s = this.baseScale * sIn;
    this.group.scale.setScalar(Math.max(s, 0.0001));

    const open = lerp(0.012, 0.36, easeOutBack((tl - 0.95) / 1.5, 1.25));
    this.leftPivot.rotation.z = -open;
    this.rightPivot.rotation.z = open;

    const arcP = easeInOutCubic((tl - 2.4) / 1.7);
    const segs = Math.floor(arcP * this.arcSegments);
    this.arc.geometry.setDrawRange(0, segs * 36 > this.arcIndexCount ? this.arcIndexCount : segs * 36);
    const curve = (this.arc as THREE.Mesh & { curve: THREE.Curve<THREE.Vector3> }).curve;
    const tipPos = curve.getPoint(clamp(arcP));
    this.spark.position.copy(tipPos);
    const sparkVis = arcP > 0.001 && arcP < 0.999 ? 1 : 0;
    this.spark.scale.setScalar(sparkVis * (1 + Math.sin(time * 40) * 0.3));

    // spin-in, then gentle sway so the facets keep glinting
    const spin = (1 - easeOutCubic(tl / 3.2)) * -1.4;
    this.group.rotation.y = spin + Math.sin(time * 0.55) * 0.32;
    this.group.rotation.x = Math.sin(time * 0.37) * 0.045;
    this.group.position.y = 5.8 + Math.sin(time * 0.8) * 0.1;

    // white-hot -> molten gold
    const hot = Math.exp(-tl * 1.25);
    this.emissiveCol.setRGB(1, lerp(0.5, 0.92, hot), lerp(0.1, 0.65, hot));
    const pulse = Math.exp(-Math.pow((tl - 4.05) / 0.35, 2)) * 1.2; // flash when the arc completes
    const em = 0.08 + hot * 6 + pulse;
    for (const m of this.mats) {
      m.emissive.copy(this.emissiveCol);
      m.emissiveIntensity = em;
      m.envMapRotation.y = time * 0.4 + Math.sin(time * 0.3) * 0.5;
      m.envMapIntensity = 2.0 + pulse;
    }
    this.sparkMat.opacity = clamp((tl - 2.0) / 1.5) * 0.9;
    this.sparkles.rotation.y = time * 0.25;
  }
}

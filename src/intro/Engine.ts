import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { buildHero, buildScenery, buildTerrain } from "./geometry";
import { CompassLogo, createGoldEnv } from "./logo";
import { clamp, lerp, mulberry32, smoothstep, terrainHeight } from "./math";
import * as S from "./shaders";
import { makePlaceholderTexture } from "./textures";
import {
  BLAST_POS,
  CamState,
  HERO_COUNT,
  TL,
  heroPlacement,
  riseStart,
  sampleCamera,
  visitTime,
} from "./timeline";

export type Stage = "approach" | "monoliths" | "collapse" | "logo" | "title" | "end";

export interface IntroEvents {
  onProgress?: (frac: number, t: number) => void;
  onChapter?: (chapter: number) => void;
  onStage?: (stage: Stage) => void;
  onReady?: () => void;
}

interface Hero {
  group: THREE.Group;
  bodyMat: THREE.ShaderMaterial;
  screenMat: THREE.ShaderMaterial;
  beamMat: THREE.ShaderMaterial;
  glowMat: THREE.ShaderMaterial;
}

const additive = (m: THREE.ShaderMaterial) => {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  return m;
};

export class IntroEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private post: ShaderPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.3, 1400);
  private cam: CamState = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50, roll: 0 };

  private U = {
    uTime: { value: 0 },
    uBuildR: { value: 0 },
    uAnchor: { value: new THREE.Vector3(0, 0, 175) },
    uBlastT: { value: -1 },
    uBlastPos: { value: BLAST_POS.clone() },
    uBlastLight: { value: 0 },
    uFogColor: { value: new THREE.Color(0.075, 0.028, 0.005) },
    uFogDensity: { value: 0.0075 },
    uDim: { value: 1 },
    uEdge: { value: 1 },
  };

  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private sceneryMat: THREE.ShaderMaterial;
  private heroes: Hero[] = [];
  private dustMat: THREE.ShaderMaterial;
  private sigilMat: THREE.ShaderMaterial;
  private core: THREE.Mesh;
  private coreMat: THREE.ShaderMaterial;
  private shell: THREE.Mesh;
  private shellMat: THREE.ShaderMaterial;
  private flare: THREE.Mesh;
  private flareMat: THREE.ShaderMaterial;
  private halo: THREE.Mesh;
  private haloMat: THREE.ShaderMaterial;
  private ring: THREE.Mesh;
  private ringMat: THREE.ShaderMaterial;
  private blastMat: THREE.ShaderMaterial;
  private logo: CompassLogo;

  private raf = 0;
  private clock = 0;
  private lastTs = 0;
  private slowAcc = 0;
  private slowCool = 0;
  private fixedT: number | null;
  private events: IntroEvents;
  private lastStage: Stage | null = null;
  private lastChapter = -1;
  private pixelRatio: number;
  private disposed = false;
  private debugLook = new URLSearchParams(window.location.search).get("look");
  private tmpV = new THREE.Vector3();

  constructor(container: HTMLElement, events: IntroEvents = {}, fixedT: number | null = null) {
    this.container = container;
    this.events = events;
    this.fixedT = fixedT;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.setClearColor(0x000000, 1);
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.camera.aspect = w / h;

    // ---------------------------------------------------------------- sky
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: S.SKY_VERT,
      fragmentShader: S.SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTime: this.U.uTime, uGlow: { value: 0 }, uFlame: { value: 1 } },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // ---------------------------------------------------------------- terrain & scenery
    const facetMat = (terrain: boolean, glow: number, shock: number) =>
      new THREE.ShaderMaterial({
        vertexShader: S.FACET_VERT,
        fragmentShader: S.FACET_FRAG,
        defines: terrain ? { TERRAIN: "" } : {},
        side: THREE.DoubleSide,
        uniforms: {
          ...this.U,
          uRise: { value: 1 },
          uHeight: { value: 20 },
          uGlow: { value: glow },
          uFocus: { value: 0 },
          uShockK: { value: shock },
        },
      });

    const terrain = new THREE.Mesh(buildTerrain(), facetMat(true, 0, 1));
    terrain.frustumCulled = false;
    this.scene.add(terrain);

    this.sceneryMat = facetMat(true, 0.9, 0.35);
    const scenery = new THREE.Mesh(buildScenery(), this.sceneryMat);
    scenery.frustumCulled = false;
    this.scene.add(scenery);

    // ---------------------------------------------------------------- heroes (10 video monoliths)
    const beamGeo = new THREE.CylinderGeometry(2.6, 3.6, 80, 28, 1, true);
    beamGeo.translate(0, 40, 0);
    const glowGeo = new THREE.PlaneGeometry(26, 26);
    glowGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < HERO_COUNT; i++) {
      const data = buildHero(101 + i * 13);
      const pl = heroPlacement(i);
      let minH = Infinity;
      let maxH = -Infinity;
      minH = Math.min(minH, terrainHeight(pl.x, pl.z));
      maxH = Math.max(maxH, terrainHeight(pl.x, pl.z));
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const hh = terrainHeight(pl.x + Math.cos(a) * 6, pl.z + Math.sin(a) * 6);
        minH = Math.min(minH, hh);
        maxH = Math.max(maxH, hh);
      }
      const baseY = minH - 1.5;

      const group = new THREE.Group();
      group.position.set(pl.x, baseY, pl.z);
      group.rotation.y = pl.yaw;

      const bodyMat = facetMat(false, 1.0, 0);
      bodyMat.uniforms.uRise.value = 0;
      bodyMat.uniforms.uHeight.value = data.totalHeight;
      const body = new THREE.Mesh(data.body, bodyMat);
      body.frustumCulled = false;
      group.add(body);

      const screenMat = new THREE.ShaderMaterial({
        vertexShader: S.SCREEN_VERT,
        fragmentShader: S.SCREEN_FRAG,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: {
          uTime: this.U.uTime,
          uBlastLight: this.U.uBlastLight,
          uBlastPos: this.U.uBlastPos,
          uFogColor: this.U.uFogColor,
          uFogDensity: this.U.uFogDensity,
          uDim: this.U.uDim,
          uTex: { value: makePlaceholderTexture(i, HERO_COUNT, data.aspect) },
          uOn: { value: 0 },
          uFocus: { value: 0 },
          uAspect: { value: data.aspect },
          uSeed: { value: i * 0.137 },
        },
      });
      const screen = new THREE.Mesh(data.screen, screenMat);
      screen.frustumCulled = false;
      group.add(screen);

      const beamMat = additive(
        new THREE.ShaderMaterial({
          vertexShader: S.BEAM_VERT,
          fragmentShader: S.BEAM_FRAG,
          side: THREE.DoubleSide,
          uniforms: { uI: { value: 0 }, uTime: this.U.uTime },
        })
      );
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 0.5;
      beam.frustumCulled = false;
      group.add(beam);

      const glowMat = additive(
        new THREE.ShaderMaterial({
          vertexShader: S.FLARE_VERT,
          fragmentShader: S.FLARE_FRAG,
          uniforms: {
            uTime: this.U.uTime,
            uI: { value: 0 },
            uRays: { value: 0 },
            uStreak: { value: 0 },
            uColor: { value: new THREE.Color(1.0, 0.55, 0.12) },
          },
        })
      );
      const glow = new THREE.Mesh(glowGeo, glowMat);
      // lift the ground glow above the highest facet around the base so it is never cut into polygons
      glow.position.y = maxH - baseY + 0.6;
      glow.frustumCulled = false;
      group.add(glow);

      this.scene.add(group);
      this.heroes.push({ group, bodyMat, screenMat, beamMat, glowMat });
    }

    // ---------------------------------------------------------------- arena sigil
    this.sigilMat = additive(
      new THREE.ShaderMaterial({
        vertexShader: S.SIGIL_VERT,
        fragmentShader: S.SIGIL_FRAG,
        uniforms: { uDraw: { value: 0 }, uI: { value: 1 }, uTime: this.U.uTime },
      })
    );
    // the sigil follows the terrain relief, so facets never slice through its lines
    this.sigilMat.polygonOffset = true;
    this.sigilMat.polygonOffsetFactor = -2;
    this.sigilMat.polygonOffsetUnits = -2;
    const sigilGeo = new THREE.PlaneGeometry(80, 80, 160, 160);
    {
      const sp = sigilGeo.attributes.position;
      for (let i = 0; i < sp.count; i++) sp.setZ(i, terrainHeight(sp.getX(i), -sp.getY(i)) + 0.5);
    }
    const sigil = new THREE.Mesh(sigilGeo, this.sigilMat);
    sigil.rotation.x = -Math.PI / 2;
    sigil.frustumCulled = false;
    this.scene.add(sigil);

    // ---------------------------------------------------------------- floating embers
    {
      const n = 2600;
      const rand = mulberry32(77);
      const data = new Float32Array(n * 4);
      for (let i = 0; i < n * 4; i++) data[i] = rand();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute("aData", new THREE.BufferAttribute(data, 4));
      this.dustMat = additive(
        new THREE.ShaderMaterial({
          vertexShader: S.DUST_VERT,
          fragmentShader: S.DUST_FRAG,
          uniforms: {
            uTime: this.U.uTime,
            uSize: { value: 1.6 },
            uPx: { value: this.pixelRatio },
            uBox: { value: new THREE.Vector3(150, 60, 150) },
            uAlpha: { value: 0.9 },
          },
        })
      );
      const pts = new THREE.Points(g, this.dustMat);
      pts.frustumCulled = false;
      this.scene.add(pts);
    }

    // ---------------------------------------------------------------- blast particles
    {
      const n = 16000;
      const rand = mulberry32(2024);
      const dir = new Float32Array(n * 3);
      const info = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        // squash vertically a bit: more ground-hugging debris, a few pillars of sparks
        const y = u * (rand() < 0.15 ? 1 : 0.55) + 0.12;
        dir[i * 3] = Math.cos(a) * s;
        dir[i * 3 + 1] = y;
        dir[i * 3 + 2] = Math.sin(a) * s;
        info[i * 3] = 22 + Math.pow(rand(), 1.5) * 90;
        info[i * 3 + 1] = rand();
        info[i * 3 + 2] = 0.5 + Math.pow(rand(), 3) * 2.6;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
      g.setAttribute("aInfo", new THREE.BufferAttribute(info, 3));
      this.blastMat = additive(
        new THREE.ShaderMaterial({
          vertexShader: S.BLAST_VERT,
          fragmentShader: S.BLAST_FRAG,
          uniforms: {
            uT: { value: -1 },
            uImplode: { value: 0 },
            uCenter: { value: BLAST_POS.clone() },
            uPx: { value: this.pixelRatio },
            uTime: this.U.uTime,
          },
        })
      );
      const pts = new THREE.Points(g, this.blastMat);
      pts.frustumCulled = false;
      this.scene.add(pts);
    }

    // ---------------------------------------------------------------- core / fireball / shock
    const coreMaterial = (a: THREE.Color, b: THREE.Color) =>
      additive(
        new THREE.ShaderMaterial({
          vertexShader: S.CORE_VERT,
          fragmentShader: S.CORE_FRAG,
          side: THREE.DoubleSide,
          uniforms: {
            uTime: this.U.uTime,
            uDisp: { value: 0.5 },
            uI: { value: 0 },
            uColA: { value: a },
            uColB: { value: b },
          },
        })
      );
    this.coreMat = coreMaterial(new THREE.Color(1.0, 0.42, 0.06), new THREE.Color(1.0, 0.92, 0.65));
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 5), this.coreMat);
    this.core.position.copy(BLAST_POS);
    this.core.frustumCulled = false;
    this.scene.add(this.core);

    this.shellMat = coreMaterial(new THREE.Color(1.0, 0.45, 0.08), new THREE.Color(1.0, 0.8, 0.4));
    this.shellMat.uniforms.uDisp.value = 2.0;
    this.shellMat.side = THREE.FrontSide;
    this.shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), this.shellMat);
    this.shell.position.copy(BLAST_POS);
    this.shell.frustumCulled = false;
    this.scene.add(this.shell);

    const flareMaterial = (streak: number, rays: number) =>
      additive(
        new THREE.ShaderMaterial({
          vertexShader: S.FLARE_VERT,
          fragmentShader: S.FLARE_FRAG,
          uniforms: {
            uTime: this.U.uTime,
            uI: { value: 0 },
            uRays: { value: rays },
            uStreak: { value: streak },
            uColor: { value: new THREE.Color(1.0, 0.72, 0.36) },
          },
        })
      );
    this.flareMat = flareMaterial(1, 1);
    this.flareMat.depthTest = false;
    this.flare = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.flareMat);
    this.flare.position.copy(BLAST_POS);
    this.flare.renderOrder = 20;
    this.flare.frustumCulled = false;
    this.scene.add(this.flare);

    this.haloMat = flareMaterial(1.0, 0.25);
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.haloMat);
    this.halo.position.set(0, 5.8, -2.2);
    this.halo.frustumCulled = false;
    this.scene.add(this.halo);

    this.ringMat = additive(
      new THREE.ShaderMaterial({
        vertexShader: S.RING_VERT,
        fragmentShader: S.RING_FRAG,
        side: THREE.DoubleSide,
        uniforms: { uR: { value: 0 }, uW: { value: 1.5 }, uI: { value: 0 }, uTime: this.U.uTime },
      })
    );
    this.ringMat.depthTest = false;
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), this.ringMat);
    this.ring.renderOrder = 5;
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.9;
    this.ring.frustumCulled = false;
    this.scene.add(this.ring);

    // ---------------------------------------------------------------- the compass logo
    const env = createGoldEnv(renderer);
    this.logo = new CompassLogo(env);
    this.logo.group.position.copy(new THREE.Vector3(0, 5.8, 0));
    this.scene.add(this.logo.group);

    // ---------------------------------------------------------------- post
    const rt = new THREE.WebGLRenderTarget(w * this.pixelRatio, h * this.pixelRatio, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.8, 0.8, 0.8);
    this.composer.addPass(this.bloom);
    this.post = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: this.U.uTime,
        uFlash: { value: 0 },
        uAber: { value: 0.002 },
        uZoom: { value: 0 },
        uVig: { value: 0.55 },
        uFade: { value: 1 },
        uGrain: { value: 0.045 },
        uShockR: { value: 0 },
        uShockAmp: { value: 0 },
        uAspect: { value: w / h },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      },
      vertexShader: S.POST_VERT,
      fragmentShader: S.POST_FRAG,
    });
    this.composer.addPass(this.post);
    this.composer.addPass(new OutputPass());

    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.warmUp();
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    this.events.onReady?.();
  }

  /** current intro time in seconds (accumulated per frame, so hitches never make the film jump) */
  get time() {
    return this.fixedT !== null ? this.fixedT : this.clock;
  }

  restart() {
    this.clock = 0;
    this.lastStage = null;
    this.lastChapter = -1;
  }

  /**
   * Render every visual state once behind black so all shaders are compiled, textures and
   * buffers are uploaded *before* the film starts – no stutter at the explosion.
   */
  private warmUp() {
    for (const t of [TL.explode + 1, TL.explode - 0.5, 20, 0]) {
      this.apply(t, true);
      this.composer.render();
    }
    this.lastStage = null;
    this.lastChapter = -1;
  }

  private onVisibility = () => {
    this.lastTs = performance.now();
  };

  private onResize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.uniforms.uAspect.value = w / h;
  };

  private setPixelRatio(pr: number) {
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    (this.dustMat.uniforms.uPx as { value: number }).value = pr;
    (this.blastMat.uniforms.uPx as { value: number }).value = pr;
    this.onResize();
  }

  private loop = (ts: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.25);
    if (this.fixedT === null) this.clock += dt;
    this.apply(this.time);
    this.composer.render();

    // adaptive resolution from the real frame interval; only steps down, with a cool-down,
    // so the picture never "breathes" in quality
    this.slowCool = Math.max(0, this.slowCool - dt);
    if (dt > 0.034 && this.slowCool === 0) this.slowAcc += dt;
    else this.slowAcc = Math.max(0, this.slowAcc - dt * 2);
    if (this.slowAcc > 2.5 && this.pixelRatio > 0.8) {
      this.slowAcc = 0;
      this.slowCool = 6;
      this.setPixelRatio(Math.max(0.75, this.pixelRatio - 0.25));
    }
  };

  private billboard(m: THREE.Mesh, size: number) {
    m.lookAt(this.camera.position);
    m.scale.set(size, size, 1);
  }

  private apply(t: number, warm = false) {
    const U = this.U;
    const tl = t - TL.explode;
    const post = tl >= 0;
    const kImp = clamp((t - TL.implodeStart) / (TL.explode - TL.implodeStart));
    const k2 = kImp * kImp;
    const k3 = k2 * kImp;
    const expl = post ? Math.exp(-tl * 2.4) : 0;

    // ------------------------------------------------ camera
    // a slow, soft handheld drift only – no high-frequency shake anywhere
    sampleCamera(t, this.cam);
    if (this.debugLook === "logo") {
      // QA helper: close-up on the logo (?look=logo)
      this.cam.pos.set(0, 6.4, 12.5);
      this.cam.target.set(0, 5.2, 0);
      this.cam.fov = 30;
      this.cam.roll = 0;
    }
    const cam = this.camera;
    cam.position.copy(this.cam.pos);
    cam.position.x += Math.sin(t * 0.9) * 0.1;
    cam.position.y += Math.sin(t * 1.3 + 2) * 0.08;
    cam.position.z += Math.sin(t * 0.7 + 1) * 0.1;
    cam.up.set(0, 1, 0);
    cam.lookAt(this.cam.target);
    cam.rotateZ(this.cam.roll);
    cam.fov = this.cam.fov;
    cam.updateProjectionMatrix();
    // fades that must fully decay after the blast (the raw implode factor stays at 1 forever)
    const kFx = post ? Math.exp(-tl * 1.1) : kImp;

    // ------------------------------------------------ globals
    U.uTime.value = t;
    U.uBuildR.value = 10 + t * 55;
    U.uBlastT.value = post ? tl : -1;
    U.uEdge.value = 1.0 + k2 * 0.7 + (post ? 0.8 * Math.exp(-tl * 2.0) : 0);
    U.uFogDensity.value = lerp(0.0092, 0.0068, smoothstep(0, 9, t));
    U.uDim.value = post ? lerp(1, 0.5, smoothstep(1.5, 5, tl)) : 1;
    U.uBlastLight.value = post ? 40 * Math.exp(-tl * 3.4) + 1.0 * Math.exp(-tl * 0.8) + 0.3 : 1.6 * k2;

    this.sky.position.copy(cam.position);
    this.skyMat.uniforms.uGlow.value = k2 * 0.35 + (post ? 1.3 * Math.exp(-tl * 1.5) : 0);

    // ------------------------------------------------ monoliths
    let chapter = 0;
    let bestFocus = 0.3;
    for (let i = 0; i < HERO_COUNT; i++) {
      const h = this.heroes[i];
      const rise = clamp((t - riseStart(i)) / TL.riseDur);
      const focus = Math.exp(-Math.pow((t - visitTime(i)) / 0.95, 2));
      if (focus > bestFocus && !post) {
        bestFocus = focus;
        chapter = i + 1;
      }
      const fAll = Math.max(focus, kImp * 0.9);
      let on = clamp((rise - 0.78) / 0.22);
      if (post) on *= 1 - smoothstep(0.05, 0.9, tl);
      h.bodyMat.uniforms.uRise.value = rise;
      h.bodyMat.uniforms.uFocus.value = fAll;
      h.bodyMat.uniforms.uGlow.value = 0.9 + focus * 0.9 + k2 * 1.0 + (post ? 1.5 * expl : 0);
      h.screenMat.uniforms.uOn.value = on;
      h.screenMat.uniforms.uFocus.value = fAll;
      const eruption = Math.sin(clamp(rise * 1.15) * Math.PI);
      const beamI = eruption * 1.0 + (rise >= 1 ? 0.14 : 0) * rise + focus * 0.12;
      h.beamMat.uniforms.uI.value = beamI;
      h.glowMat.uniforms.uI.value = eruption * 0.9 + 0.22 * rise + focus * 0.15;
    }
    this.sceneryMat.uniforms.uGlow.value = 0.85 + k2 * 0.8 + (post ? 1.2 * expl : 0);

    // ------------------------------------------------ arena sigil
    this.sigilMat.uniforms.uDraw.value = clamp((t - 12.5) / 13.5);
    this.sigilMat.uniforms.uI.value =
      (0.35 + 0.45 * smoothstep(12, 20, t) + k2 * 1.0) * (post ? 0.6 + 2.2 * Math.exp(-tl * 1.4) : 1);

    // ------------------------------------------------ dust
    this.dustMat.uniforms.uAlpha.value = 0.55 + 0.5 * smoothstep(0, 4, t);

    // ------------------------------------------------ singularity & explosion
    const pulseK = Math.sin(t * (4 + kImp * 9));
    if (!post) {
      const r = 0.06 + 0.55 * k2 + 0.035 * pulseK * kImp;
      this.core.visible = kImp > 0.02;
      this.core.scale.setScalar(r);
      this.coreMat.uniforms.uI.value = 0.9 * smoothstep(0.05, 1, kImp);
      this.coreMat.uniforms.uDisp.value = 0.3 + 0.3 * kImp;
      this.shell.visible = false;
      this.flare.visible = kImp > 0.05;
      this.billboard(this.flare, 2.0 + 9 * k2);
      this.flareMat.uniforms.uI.value = 0.4 * k2 + 0.08 * kImp;
      this.ring.visible = false;
    } else {
      const g = 1 + 13 * (1 - Math.pow(1 - clamp(tl / 1.0), 3));
      this.core.visible = tl < 2.5;
      this.core.scale.setScalar(g);
      this.coreMat.uniforms.uDisp.value = 0.8 + g * 0.15;
      this.coreMat.uniforms.uI.value = 1.3 * Math.exp(-tl * 3.4);
      this.shell.visible = tl < 3;
      this.shell.scale.setScalar(2 + tl * 48);
      this.shellMat.uniforms.uI.value = 0.8 * Math.exp(-tl * 2.1);
      this.flare.visible = tl < 4;
      this.billboard(this.flare, 18 + tl * 40);
      this.flareMat.uniforms.uI.value = 1.6 * Math.exp(-tl * 2.4);
      this.ring.visible = tl < 7;
      this.ringMat.uniforms.uR.value = tl * 66;
      this.ringMat.uniforms.uW.value = 1.4 + tl * 1.8;
      this.ringMat.uniforms.uI.value = 1.8 * Math.exp(-tl * 0.8);
    }
    this.blastMat.uniforms.uT.value = post ? tl : -1;
    this.blastMat.uniforms.uImplode.value = kImp;

    // ------------------------------------------------ logo
    this.logo.update(tl, t);
    const haloI = post ? 0.22 * smoothstep(0.4, 2.4, tl) + 0.9 * Math.exp(-Math.pow((tl - 4.05) / 0.4, 2)) : 0;
    this.halo.visible = post;
    this.billboard(this.halo, 20 + Math.sin(t * 0.6) * 0.6);
    this.halo.position.set(0, 5.8, 0).addScaledVector(this.tmpV.copy(cam.position).sub(BLAST_POS).normalize(), -2.5);
    this.haloMat.uniforms.uI.value = haloI;
    this.haloMat.uniforms.uTime.value = t;

    // ------------------------------------------------ post stack
    this.bloom.strength = 0.42 + 0.35 * kImp + (post ? 1.4 * Math.exp(-tl * 2.6) : 0);
    this.bloom.radius = 0.8;
    this.bloom.threshold = 1.0;
    const pu = this.post.uniforms;
    const flashPre = 0.5 * Math.pow(smoothstep(TL.explode - 0.45, TL.explode, t), 2);
    pu.uFlash.value = post ? 4.2 * Math.exp(-tl * 7) + 0.2 * Math.exp(-tl * 1.5) : flashPre;
    pu.uAber.value = 0.0004 + kFx * kFx * 0.004 + (post ? 0.012 * Math.exp(-tl * 2.2) : 0);
    pu.uZoom.value = post ? 0.34 * Math.exp(-tl * 3.0) : 0.07 * k3;
    pu.uVig.value = 0.55;
    pu.uGrain.value = 0.032;
    pu.uFade.value = warm ? 1 : 1 - smoothstep(0.6, 3.4, t);
    pu.uShockR.value = post ? tl * 0.78 : 0;
    pu.uShockAmp.value = post ? Math.exp(-tl * 1.7) : 0;
    this.tmpV.copy(BLAST_POS).project(cam);
    pu.uCenter.value.set(this.tmpV.x * 0.5 + 0.5, this.tmpV.y * 0.5 + 0.5);

    if (warm) return;

    // ------------------------------------------------ UI events
    const stage: Stage =
      t < TL.visit0 - 1.2
        ? "approach"
        : t < TL.implodeStart
          ? "monoliths"
          : t < TL.explode
            ? "collapse"
            : t < TL.logoText
              ? "logo"
              : t < TL.end
                ? "title"
                : "end";
    if (stage !== this.lastStage) {
      this.lastStage = stage;
      this.events.onStage?.(stage);
    }
    if (chapter !== this.lastChapter) {
      this.lastChapter = chapter;
      this.events.onChapter?.(chapter);
    }
    this.events.onProgress?.(clamp(t / TL.end), t);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    const seen = new Set<unknown>();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        const u = (mat as THREE.ShaderMaterial).uniforms;
        if (u) for (const k of Object.keys(u)) (u[k].value as THREE.Texture | null)?.dispose?.();
        mat.dispose();
      }
    });
    this.logo.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}

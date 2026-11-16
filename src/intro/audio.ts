import { HERO_COUNT, TL, riseStart, visitTime } from "./timeline";

/**
 * Fully procedural cinematic score: drone, rises, whooshes, impact, shimmering bells.
 * Everything is scheduled against the intro timeline so it stays in sync with the visuals.
 */
export class Score {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private wet: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  active = false;

  /** t0: current intro time (seconds) at the moment audio is started. */
  start(t0: number, getTime?: () => number) {
    this.stop();
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.2);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    // reverb from decaying noise
    const len = Math.floor(ctx.sampleRate * 3.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet);
    this.wet.connect(master);

    const nl = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, nl, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;

    // schedule only once the context is really running, using the *current* intro time,
    // so audio and picture stay in sync even if resume() takes a moment
    const go = () => {
      if (this.ctx !== ctx) return;
      this.active = true;
      this.schedule(getTime ? getTime() : t0);
    };
    if (ctx.state === "suspended") ctx.resume().then(go, go);
    else go();
  }

  /** pause / continue together with the picture (tab hidden) */
  suspend() {
    void this.ctx?.suspend().catch(() => undefined);
  }
  resume() {
    void this.ctx?.resume().catch(() => undefined);
  }

  stop() {
    this.active = false;
    if (this.master && this.ctx) {
      try {
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      } catch {
        /* noop */
      }
    }
    const old = this.ctx;
    this.ctx = null;
    this.master = null;
    if (old) setTimeout(() => void old.close().catch(() => undefined), 400);
  }

  private out(node: AudioNode, send = 0.3) {
    node.connect(this.master!);
    if (send > 0 && this.reverb) {
      const g = this.ctx!.createGain();
      g.gain.value = send;
      node.connect(g);
      g.connect(this.reverb);
    }
  }

  private noise(at: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack: number, send = 0.4) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    f.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f);
    f.connect(g);
    this.out(g, send);
    src.start(at);
    src.stop(at + dur + 0.1);
  }

  private tone(at: number, dur: number, freq: number, freqEnd: number, type: OscillatorType, peak: number, attack = 0.01, send = 0.3) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (freqEnd !== freq) o.frequency.exponentialRampToValueAtTime(freqEnd, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    this.out(g, send);
    o.start(at);
    o.stop(at + dur + 0.1);
  }

  private bell(at: number, freq: number, peak: number, dur = 4) {
    const partials = [1, 2.0, 2.76, 4.07, 5.4];
    partials.forEach((p, i) => this.tone(at, dur / (1 + i * 0.5), freq * p, freq * p, "sine", peak / (1 + i * 0.9), 0.004, 0.7));
  }

  private schedule(t0: number) {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const at = (t: number) => now + Math.max(0, t - t0);
    const future = (t: number) => t >= t0 - 0.05;

    // --- drone pad: detuned saws through a slowly opening filter
    const droneEnd = TL.explode;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 3;
    const startT = Math.max(t0, 0);
    if (startT < droneEnd) {
      lp.frequency.setValueAtTime(140 + (startT / droneEnd) * 100, now);
      lp.frequency.exponentialRampToValueAtTime(1400, at(droneEnd));
    } else {
      lp.frequency.setValueAtTime(500, now);
    }
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(0.0001, now);
    dg.gain.exponentialRampToValueAtTime(0.16, now + 2);
    dg.gain.setValueAtTime(0.16, at(droneEnd - 0.05));
    dg.gain.linearRampToValueAtTime(0.0, at(droneEnd + 0.1));
    lp.connect(dg);
    this.out(dg, 0.35);
    [55, 55.4, 82.2, 110.3].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i < 2 ? "sawtooth" : "triangle";
      o.frequency.value = f;
      o.connect(lp);
      o.start(now);
      o.stop(at(droneEnd + 0.3));
    });

    // --- post-explosion pad (warm major-ish chord)
    if (t0 < TL.end + 5) {
      const pg = ctx.createGain();
      const pStart = at(TL.explode + 0.3);
      pg.gain.setValueAtTime(0.0001, Math.max(now, pStart));
      pg.gain.exponentialRampToValueAtTime(0.1, Math.max(now, pStart) + 2.5);
      pg.gain.setTargetAtTime(0.0001, at(TL.end + 1.2), 1.4);
      const plp = ctx.createBiquadFilter();
      plp.type = "lowpass";
      plp.frequency.value = 1800;
      plp.connect(pg);
      this.out(pg, 0.6);
      [110, 164.8, 220, 277.2, 329.6].forEach((f) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        o.detune.value = (Math.random() - 0.5) * 14;
        const og = ctx.createGain();
        og.gain.value = 0.35;
        o.connect(og);
        og.connect(plp);
        o.start(Math.max(now, pStart));
        o.stop(at(TL.end + 8));
      });
    }

    // --- sweeps at the very beginning
    if (future(0.2)) this.noise(at(0.3), 4.5, "bandpass", 300, 2600, 1.2, 0.2, 2.5, 0.5);

    // --- monolith eruptions
    for (let i = 0; i < HERO_COUNT; i++) {
      const s = riseStart(i) + 0.4;
      if (!future(s)) continue;
      this.tone(at(s), 1.8, 90, 34, "sine", 0.55, 0.02, 0.5);
      this.noise(at(s), 2.4, "bandpass", 220, 1800, 0.9, 0.2, 1.2, 0.6);
      const v = visitTime(i) - 0.15;
      if (future(v)) {
        this.bell(at(v), [392, 440, 523.25, 587.33, 659.25][i % 5], 0.035, 2.2);
        this.noise(at(v - 0.5), 1.0, "highpass", 1500, 6000, 0.7, 0.05, 0.6, 0.4);
      }
    }

    // --- riser into the blast
    const r0 = TL.implodeStart - 0.4;
    if (future(TL.explode)) {
      const rs = Math.max(r0, t0);
      const rd = TL.explode - rs;
      this.noise(at(rs), rd, "bandpass", 400, 7500, 2, 0.5, rd * 0.9, 0.5);
      this.tone(at(rs), rd, 70 + (rs - r0) * 10, 900, "sawtooth", 0.07, rd * 0.9, 0.4);
      this.tone(at(rs), rd, 140, 1800, "triangle", 0.05, rd * 0.9, 0.4);
      // heartbeat
      for (let b = 0; b < 12; b++) {
        const bt = TL.implodeStart + b * (0.38 - b * 0.018);
        if (bt < TL.explode - 0.3 && future(bt)) this.tone(at(bt), 0.35, 70, 38, "sine", 0.35, 0.005, 0.2);
      }
    }

    // --- the explosion
    if (future(TL.explode)) {
      const e = at(TL.explode);
      this.tone(e, 3.2, 120, 24, "sine", 1.0, 0.004, 0.6);
      this.tone(e, 1.2, 60, 30, "square", 0.25, 0.004, 0.3);
      this.noise(e, 3.6, "lowpass", 5000, 120, 0.7, 0.9, 0.01, 0.7);
      this.noise(e, 0.8, "highpass", 3000, 9000, 0.5, 0.45, 0.01, 0.5);
      this.noise(e + 0.1, 5.0, "bandpass", 3500, 400, 3, 0.12, 0.3, 0.9);
    }

    // --- logo: bells, open click, arc sweep, glints
    const l0 = TL.explode;
    if (future(l0 + 0.5)) {
      [329.63, 493.88, 659.25, 987.77].forEach((f, i) => this.bell(at(l0 + 0.6 + i * 0.16), f, 0.07, 6));
    }
    if (future(l0 + 1.0)) {
      this.tone(at(l0 + 1.0), 0.12, 2400, 1200, "square", 0.05, 0.002, 0.4);
      this.noise(at(l0 + 1.0), 1.4, "bandpass", 800, 5000, 1.4, 0.1, 0.7, 0.5);
    }
    if (future(l0 + 2.4)) {
      this.noise(at(l0 + 2.4), 1.8, "bandpass", 1200, 7000, 4, 0.12, 1.2, 0.6);
      this.tone(at(l0 + 2.4), 1.7, 440, 1760, "sine", 0.05, 1.4, 0.7);
    }
    if (future(l0 + 4.0)) {
      this.bell(at(l0 + 4.0), 1174.66, 0.07, 6);
      this.bell(at(l0 + 4.0), 587.33, 0.06, 7);
      this.tone(at(l0 + 4.0), 3, 70, 36, "sine", 0.4, 0.01, 0.4);
    }
    if (future(TL.tagline)) this.bell(at(TL.tagline), 1567.98, 0.04, 5);

    // fade everything out at the end
    master_fade(this.master!, ctx, at(TL.end + 4), 3);
  }
}

function master_fade(g: GainNode, ctx: AudioContext, when: number, dur: number) {
  const w = Math.max(when, ctx.currentTime);
  g.gain.setValueAtTime(0.9, w);
  g.gain.linearRampToValueAtTime(0, w + dur);
}

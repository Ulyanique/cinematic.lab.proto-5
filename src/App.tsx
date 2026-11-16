import { useCallback, useEffect, useRef, useState } from "react";
import { IntroEngine, Stage } from "./intro/Engine";
import { HERO_COUNT, TL } from "./intro/timeline";
import { Score } from "./intro/audio";
import { clamp, easeInOutCubic, easeOutCubic, lerp, smoothstep } from "./intro/math";

const BRAND = "ЯНТАРНЫЙ ЦИРКУЛЬ";
const TAGLINE = "Вечер ретроспектива";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const formatTime = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = (safe % 60).toFixed(1).padStart(4, "0");
  return `${String(minutes).padStart(2, "0")}:${remainder}`;
};

async function loadFonts() {
  if (!document.fonts) return;
  const fonts = ['600 40px "Cinzel"', '300 14px "Inter"', '500 14px "Inter"', '700 40px "Inter"'];
  await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f).catch(() => []))), wait(3000)]);
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const seekingRef = useRef(false);
  const engineRef = useRef<IntroEngine | null>(null);

  // overlays are painted straight from the engine clock (transform / opacity only)
  const shadeRef = useRef<HTMLDivElement>(null);
  const letterRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const ruleRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const barTopRef = useRef<HTMLDivElement>(null);
  const barBottomRef = useRef<HTMLDivElement>(null);
  const cardTitleRef = useRef<HTMLDivElement>(null);
  const cardLineRef = useRef<HTMLDivElement>(null);
  const cardSubRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<Score | null>(null);
  const soundRef = useRef(false);
  const pausedRef = useRef(false);
  const resyncTimer = useRef<number | null>(null);

  const [stage, setStage] = useState<Stage>("approach");
  const [chapter, setChapter] = useState(0);
  const [paused, setPaused] = useState(false);
  const [sound, setSound] = useState(false);
  const [soundHint, setSoundHint] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<number | null>(null);

  const resetControlsTimer = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer.current !== null) window.clearTimeout(controlsTimer.current);
    controlsTimer.current = window.setTimeout(() => setControlsVisible(false), 1800);
  }, []);

  useEffect(() => {
    const onActivity = () => resetControlsTimer();
    window.addEventListener("pointermove", onActivity);
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);
    resetControlsTimer();
    return () => {
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      if (controlsTimer.current !== null) window.clearTimeout(controlsTimer.current);
    };
  }, [resetControlsTimer]);

  const paint = useCallback((t: number) => {
    // ---- brand reveal: letter by letter, then a light wave runs across the gold
    const n = BRAND.length;
    const sweepT = t - (TL.logoText + 2.6);
    const sweepPos = sweepT > 0 && sweepT % 7 < 2 ? -2 + ((sweepT % 7) / 2) * (n + 4) : -99;
    for (let i = 0; i < n; i++) {
      const el = letterRefs.current[i];
      if (!el) continue;
      const s = clamp((t - (TL.logoText + i * 0.11)) / 1.25);
      const e = easeOutCubic(s);
      const k = Math.exp(-Math.pow((i + 0.5 - sweepPos) / 1.1, 2));
      el.style.opacity = String(e);
      el.style.transform = `translate3d(0, ${(1 - e) * 22}px, 0) scale(${1.05 - 0.05 * e})`;
      const blur = (1 - e) * 9;
      const parts: string[] = [];
      if (blur > 0.15) parts.push(`blur(${blur.toFixed(2)}px)`);
      if (k > 0.01) parts.push(`brightness(${(1 + 0.65 * k).toFixed(3)})`);
      el.style.filter = parts.length ? parts.join(" ") : "none";
    }
    // ---- anamorphic letterbox: opens from a black slit, then punches outward with the blast
    const open = easeInOutCubic((t - 0.3) / 3.4);
    const punch = easeOutCubic((t - TL.explode) / 1.6);
    const bar = lerp(50, 7.2, open) - 4.4 * punch;
    const barT = `scaleY(${(bar / 50).toFixed(4)})`;
    if (barTopRef.current) barTopRef.current.style.transform = barT;
    if (barBottomRef.current) barBottomRef.current.style.transform = barT;
    // ---- opening card
    const cardOut = 1 - smoothstep(3.3, 4.6, t);
    const cin = smoothstep(0.7, 2.1, t);
    if (cardTitleRef.current) {
      cardTitleRef.current.style.opacity = String(cin * cardOut);
      cardTitleRef.current.style.transform = `translate3d(0, ${(1 - cin) * 8}px, 0)`;
      cardTitleRef.current.style.filter = `blur(${((1 - cin) * 6).toFixed(2)}px)`;
    }
    if (cardLineRef.current) {
      cardLineRef.current.style.transform = `scaleX(${easeOutCubic((t - 1.0) / 1.8)})`;
      cardLineRef.current.style.opacity = String(smoothstep(1.0, 1.6, t) * cardOut);
    }
    if (cardSubRef.current) {
      const a = smoothstep(1.7, 3.0, t);
      cardSubRef.current.style.opacity = String(a * cardOut * 0.9);
      cardSubRef.current.style.transform = `translate3d(0, ${(1 - a) * 6}px, 0)`;
    }
    if (shadeRef.current) shadeRef.current.style.opacity = String(smoothstep(TL.logoText - 0.4, TL.logoText + 1.8, t));
    if (ruleRef.current) {
      const r = easeOutCubic((t - (TL.logoText + 1.1)) / 1.5);
      ruleRef.current.style.transform = `scaleX(${r})`;
      ruleRef.current.style.opacity = String(smoothstep(TL.logoText + 1.1, TL.logoText + 1.8, t));
    }
    if (tagRef.current) {
      const a = smoothstep(TL.tagline, TL.tagline + 1.8, t);
      tagRef.current.style.opacity = String(a * 0.85);
      tagRef.current.style.transform = `translate3d(0, ${(1 - a) * 10}px, 0)`;
    }
  }, []);

  useEffect(() => {
    if (!mountRef.current) return;
    let cancelled = false;
    let engine: IntroEngine | null = null;
    const q = new URLSearchParams(window.location.search).get("t");
    const fixed = q !== null && !Number.isNaN(parseFloat(q)) ? parseFloat(q) : null;

    // fonts first (no swap-flicker, crisp type on the monolith screens), then the heavy WebGL setup
    void loadFonts().then(() => {
      if (cancelled || !mountRef.current) return;
      engine = new IntroEngine(
        mountRef.current,
        {
          onProgress: (_f, t) => {
            if (progressRef.current && !seekingRef.current) progressRef.current.value = String(t);
            if (timeRef.current) timeRef.current.textContent = `${formatTime(t)} / ${formatTime(TL.end)}`;
            paint(t);
          },
          onChapter: setChapter,
          onStage: (next) => {
            setStage(next);
            if (next === "end") {
              pausedRef.current = true;
              setPaused(true);
            }
          },
        },
        fixed
      );
      engineRef.current = engine;
    });

    return () => {
      cancelled = true;
      engine?.dispose();
      engineRef.current = null;
    };
  }, [paint]);

  // ---------------------------------------------------------------- score (procedural audio)
  const startScore = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !soundRef.current) return;
    scoreRef.current ??= new Score();
    scoreRef.current.start(engine.time, () => engine.time);
  }, []);

  const stopScore = useCallback(() => {
    scoreRef.current?.stop();
  }, []);

  const toggleSound = useCallback(() => {
    const next = !soundRef.current;
    soundRef.current = next;
    setSound(next);
    setSoundHint(false);
    if (next && !pausedRef.current) startScore();
    else stopScore();
  }, [startScore, stopScore]);

  const togglePlayback = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.isPaused) {
      engine.resume();
      pausedRef.current = false;
      setPaused(false);
      startScore();
    } else {
      engine.pause();
      pausedRef.current = true;
      setPaused(true);
      stopScore();
    }
  }, [startScore, stopScore]);

  const replay = useCallback(() => {
    engineRef.current?.restart();
    pausedRef.current = false;
    setPaused(false);
    setChapter(0);
    startScore();
  }, [startScore]);

  const resyncAudioSoon = useCallback(() => {
    if (!soundRef.current) return;
    stopScore();
    if (resyncTimer.current !== null) window.clearTimeout(resyncTimer.current);
    resyncTimer.current = window.setTimeout(() => {
      if (!seekingRef.current && !pausedRef.current) startScore();
    }, 260);
  }, [startScore, stopScore]);

  useEffect(() => {
    const hint = window.setTimeout(() => setSoundHint(false), 11000);
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.key !== " ") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (engineRef.current && !(engineRef.current.time >= TL.end)) togglePlayback();
      } else if (e.key === "m" || e.key === "M" || e.key === "ь" || e.key === "Ь") {
        toggleSound();
      } else if (e.key === "f" || e.key === "F" || e.key === "а" || e.key === "А") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
      }
    };
    const onVis = () => {
      if (document.hidden) stopScore();
      else if (!pausedRef.current) startScore();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(hint);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVis);
      if (resyncTimer.current !== null) window.clearTimeout(resyncTimer.current);
      scoreRef.current?.stop();
    };
  }, [togglePlayback, toggleSound, startScore, stopScore]);

  return (
    <div
      className="app-shell fixed inset-0 grid place-items-center overflow-hidden bg-black select-none"
      style={{ cursor: controlsVisible ? "default" : "none" }}
    >
      <div className="cinema-frame">
      <div ref={mountRef} className="absolute inset-0" />

      {/* anamorphic letterbox */}
      <div ref={barTopRef} className="letterbox letterbox-top" />
      <div ref={barBottomRef} className="letterbox letterbox-bottom" />

      {/* opening card */}
      <div className="card" aria-hidden="true">
        <div ref={cardTitleRef} className="card-title">
          CINEMATIC LAB
        </div>
        <div ref={cardLineRef} className="card-line" />
        <div ref={cardSubRef} className="card-sub">
          ПРЕДСТАВЛЯЕТ
        </div>
      </div>

      {/* chapter HUD */}
      <div
        className="absolute left-[4vw] z-[15] font-mono text-[11px] tracking-[0.35em] text-amber-200/80"
        style={{ bottom: "56px" }}
      >
        <div
          className="transition-[opacity,transform] duration-500"
          style={{ opacity: chapter > 0 ? 1 : 0, transform: chapter > 0 ? "translateY(0)" : "translateY(6px)" }}
        >
          <span key={chapter} className="chapter-num inline-block text-amber-300">
            {String(Math.max(chapter, 1)).padStart(2, "0")}
          </span>
          <span className="opacity-50"> / {String(HERO_COUNT).padStart(2, "0")}</span>
          <span className="ml-4 opacity-70">VIDEO</span>
        </div>
      </div>

      {/* brand title under the compass – always mounted, painted from the film clock */}
      <div className="brand-wrap">
        <div ref={shadeRef} className="brand-shade" />
        <div className="brand brand-long" aria-label={BRAND}>
          {BRAND.split("").map((ch, i) => (
            <span
              key={i}
              ref={(el) => {
                letterRefs.current[i] = el;
              }}
              className={ch === " " ? "glyph glyph-space" : "glyph"}
              aria-hidden="true"
            >
              {ch}
            </span>
          ))}
        </div>
        <div ref={ruleRef} className="brand-rule" />
        <div ref={tagRef} className="tagline">
          {TAGLINE}
        </div>
      </div>

      {/* first-visit hint: browsers only allow audio after a gesture */}
      <button
        type="button"
        onClick={toggleSound}
        className="sound-hint"
        tabIndex={-1}
        style={{ opacity: soundHint && !sound ? 1 : 0, pointerEvents: soundHint && !sound ? "auto" : "none" }}
      >
        <span className="sound-hint-dot" /> ВКЛЮЧИТЬ ЗВУК · M
      </button>

      {/* seekable film timeline with an explicit seconds readout */}
      <div
        className="absolute inset-x-[3vw] bottom-[8px] z-20 flex items-center gap-3 transition-opacity duration-500"
        style={{ opacity: controlsVisible ? 1 : 0, pointerEvents: controlsVisible ? "auto" : "none" }}
      >
        {stage !== "end" && (
          <button
            type="button"
            onClick={togglePlayback}
            aria-label={paused ? "Продолжить воспроизведение" : "Поставить на паузу"}
            className="min-w-[94px] rounded-full border border-amber-300/35 bg-black/40 px-3 py-1.5 font-mono text-[9px] tracking-[0.2em] text-amber-200/90 hover:border-amber-300/80"
          >
            {paused ? "ПРОДОЛЖИТЬ" : "ПАУЗА"}
          </button>
        )}
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={sound}
          aria-label={sound ? "Выключить звук" : "Включить звук"}
          className={"sound-btn" + (sound ? " is-on" : "")}
        >
          <span className="eq" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <i key={i} style={{ animationDelay: `${i * -0.23}s`, animationPlayState: sound && !paused ? "running" : "paused" }} />
            ))}
          </span>
          {sound ? "ЗВУК" : "ЗВУК ВЫКЛ"}
        </button>
        <span ref={timeRef} className="min-w-[92px] font-mono text-[10px] tracking-[0.18em] text-amber-200/80">
          00:00.0 / 00:43.5
        </span>
        <input
          ref={progressRef}
          aria-label="Перемотка по таймлайну, секунды"
          type="range"
          min={0}
          max={TL.end}
          step={0.1}
          defaultValue={0}
          onPointerDown={() => { seekingRef.current = true; }}
          onPointerUp={() => { seekingRef.current = false; resyncAudioSoon(); }}
          onPointerCancel={() => { seekingRef.current = false; resyncAudioSoon(); }}
          onBlur={() => { seekingRef.current = false; }}
          onInput={(event) => {
            const seconds = Number(event.currentTarget.value);
            if (timeRef.current) timeRef.current.textContent = `${formatTime(seconds)} / ${formatTime(TL.end)}`;
            engineRef.current?.seek(seconds);
            resyncAudioSoon();
          }}
          className="h-5 min-w-0 flex-1 cursor-pointer accent-amber-300"
        />
        {stage === "end" && (
          <button type="button" onClick={replay} className="replay replay-inline">
            <span className="text-base leading-none">↻</span> ПОВТОРИТЬ
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

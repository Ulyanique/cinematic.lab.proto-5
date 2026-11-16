import { useCallback, useEffect, useRef, useState } from "react";
import { IntroEngine, Stage } from "./intro/Engine";
import { Score } from "./intro/audio";
import { HERO_COUNT, TL } from "./intro/timeline";
import { clamp, easeOutCubic, smoothstep } from "./intro/math";

const BRAND = "ЯНТАРНЫЙ ЦИРКУЛЬ";
const TAGLINE = "Вечер ретроспектива";
const CARD_TITLE = "CINEMATIC LAB";
const CARD_SUB = "PROTO · 05";

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
  const scoreRef = useRef<Score | null>(null);
  const soundRef = useRef(false);

  // overlays are painted straight from the engine clock (transform / opacity only)
  const cardRef = useRef<HTMLDivElement>(null);
  const cardLineRef = useRef<HTMLDivElement>(null);
  const cardTitleRef = useRef<HTMLDivElement>(null);
  const cardSubRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const letterRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const ruleRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);

  const [stage, setStage] = useState<Stage>("approach");
  const [chapter, setChapter] = useState(0);
  const [sound, setSound] = useState(false);
  const [paused, setPaused] = useState(false);

  const getTime = useCallback(() => engineRef.current?.time ?? 0, []);

  const enableSound = useCallback(() => {
    if (soundRef.current) return;
    soundRef.current = true;
    setSound(true);
    scoreRef.current?.start(getTime(), getTime);
  }, [getTime]);

  const toggleSound = useCallback(() => {
    if (soundRef.current) {
      soundRef.current = false;
      setSound(false);
      scoreRef.current?.stop();
    } else {
      enableSound();
    }
  }, [enableSound]);

  const paint = useCallback((t: number) => {
    // ---- opening title card
    const card = cardRef.current;
    if (card) {
      const gone = t > 4.8;
      card.style.visibility = gone ? "hidden" : "visible";
      if (!gone) {
        const out = 1 - smoothstep(3.1, 4.5, t);
        const line = cardLineRef.current!;
        line.style.transform = `scaleX(${easeOutCubic((t - 0.3) / 1.9)})`;
        line.style.opacity = String(smoothstep(0.2, 0.9, t) * out);
        const a = smoothstep(1.0, 2.3, t) * out;
        const title = cardTitleRef.current!;
        title.style.opacity = String(a);
        title.style.transform = `translate3d(0, ${(1 - easeOutCubic((t - 1.0) / 1.6)) * 10}px, 0)`;
        const b = smoothstep(1.5, 2.8, t) * out;
        const sub = cardSubRef.current!;
        sub.style.opacity = String(b * 0.75);
        sub.style.transform = `translate3d(0, ${(1 - easeOutCubic((t - 1.5) / 1.6)) * 8}px, 0)`;
      }
    }

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
      el.style.filter = k > 0.01 ? `brightness(${(1 + 0.65 * k).toFixed(3)})` : "none";
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
    const score = new Score();
    scoreRef.current = score;
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
          onStage: setStage,
        },
        fixed
      );
      engineRef.current = engine;
    });

    // browsers only allow audio after a gesture: start the score on the first interaction
    const onGesture = () => enableSound();
    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });
    // keep sound and picture in lock-step when the tab is hidden
    const onVis = () => {
      if (!soundRef.current) return;
      if (document.hidden) score.suspend();
      else score.resume();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      document.removeEventListener("visibilitychange", onVis);
      score.stop();
      engine?.dispose();
      engineRef.current = null;
    };
  }, [enableSound, paint]);

  const togglePlayback = () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.isPaused) {
      engine.resume();
      setPaused(false);
    } else {
      engine.pause();
      setPaused(true);
    }
  };

  const replay = () => {
    engineRef.current?.restart();
    setPaused(false);
    setChapter(0);
    if (soundRef.current) scoreRef.current?.start(0, getTime);
  };

  return (
    <div className="app-shell fixed inset-0 grid place-items-center overflow-hidden bg-black select-none" style={{ cursor: "default" }}>
      <div className="cinema-frame">
      <div ref={mountRef} className="absolute inset-0" />

      {/* opening title card */}
      <div ref={cardRef} className="card">
        <div ref={cardTitleRef} className="card-title">
          {CARD_TITLE}
        </div>
        <div ref={cardLineRef} className="card-line" />
        <div ref={cardSubRef} className="card-sub">
          {CARD_SUB}
        </div>
      </div>

      {/* chapter HUD */}
      <div
        className="absolute left-[4vw] z-10 font-mono text-[11px] tracking-[0.35em] text-amber-200/80"
        style={{ bottom: "22px" }}
      >
        <div
          className="transition-[opacity,transform] duration-500"
          style={{ opacity: chapter > 0 ? 1 : 0, transform: chapter > 0 ? "translateY(0)" : "translateY(6px)" }}
        >
          <span className="text-amber-300">{String(Math.max(chapter, 1)).padStart(2, "0")}</span>
          <span className="opacity-50"> / {String(HERO_COUNT).padStart(2, "0")}</span>
          <span className="ml-4 opacity-70">VIDEO</span>
        </div>
      </div>

      {/* sound toggle */}
      <button
        onPointerDown={(e) => e.stopPropagation()} // the global first-gesture hook must not fight the toggle
        onClick={toggleSound}
        className="absolute right-[4vw] z-20 flex items-center gap-2 rounded-full border border-amber-300/30 bg-black/30 px-4 py-2 font-mono text-[10px] tracking-[0.3em] text-amber-200/90 backdrop-blur-sm transition hover:border-amber-300/80 hover:bg-amber-300/10"
        style={{ bottom: "18px" }}
      >
        <span className="flex h-3 items-end gap-[2px]">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="w-[2px] origin-bottom bg-amber-300"
              style={{
                height: 12,
                transform: sound ? undefined : "scaleY(0.25)",
                animation: sound ? `eq ${0.7 + i * 0.17}s ease-in-out ${i * 0.1}s infinite alternate` : undefined,
              }}
            />
          ))}
        </span>
        {sound ? "SOUND ON" : "SOUND OFF"}
      </button>

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
              className="glyph"
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

      {/* replay */}
      {stage === "end" && (
        <button onClick={replay} className="replay">
          <span className="text-base leading-none">↻</span> ПОВТОРИТЬ
        </button>
      )}

      {/* seekable film timeline with an explicit seconds readout */}
      <div className="absolute inset-x-[4vw] bottom-[54px] z-20 flex items-center gap-4">
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={paused ? "Продолжить воспроизведение" : "Поставить на паузу"}
          className="min-w-[94px] rounded-full border border-amber-300/35 bg-black/40 px-3 py-1.5 font-mono text-[9px] tracking-[0.2em] text-amber-200/90 hover:border-amber-300/80"
        >
          {paused ? "ПРОДОЛЖИТЬ" : "ПАУЗА"}
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
          onPointerUp={() => { seekingRef.current = false; }}
          onPointerCancel={() => { seekingRef.current = false; }}
          onBlur={() => { seekingRef.current = false; }}
          onInput={(event) => {
            const seconds = Number(event.currentTarget.value);
            if (timeRef.current) timeRef.current.textContent = `${formatTime(seconds)} / ${formatTime(TL.end)}`;
            engineRef.current?.seek(seconds);
          }}
          className="h-5 min-w-0 flex-1 cursor-pointer accent-amber-300"
        />
      </div>
      </div>
    </div>
  );
}

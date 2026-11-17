import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { IntroEngine, Stage } from "./intro/Engine";
import { ExportPanel } from "./ExportPanel";
import { SettingsPanel } from "./SettingsPanel";
import { loadSettings, saveSettings, type FilmSettings } from "./intro/settings";
import { captureOverlay } from "./intro/captureOverlay";
import { drawCornerRings } from "./intro/cornerRings";
import { TL } from "./intro/timeline";
import { glyphExit, subtitleExit } from "./intro/finalExit";
import { clamp, easeInOutCubic, easeOutCubic, lerp, smoothstep } from "./intro/math";

const exportMode = new URLSearchParams(window.location.search).get("export") === "1";

declare global {
  interface Window {
    cinematicExport?: { ready: Promise<void>; renderFrame: (frame: number, fps: number) => Promise<void>; drawFrame: (ctx: CanvasRenderingContext2D) => void; duration: number };
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const formatTime = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = (safe % 60).toFixed(1).padStart(4, "0");
  return `${String(minutes).padStart(2, "0")}:${remainder}`;
};

async function loadFonts(settings: FilmSettings) {
  if (!document.fonts) return;
  const fonts = ['400 40px "Prata"', '400 20px "Forum"', '500 40px "Inter"'];
  const text = settings.title + " " + settings.subtitle;
  if (exportMode) {
    await Promise.all(fonts.map((f) => document.fonts.load(f, text)));
    await document.fonts.ready;
  } else {
    await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f, text).catch(() => []))), wait(3000)]);
  }
}

export default function App() {
  const [settings, setSettings] = useState<FilmSettings>(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const mountRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
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
  const ringsRef = useRef<HTMLCanvasElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>("approach");
  const [paused, setPaused] = useState(false);
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
    const settings = settingsRef.current;
    const n = Array.from(settings.title).length;
    const sweepT = t - (TL.logoText + 2.6);
    const sweepPos = sweepT > 0 && sweepT % 7 < 2 ? -2 + ((sweepT % 7) / 2) * (n + 4) : -99;
    for (let i = 0; i < n; i++) {
      const el = letterRefs.current[i];
      if (!el) continue;
      const s = clamp((t - (TL.logoText + i * 0.11 / settings.revealSpeed)) / (1.25 / settings.revealSpeed));
      const e = easeOutCubic(s);
      const k = Math.exp(-Math.pow((i + 0.5 - sweepPos) / 1.1, 2));
      const exit = glyphExit(t, i);
      el.style.opacity = String(e * (1 - exit) * (settings.showTitle ? 1 : 0));
      el.style.transform = `translate3d(0, ${(1 - e) * 22 - exit * 12 * settings.exitMotion}px, 0) scale(${(1.05 - 0.05 * e) * (1 - Math.min(.8, 0.35 * settings.exitMotion) * exit)})`;
      const blur = (1 - e) * 9;
      const parts: string[] = [];
      if (blur > 0.15) parts.push(`blur(${blur.toFixed(2)}px)`);
      if (k > 0.01) parts.push(`brightness(${(1 + 0.65 * k).toFixed(3)})`);
      el.style.filter = parts.length ? parts.join(" ") : "none";
    }
    // ---- anamorphic letterbox: opens from a black slit, then punches outward with the blast
    const open = easeInOutCubic((t - 0.3) / 3.4);
    const punch = easeOutCubic((t - TL.explode) / 1.6);
    const bar = (lerp(50, 7.2, open) - 4.4 * punch) * (1 - smoothstep(TL.explode, TL.logoText, t));
    const barT = `scaleY(${(bar / 50).toFixed(4)})`;
    if (barTopRef.current) barTopRef.current.style.transform = barT;
    if (barBottomRef.current) barBottomRef.current.style.transform = barT;
    if (fadeRef.current) fadeRef.current.style.opacity = String(smoothstep(TL.fadeOutStart, TL.fadeOutEnd, t));
    const rings = ringsRef.current;
    const frame = frameRef.current;
    if (rings && frame) {
      const width = frame.clientWidth, height = frame.clientHeight;
      const pr = exportMode ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      const pw = Math.round(width * pr), ph = Math.round(height * pr);
      if (rings.width !== pw || rings.height !== ph) { rings.width = pw; rings.height = ph; }
      const context = rings.getContext("2d");
      if (context && width > 0 && height > 0) {
        context.setTransform(pr, 0, 0, pr, 0, 0);
        drawCornerRings(context, t, width, height, settings);
      }
    }
    if (shadeRef.current) shadeRef.current.style.opacity = String(smoothstep(TL.logoText - 0.4, TL.logoText + 1.8, t) * (settings.showTitle || settings.showSubtitle ? 1 : 0));
    if (ruleRef.current) {
      const r = easeOutCubic((t - (TL.logoText + 1.1)) / 1.5);
      const exit = subtitleExit(t);
      ruleRef.current.style.transform = `scaleX(${r * (1 - exit)})`;
      ruleRef.current.style.opacity = String(smoothstep(TL.logoText + 1.1, TL.logoText + 1.8, t) * (1 - exit) * (settings.showTitle || settings.showSubtitle ? 1 : 0));
    }
    if (tagRef.current) {
      const a = smoothstep(TL.tagline, TL.tagline + 1.8, t);
      const exit = subtitleExit(t);
      tagRef.current.style.opacity = String(a * 0.85 * (1 - exit) * (settings.showSubtitle ? 1 : 0));
      tagRef.current.style.transform = `translate3d(0, ${(1 - a) * 10 - 8 * exit}px, 0)`;
    }
  }, []);

  useEffect(() => {
    if (!mountRef.current) return;
    let cancelled = false;
    let engine: IntroEngine | null = null;
    const q = new URLSearchParams(window.location.search).get("t");
    const fixed = q !== null && !Number.isNaN(parseFloat(q)) ? parseFloat(q) : null;

    // Expose an explicit barrier for frame exporters, including async image/video loads.
    const ready = loadFonts(settingsRef.current).then(async () => {
      if (cancelled || !mountRef.current) return;
      engine = new IntroEngine(
        mountRef.current,
        {
          onProgress: (_f, t) => {
            if (progressRef.current && !seekingRef.current) progressRef.current.value = String(t);
            if (timeRef.current) timeRef.current.textContent = `${formatTime(t)} / ${formatTime(TL.end)}`;
            paint(t);
          },
          onStage: (next) => {
            setStage(next);
            if (next === "end") {
              setPaused(true);
            }
          },
        },
        fixed,
        settingsRef.current
      );
      engineRef.current = engine;
      if (exportMode) await engine.ready;
    });
    const api = {
      ready,
      duration: TL.end,
      renderFrame: async (frame: number, fps: number) => {
        if (!Number.isInteger(frame) || frame < 0 || !Number.isFinite(fps) || fps <= 0) throw new Error("Некорректный номер кадра или FPS");
        await ready;
        if (!engine) throw new Error("Движок не готов");
        await engine.renderFrame(frame / fps);
      },
      drawFrame: (ctx: CanvasRenderingContext2D) => {
        if (!engine || !frameRef.current) throw new Error("Движок не готов");
        const canvas = engine.canvas;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.save();
        ctx.filter = `hue-rotate(${settingsRef.current.hue}deg) saturate(${settingsRef.current.saturation})`;
        ctx.drawImage(canvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
        ctx.save();
        ctx.scale(ctx.canvas.width / frameRef.current.clientWidth, ctx.canvas.height / frameRef.current.clientHeight);
        captureOverlay(ctx, frameRef.current);
        ctx.restore();
      },
    };
    if (exportMode) window.cinematicExport = api;
    void ready.catch(error => console.error("Ошибка подготовки ролика:", error));

    return () => {
      cancelled = true;
      if (window.cinematicExport === api) delete window.cinematicExport;
      engine?.dispose();
      engineRef.current = null;
    };
  }, [paint]);

  useLayoutEffect(() => {
    const engine = engineRef.current;
    if (engine) engine.setSettings(settings);
    if (engine) paint(engine.time);
  }, [settings, paint]);

  const updateSettings = (next: FilmSettings) => {
    saveSettings(next);
    setSettings(next);
  };

  const togglePlayback = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.isPaused) {
      engine.resume();
      setPaused(false);
    } else {
      engine.pause();
      setPaused(true);
    }
  }, []);

  const replay = useCallback(() => {
    engineRef.current?.restart();
    setPaused(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest(".settings-panel, .export-viewer")) return;
      if (e.target instanceof HTMLInputElement && e.key !== " ") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (engineRef.current && !(engineRef.current.time >= TL.end)) togglePlayback();
      } else if (e.key === "f" || e.key === "F" || e.key === "а" || e.key === "А") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlayback]);

  return (
    <div
      className={"app-shell fixed inset-0 grid place-items-center overflow-hidden bg-black select-none" + (exportMode ? " export-mode" : "")}
      style={{ cursor: controlsVisible ? "default" : "none" }}
    >
      <div ref={frameRef} className="cinema-frame" style={{
        '--title-font': `"${settings.titleFont}", serif`,
        '--title-size': settings.titleScale * Math.min(1, 19 / Math.max(1, Array.from(settings.title).length)),
        '--title-spacing': `${settings.titleSpacing}em`,
        '--subtitle-font': `"${settings.subtitleFont}", serif`, '--subtitle-spacing': `${settings.subtitleSpacing}em`, '--title-position': `${settings.titlePosition}%`,
        '--subtitle-size': settings.subtitleScale * Math.min(1, 25 / Math.max(1, Array.from(settings.subtitle).length)),
        '--title-light': settings.titleLight, '--title-mid': settings.titleMid, '--title-gold': settings.titleGold, '--title-dark': settings.titleDark,
        '--subtitle-color': settings.subtitleColor,
      } as CSSProperties}>
      <div ref={mountRef} className="absolute inset-0" style={{ filter: `hue-rotate(${settings.hue}deg) saturate(${settings.saturation})` }} />

      {/* anamorphic letterbox */}
      <div ref={barTopRef} className="letterbox letterbox-top" />
      <div ref={barBottomRef} className="letterbox letterbox-bottom" />

      <canvas ref={ringsRef} className="corner-rings" aria-hidden="true" />

      {/* brand title under the compass – always mounted, painted from the film clock */}
      <div className="brand-wrap">
        <div ref={shadeRef} className="brand-shade" />
        <div className="brand brand-long" aria-label={settings.title}>
          {Array.from(settings.title).map((ch, i) => (
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
          {settings.subtitle}
        </div>
      </div>

      <div ref={fadeRef} className="film-fade" aria-hidden="true" />

      {!exportMode && <ExportPanel settings={settings} onStart={() => {
        engineRef.current?.pause();
        setPaused(true);
      }} />}

      {/* seekable film timeline with an explicit seconds readout */}
      <div
        className="player-ui absolute inset-x-[3vw] bottom-[8px] z-20 flex items-center gap-3 transition-opacity duration-500"
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
        <span ref={timeRef} className="min-w-[92px] font-mono text-[10px] tracking-[0.18em] text-amber-200/80">
          00:00.0 / {formatTime(TL.end)}
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
        {stage === "end" && (
          <button type="button" onClick={replay} className="replay replay-inline">
            <span className="text-base leading-none">↻</span> ПОВТОРИТЬ
          </button>
        )}
      </div>
      </div>
      {!exportMode && <SettingsPanel settings={settings} onChange={updateSettings} />}
    </div>
  );
}

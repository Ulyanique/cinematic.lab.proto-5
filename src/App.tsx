import { useCallback, useEffect, useRef, useState } from "react";
import { IntroEngine, Stage } from "./intro/Engine";
import { Score } from "./intro/audio";
import { HERO_COUNT } from "./intro/timeline";

const BRAND = "CIRCINUS";
const TAGLINE = "PRECISION  ·  IN EVERY  ARC";

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<IntroEngine | null>(null);
  const scoreRef = useRef<Score | null>(null);
  const [stage, setStage] = useState<Stage>("approach");
  const [chapter, setChapter] = useState(0);
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false);

  const enableSound = useCallback(() => {
    if (soundRef.current) return;
    soundRef.current = true;
    setSound(true);
    scoreRef.current?.start(engineRef.current?.time ?? 0);
  }, []);

  const toggleSound = useCallback(() => {
    if (soundRef.current) {
      soundRef.current = false;
      setSound(false);
      scoreRef.current?.stop();
    } else {
      enableSound();
    }
  }, [enableSound]);

  useEffect(() => {
    if (!mountRef.current) return;
    const q = new URLSearchParams(window.location.search).get("t");
    const fixed = q !== null && !Number.isNaN(parseFloat(q)) ? parseFloat(q) : null;
    scoreRef.current = new Score();
    const engine = new IntroEngine(
      mountRef.current,
      {
        onProgress: (f) => {
          if (progressRef.current) progressRef.current.style.transform = `scaleX(${f})`;
        },
        onChapter: setChapter,
        onStage: setStage,
      },
      fixed
    );
    engineRef.current = engine;

    // browsers only allow audio after a gesture: start the score on the first interaction
    const onGesture = () => enableSound();
    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });

    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      scoreRef.current?.stop();
      engine.dispose();
      engineRef.current = null;
    };
  }, [enableSound]);

  const replay = () => {
    engineRef.current?.restart();
    setChapter(0);
    if (soundRef.current) scoreRef.current?.start(0);
  };

  const showTitle = stage === "title" || stage === "end";

  return (
    <div className="fixed inset-0 overflow-hidden bg-black select-none" style={{ cursor: "default" }}>
      <div ref={mountRef} className="absolute inset-0" />

      {/* cinematic letterbox */}
      <div className="bar bar-top" />
      <div className="bar bar-bottom" />

      {/* chapter HUD */}
      <div className="absolute left-[4vw] z-10 font-mono text-[11px] tracking-[0.35em] text-amber-200/80" style={{ bottom: "calc(var(--bar) + 22px)" }}>
        <div
          className="transition-all duration-500"
          style={{ opacity: chapter > 0 ? 1 : 0, transform: chapter > 0 ? "translateY(0)" : "translateY(6px)" }}
        >
          <span className="text-amber-300">{String(Math.max(chapter, 1)).padStart(2, "0")}</span>
          <span className="opacity-50"> / {String(HERO_COUNT).padStart(2, "0")}</span>
          <span className="ml-4 opacity-70">VIDEO</span>
        </div>
      </div>

      {/* sound toggle */}
      <button
        onClick={toggleSound}
        className="absolute right-[4vw] z-20 flex items-center gap-2 rounded-full border border-amber-300/30 bg-black/30 px-4 py-2 font-mono text-[10px] tracking-[0.3em] text-amber-200/90 backdrop-blur-sm transition hover:border-amber-300/80 hover:bg-amber-300/10"
        style={{ bottom: "calc(var(--bar) + 18px)" }}
      >
        <span className="flex h-3 items-end gap-[2px]">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="w-[2px] bg-amber-300"
              style={{
                height: sound ? undefined : 3,
                animation: sound ? `eq ${0.7 + i * 0.17}s ease-in-out ${i * 0.1}s infinite alternate` : undefined,
              }}
            />
          ))}
        </span>
        {sound ? "SOUND ON" : "SOUND OFF"}
      </button>

      {/* brand title under the compass */}
      {showTitle && (
        <div className="brand-wrap" key="brand">
          <div className="brand">{BRAND}</div>
          <div className="tagline">{TAGLINE}</div>
        </div>
      )}

      {/* replay */}
      {stage === "end" && (
        <button onClick={replay} className="replay">
          <span className="text-base leading-none">↻</span> ПОВТОРИТЬ
        </button>
      )}

      {/* progress */}
      <div className="absolute inset-x-0 bottom-0 z-20 h-[2px] bg-amber-200/10">
        <div ref={progressRef} className="h-full origin-left bg-gradient-to-r from-amber-700 via-amber-300 to-amber-100" style={{ transform: "scaleX(0)" }} />
      </div>
    </div>
  );
}

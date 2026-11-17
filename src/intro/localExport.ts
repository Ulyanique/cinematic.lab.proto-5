import type { FilmSettings } from './settings';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, canEncodeVideo } from 'mediabunny';

export const EXPORT_FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

type ExportApi = NonNullable<Window['cinematicExport']>;
interface ExportOptions {
  signal: AbortSignal;
  onProgress: (frame: number, total: number, phase: 'preparing' | 'rendering' | 'finalizing') => void;
  /** Smaller sizes are useful for automated tests; the UI always uses 1920×1080. */
  settings?: FilmSettings;
  width?: number;
  height?: number;
}

function aborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Экспорт отменён', 'AbortError');
}

function waitFor<T>(promise: Promise<T>, signal: AbortSignal, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Экспорт отменён', 'AbortError'));
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); };
    const onAbort = () => { cleanup(); reject(new DOMException('Экспорт отменён', 'AbortError')); };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('Превышено время ожидания подготовки экспорта.')); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Renders and encodes in this browser, one explicitly timestamped frame at a time. */
export async function exportLocally({ signal, onProgress, settings, width = WIDTH, height = HEIGHT }: ExportOptions): Promise<Blob> {
  aborted(signal);
  onProgress(0, 0, 'preparing');
  if (!window.isSecureContext || typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('Нужен HTTPS и браузер с WebCodecs. Попробуйте актуальный Chrome или Edge.');
  }
  if (!await canEncodeVideo('avc', { width, height, frameRate: EXPORT_FPS, quality: QUALITY_HIGH, latencyMode: 'quality' })) {
    throw new Error('Браузер не поддерживает кодирование H.264 в MP4. Попробуйте актуальный Chrome или Edge.');
  }
  aborted(signal);
  const frame = document.createElement('iframe');
  frame.title = 'Рендер ролика';
  if (settings) frame.name = JSON.stringify(settings);
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', left: '-30000px', top: '0', width: `${width}px`, height: `${height}px`, border: '0', pointerEvents: 'none' });
  const url = new URL(window.location.href);
  url.search = '?export=1&pr=1';
  url.hash = '';
  frame.src = url.href;
  const loaded = new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve();
    frame.onerror = () => reject(new Error('Не удалось загрузить сцену для экспорта.'));
  });
  document.body.appendChild(frame);
  let output: Output | undefined;
  let complete = false;
  try {
    await waitFor(loaded, signal, 60000);
    const api = frame.contentWindow?.cinematicExport;
    // React mounts asynchronously after iframe load.
    const getApi = async (): Promise<ExportApi> => {
      if (api) return api;
      for (let i = 0; i < 300; i++) {
        aborted(signal);
        const value = frame.contentWindow?.cinematicExport;
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Сцена экспорта не запустилась.');
    };
    const scene = await waitFor(getApi(), signal, 35000);
    await waitFor(scene.ready, signal, 90000);
    const total = Math.ceil(scene.duration * EXPORT_FPS);
    if (!Number.isFinite(scene.duration) || total <= 0) throw new Error('Некорректная длительность ролика.');
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Не удалось создать холст экспорта.');
    const target = new BufferTarget();
    output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
    let packets = 0;
    const source = new CanvasSource(canvas, { codec: 'avc', quality: QUALITY_HIGH, latencyMode: 'quality', onEncodedPacket: () => { packets++; } });
    output.addVideoTrack(source, { frameRate: EXPORT_FPS });
    await output.start();
    for (let n = 0; n < total; n++) {
      aborted(signal);
      await waitFor(scene.renderFrame(n, EXPORT_FPS), signal, 45000);
      scene.drawFrame(ctx);
      await waitFor(source.add(n / EXPORT_FPS, 1 / EXPORT_FPS), signal, 45000);
      onProgress(n + 1, total, 'rendering');
    }
    aborted(signal);
    onProgress(total, total, 'finalizing');
    await waitFor(output.finalize(), signal, 120000);
    if (packets !== total) throw new Error(`Кодировщик записал ${packets} кадров из ${total}.`);
    if (!target.buffer?.byteLength) throw new Error('Кодировщик вернул пустой файл.');
    complete = true;
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    if (output && !complete) await output.cancel().catch(() => {});
    frame.remove();
  }
}

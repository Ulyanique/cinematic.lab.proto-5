import { useCallback, useEffect, useRef, useState } from 'react';
import { ExportViewer } from './ExportViewer';
import { exportLocally } from './intro/localExport';
import type { FilmSettings } from './intro/settings';

type State = 'idle' | 'preparing' | 'rendering' | 'finalizing' | 'done' | 'cancelled' | 'error';

export function ExportPanel({ onStart, settings }: { onStart: () => void; settings: FilmSettings }) {
  const [state, setState] = useState<State>('idle');
  const [progress, setProgress] = useState({ frame: 0, total: 0 });
  const [error, setError] = useState('');
  const [download, setDownload] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const closeViewer = useCallback(() => setViewerOpen(false), []);
  const controller = useRef<AbortController | null>(null);
  const urlRef = useRef('');
  const busy = state === 'preparing' || state === 'rendering' || state === 'finalizing';
  useEffect(() => () => {
    controller.current?.abort();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const start = async () => {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = '';
    setDownload(''); setViewerOpen(false); setError(''); setProgress({ frame: 0, total: 0 }); setState('preparing');
    onStart();
    try {
      const file = await exportLocally({ signal: abort.signal, settings, onProgress: (frame, total, phase) => { setProgress({ frame, total }); setState(phase); } });
      if (abort.signal.aborted) { setState('cancelled'); return; }
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      setDownload(url);
      setState('done');
      setViewerOpen(true);
    } catch (err) {
      if (abort.signal.aborted) setState('cancelled');
      else { setError(err instanceof Error ? err.message : 'Не удалось создать MP4.'); setState('error'); }
    } finally { controller.current = null; }
  };
  const percent = progress.total ? Math.round(progress.frame / progress.total * 100) : 0;
  return (
    <section className="export-panel" aria-label="Экспорт видео">
      <div className="export-actions">
        {busy && <button type="button" className="export-button" onClick={() => controller.current?.abort()}>ОТМЕНИТЬ</button>}
        {download && <button type="button" className="export-button" onClick={() => setViewerOpen(true)}>ОТКРЫТЬ ВИДЕО</button>}
        {download && <a className="export-download" href={download} download="circinus.mp4">СКАЧАТЬ MP4 ↓</a>}
        <button type="button" className="export-button" onClick={start} disabled={busy}>
          {busy ? 'ЭКСПОРТ...' : download ? 'СОЗДАТЬ ЗАНОВО' : 'ЭКСПОРТ MP4'}
        </button>
      </div>
      <div aria-live="polite" className="export-status">
        {busy && <>
          <div>{state === 'preparing' ? 'Подготовка…' : state === 'finalizing' ? 'Сборка MP4…' : `Кадр ${progress.frame} / ${progress.total} · ${percent}%`}</div>
          <div className="export-progress" role="progressbar" aria-label="Прогресс экспорта" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.frame}>
            <span style={{ width: `${percent}%` }} />
          </div>
          <small>На вашем устройстве · 1080p · 30 кадров/с<br />Не закрывайте вкладку до завершения.</small>
        </>}
        {state === 'cancelled' && <small>Экспорт отменён</small>}
        {state === 'done' && <small>Готово · 1920 × 1080 · 30 кадров/с</small>}
        {state === 'error' && <div className="export-error">{error}</div>}
      </div>
      {viewerOpen && download && <ExportViewer url={download} onClose={closeViewer} />}
    </section>
  );
}

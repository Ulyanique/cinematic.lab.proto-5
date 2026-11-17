import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** Opens the completed file above the whole browser viewport, outside the film frame. */
export function ExportViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onClose]);
  const close = () => {
    if (document.fullscreenElement === root.current) void document.exitFullscreen().catch(() => {});
    onClose();
  };
  return createPortal(<div ref={root} className="export-viewer" role="dialog" aria-modal="true" aria-label="Готовое видео">
    <div className="export-viewer-bar">
      <div className="export-viewer-label"><strong>ГОТОВО</strong><span>MP4 · 1920 × 1080 · 30 fps</span></div>
      <div className="export-viewer-actions">
        <button type="button" onClick={() => { if (root.current?.requestFullscreen) void root.current.requestFullscreen().catch(() => {}); }} aria-label="На весь экран" title="На весь экран">⛶</button>
        <a href={url} download="circinus.mp4" className="export-viewer-download">СОХРАНИТЬ MP4 ↓</a>
        <button type="button" ref={closeButton} onClick={close} aria-label="Закрыть видео" title="Закрыть видео">×</button>
      </div>
    </div>
    <video src={url} controls autoPlay playsInline className="export-viewer-video" aria-label="Просмотр готового видео" />
    <div className="export-viewer-hint">Сохраните файл кнопкой выше или через меню видео</div>
  </div>, document.body);
}

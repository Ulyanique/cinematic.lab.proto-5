import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { DEFAULT_SETTINGS, type FilmSettings } from './intro/settings';
import { VIDEO_STYLES, type VideoStyle } from './intro/videoStyles';

type Props = { settings: FilmSettings; onChange: (settings: FilmSettings) => void };
const sources = ['Бэйджи', 'Соболь и Анисимов', 'Шульган', 'Тихонова', 'Общий план зала', 'Зикеев', 'Боровская', 'Юшкевичус', 'Фотозона', 'Все победители'];
export function SettingsPanel({ settings: s, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 12, y: 12 });
  const dockRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const clampPosition = (x: number, y: number) => {
    const dock = dockRef.current;
    const width = dock?.offsetWidth || 34, height = dock?.offsetHeight || 34;
    return { x: Math.max(0, Math.min(x, window.innerWidth - width)), y: Math.max(0, Math.min(y, window.innerHeight - height)) };
  };
  useLayoutEffect(() => {
    const fit = () => setPosition(p => {
      const next = clampPosition(p.x, p.y);
      return next.x === p.x && next.y === p.y ? p : next;
    });
    fit();
    window.addEventListener('resize', fit);
    const observer = new ResizeObserver(fit);
    if (dockRef.current) observer.observe(dockRef.current);
    return () => { window.removeEventListener('resize', fit); observer.disconnect(); };
  }, [open]);
  const beginDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, left: position.x, top: position.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const moveDrag = (e: PointerEvent<HTMLButtonElement>) => {
    const start = dragRef.current;
    if (start) setPosition(clampPosition(start.left + e.clientX - start.x, start.top + e.clientY - start.y));
  };
  const moveKeyboard = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 32 : 8;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (delta[e.key]) { e.preventDefault(); e.stopPropagation(); const [x, y] = delta[e.key]; setPosition(p => clampPosition(p.x + x, p.y + y)); }
  };
  const set = <K extends keyof FilmSettings>(key: K, value: FilmSettings[K]) => onChange({ ...s, [key]: value });
  const slider = (key: keyof FilmSettings, label: string, min: number, max: number, step: number, unit = '') => <label className="setting-range" key={key}>
    <span>{label}<output>{Number(s[key]).toFixed(step < .1 ? 2 : step < 1 ? 1 : 0)}{unit}</output></span>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={Number(s[key])} onChange={e => set(key, Number(e.target.value) as never)} />
  </label>;
  const toggle = (key: 'showTitle' | 'showSubtitle' | 'showLogo' | 'ringsEnabled' | 'antialias', label: string) => <label className="setting-toggle"><span>{label}</span><input type="checkbox" checked={s[key]} onChange={e => set(key, e.target.checked)} /></label>;
  const color = (key: 'titleLight' | 'titleMid' | 'titleGold' | 'titleDark' | 'subtitleColor' | 'ringColor', label: string) => <label className="setting-color"><span>{label}</span><input type="color" value={s[key]} onChange={e => set(key, e.target.value)} /></label>;
  return <div ref={dockRef} className="settings-dock" style={{ left: position.x, top: position.y }}>
    <button type="button" className="settings-trigger" title="Настройки композиции" aria-label="Настройки композиции" aria-expanded={open} aria-controls="film-settings" onClick={() => setOpen(!open)}>
      {open ? <span aria-hidden="true">×</span> : <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.2" fill="#17120d"/><circle cx="15" cy="17" r="2.2" fill="#17120d"/></svg>}
    </button>
    {open && <section id="film-settings" className="settings-panel" aria-label="Настройки композиции">
      <header>
        <button type="button" className="settings-handle" title="Перетащите панель" aria-label="Переместить панель настроек стрелками или перетаскиванием" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }} onLostPointerCapture={() => { dragRef.current = null; }} onKeyDown={moveKeyboard}><span aria-hidden="true">⠿</span> Настройки</button>
        <button type="button" className="settings-reset" onClick={() => onChange({ ...DEFAULT_SETTINGS, videoOrder: [...DEFAULT_SETTINGS.videoOrder] })}>Сбросить</button>
      </header>
      <div className="settings-scroll">
        <details><summary>Финальная композиция</summary><div className="setting-group">
          <label className="setting-text">Название<input aria-label="Название" maxLength={30} value={s.title} onChange={e => set('title', e.target.value)} /></label>
          <label className="setting-text">Подпись<input aria-label="Подпись" maxLength={45} value={s.subtitle} onChange={e => set('subtitle', e.target.value)} /></label>
          <label className="setting-text">Шрифт названия<select aria-label="Шрифт названия" value={s.titleFont} onChange={e => set('titleFont', e.target.value as FilmSettings['titleFont'])}><option>Prata</option><option>Forum</option><option>Inter</option></select></label>
          <label className="setting-text">Шрифт подписи<select aria-label="Шрифт подписи" value={s.subtitleFont} onChange={e => set('subtitleFont', e.target.value as FilmSettings['subtitleFont'])}><option>Forum</option><option>Prata</option><option>Inter</option></select></label>
          {toggle('showTitle', 'Показывать название')}{toggle('showSubtitle', 'Показывать подпись')}{toggle('showLogo', 'Показывать логотип')}
          {slider('titleScale', 'Размер названия', .55, 1.5, .05)}{slider('titleSpacing', 'Интервал букв', 0, .2, .01, ' em')}{slider('titlePosition', 'Положение текста по вертикали', 38, 68, 1, '%')}{slider('subtitleScale', 'Размер подписи', .6, 1.5, .05)}{slider('subtitleSpacing', 'Интервал подписи', 0, .6, .02, ' em')}{slider('logoScale', 'Размер логотипа', .5, 1.5, .05)}{slider('logoOpacity', 'Яркость логотипа', 0, 1, .05)}
          <div className="setting-colors">{color('titleLight','Свет текста')}{color('titleMid','Блик текста')}{color('titleGold','Золото текста')}{color('titleDark','Тень текста')}{color('subtitleColor','Подпись')}</div>
          {slider('revealSpeed', 'Скорость появления названия', .5, 2, .1, '×')}{slider('exitMotion', 'Движение при уходе', 0, 2, .1, '×')}
        </div></details>
        <details><summary>Круги в углах</summary><div className="setting-group">{toggle('ringsEnabled','Показывать круги')}{color('ringColor','Цвет кругов')}{slider('ringSize','Размер', .5, 1.5, .05, '×')}{slider('ringOpacity','Яркость',0,1.5,.05,'×')}{slider('ringSpeed','Скорость вращения',0,2,.1,'×')}</div></details>
        <details><summary>Свет и эффекты</summary><div className="setting-group">{toggle('antialias','Сглаживание краёв (FXAA)')}{slider('exposure','Экспозиция',.35,2,.05,'×')}{slider('bloom','Свечение',0,2,.1,'×')}{slider('dust','Частицы',0,2,.1,'×')}{slider('beams','Лучи экранов',0,2,.1,'×')}{slider('blast','Взрыв и искры',0,2,.1,'×')}{slider('sigil','Узор на земле',0,2,.1,'×')}{slider('sky','Яркость неба',0,2,.1,'×')}{slider('rays','Лучистый свет',0,2,.1,'×')}{slider('grain','Зерно',0,2,.1,'×')}{slider('vignette','Виньетка',0,2,.1,'×')}{slider('hue','Оттенок сцены',-180,180,5,'°')}{slider('saturation','Насыщенность сцены',0,2,.1,'×')}</div></details>
        <details><summary>Камера</summary><div className="setting-group">{slider('cameraFov','Ширина угла',.75,1.3,.05,'×')}{slider('cameraDrift','Плавное движение',0,2,.1,'×')}<p className="setting-note">Движение по сценарию, без управления мышью.</p></div></details>
        <details><summary>Видео · 10 экранов</summary><div className="setting-group">
          <label className="setting-text">Стиль видео<select aria-label="Стиль видео" value={s.videoStyle} onChange={e => set('videoStyle', e.target.value as VideoStyle)}>{VIDEO_STYLES.map(style => <option key={style.id} value={style.id}>{style.label}</option>)}</select></label>
          {slider('videoStyleStrength','Сила стиля',0,1,.05)}{slider('videoBrightness','Яркость видео',0,2,.1,'×')}<p className="setting-note">Выберите ролик для каждого экрана. При выборе два ролика поменяются местами.</p>{s.videoOrder.map((source, i) => <label className="video-setting" key={i}><span>{String(i+1).padStart(2,'0')}</span><select aria-label={`Видео на экране ${i+1}`} value={source} onChange={e => { const order = [...s.videoOrder]; const next = Number(e.target.value); const other = order.indexOf(next); [order[i], order[other]] = [order[other], order[i]]; set('videoOrder', order); }}>{sources.map((name, j) => <option value={j} key={name}>{String(j+1).padStart(2,'0')} · {name}</option>)}</select></label>)}</div></details>
      </div>
      <footer>Сохраняется в браузере</footer>
    </section>}
  </div>;
}

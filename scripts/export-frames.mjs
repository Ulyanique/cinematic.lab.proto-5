import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, readdir, access } from 'node:fs/promises';
import path from 'node:path';

// All frame numbers are zero-based; the end bound is exclusive.
const args = process.argv.slice(2);
const options = { fps: '30', width: '1920', height: '1080', start: '0', out: 'exports/frames', pr: '1' };
for (let i = 0; i < args.length; i++) {
  const key = args[i].replace(/^--/, '');
  if (!args[i].startsWith('--') || !['fps', 'width', 'height', 'start', 'end', 'out', 'pr', 'browser'].includes(key) || !args[i + 1]) {
    throw new Error(`Неизвестный или неполный аргумент: ${args[i]}`);
  }
  options[key] = args[++i];
}
const fps = Number(options.fps), width = Number(options.width), height = Number(options.height);
const start = Number(options.start), pr = Number(options.pr);
if (!Number.isInteger(fps) || fps < 1 || fps > 60 || !Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width * 9 !== height * 16 || !Number.isInteger(start) || start < 0 || !Number.isFinite(pr) || pr < 1 || pr > 2) {
  throw new Error('Ожидаются FPS 1–60, размер 16:9, неотрицательный start и pr от 1 до 2.');
}
for (let i = 1; i <= 10; i++) {
  const file = `public/video/${String(i).padStart(2, '0')}.mp4`;
  try { await access(file); } catch { throw new Error(`Нет исходника ${file}. См. README.`); }
}
const out = path.resolve(options.out);
await mkdir(out, { recursive: true });
if ((await readdir(out)).some(name => /^frame-\d+\.png$/.test(name))) throw new Error(`В ${out} уже есть кадры. Выберите пустую папку.`);
const server = await createServer({ configFile: 'vite.config.ts', server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ headless: true, ...(options.browser ? { executablePath: options.browser } : {}) });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', error => console.error('Ошибка страницы:', error.message));
  await page.goto(`http://127.0.0.1:${port}/?export=1&pr=${pr}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.cinematicExport, { timeout: 30000 });
  await page.evaluate(() => window.cinematicExport.ready);
  const duration = await page.evaluate(() => window.cinematicExport.duration);
  const total = Math.ceil(duration * fps);
  const end = options.end === undefined ? total : Number(options.end);
  if (!Number.isInteger(end) || end > total || end <= start) throw new Error(`end должен быть целым в диапазоне ${start + 1}–${total}`);
  console.log(`Рендер кадров ${start}–${end - 1} из ${total}, ${width}×${height}, ${fps} fps → ${out}`);
  for (let frame = start; frame < end; frame++) {
    await page.evaluate(({ frame, fps }) => window.cinematicExport.renderFrame(frame, fps), { frame, fps });
    await page.screenshot({ path: path.join(out, `frame-${String(frame).padStart(6, '0')}.png`), animations: 'disabled' });
    if ((frame - start) % 24 === 0 || frame === end - 1) console.log(`${frame + 1 - start}/${end - start}`);
  }
} finally {
  await browser?.close();
  await server.close();
}

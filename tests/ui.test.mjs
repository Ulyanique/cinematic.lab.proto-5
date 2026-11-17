import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const fixture = `<html><body><script>
window.cinematicExport={ready:Promise.resolve(),duration:.1,
renderFrame:async(n)=>{window.n=n},drawFrame(ctx){ctx.fillStyle=['red','green','blue'][window.n];ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height)}};
</script></body></html>`;

test('compact settings can be moved and the completed export opens, saves, closes and reopens', {timeout: 90000}, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'ui-harness', configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (req.url === '/ui-harness') { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/ui-harness', '<html><head></head><body><div id="root"></div><script type="module" src="/tests/ui-harness.tsx"></script></body></html>')); }
      else next();
    }); },
  }] });
  let browser;
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    browser = await chromium.launch({ headless: true, ...(process.env.CINEMATIC_BROWSER_PATH ? { executablePath: process.env.CINEMATIC_BROWSER_PATH } : {}) });
    const page = await browser.newPage({ viewport: {width: 960, height: 720}, acceptDownloads: true });
    await page.goto(`http://127.0.0.1:${port}/ui-harness`);
    await page.getByRole('button', { name: 'Настройки композиции' }).click();
    const panel = page.locator('.settings-panel');
    const initial = await panel.boundingBox();
    assert.ok(initial.width <= 250 && initial.height < 300);
    const handle = page.getByRole('button', { name: /Переместить панель/ });
    const h = await handle.boundingBox();
    await page.mouse.move(h.x + 12, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 170, h.y + 100, { steps: 5 });
    await page.mouse.up();
    const moved = await panel.boundingBox();
    assert.ok(moved.x > initial.x + 100 && moved.y > initial.y + 60);
    await handle.focus(); await page.keyboard.press('ArrowRight');
    const keyboardMoved = await panel.boundingBox();
    assert.equal(keyboardMoved.x, moved.x + 8);
    await page.getByText('Финальная композиция').click();
    await page.getByRole('textbox', { name: 'Название' }).fill('НОВЫЙ ТЕКСТ');
    assert.equal(await page.getByRole('textbox', { name: 'Название' }).inputValue(), 'НОВЫЙ ТЕКСТ');
    await page.getByRole('button', { name: 'Настройки композиции' }).click();

    await page.route('**/ui-harness?export=1&pr=1', route => route.fulfill({status: 200, contentType: 'text/html', body: fixture}));
    await page.getByRole('button', { name: 'ЭКСПОРТ MP4' }).click();
    const viewer = page.getByRole('dialog', { name: 'Готовое видео' });
    await viewer.waitFor({timeout: 60000});
    const bounds = await viewer.boundingBox();
    assert.deepEqual(bounds, { x: 0, y: 0, width: 960, height: 720 });
    assert.equal(await viewer.locator('video').getAttribute('controls'), '');
    const downloadPromise = page.waitForEvent('download');
    await viewer.getByRole('link', { name: /СОХРАНИТЬ MP4/ }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'circinus.mp4');
    assert.equal(await download.failure(), null);
    await viewer.getByRole('button', { name: 'Закрыть видео' }).click();
    assert.equal(await viewer.count(), 0);
    await page.getByRole('button', { name: 'ОТКРЫТЬ ВИДЕО' }).click();
    await viewer.waitFor();
    await viewer.getByRole('button', { name: 'На весь экран' }).click();
    await page.waitForFunction(() => document.fullscreenElement !== null);
    assert.equal(await page.evaluate(() => document.fullscreenElement?.classList.contains('export-viewer')), true);
    await viewer.getByRole('button', { name: 'Закрыть видео' }).click();
    assert.equal(await viewer.count(), 0);
    await page.getByRole('button', { name: 'ОТКРЫТЬ ВИДЕО' }).click();
    await viewer.waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await viewer.count(), 0);
    assert.equal(await page.getByRole('link', { name: /СКАЧАТЬ MP4/ }).count(), 1);
  } finally {
    await browser?.close();
    await server.close();
  }
});

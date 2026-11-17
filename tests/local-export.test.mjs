import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { Input, BufferSource, ALL_FORMATS, EncodedPacketSink } from 'mediabunny';

const fixture = `<html><body><script>
window.parent.__snapshot = window.name;
window.cinematicExport={ready:Promise.resolve(),duration:.1,
  renderFrame:async(n,fps)=>{window.parent.__frames.push([n,fps]);window.n=n;},
  drawFrame(ctx){ctx.fillStyle=['red','green','blue'][window.n];ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height)}
};</script></body></html>`;

test('local export encodes every frame at 30 fps without a server render job', { timeout: 90000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'test-harness', configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/test-harness')) { res.setHeader('Content-Type', 'text/html'); res.end('<html><body></body></html>'); }
      else next();
    }); },
  }] });
  let browser;
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    browser = await chromium.launch({ headless: true, ...(process.env.CINEMATIC_BROWSER_PATH ? { executablePath: process.env.CINEMATIC_BROWSER_PATH } : {}) });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/test-harness`);
    // The final hold is an extension, not a slowdown of the earlier fade. The same
    // deterministic canvas is composited into the exported movie and shown live.
    const rings = await page.evaluate(async () => {
      const { drawCornerRings } = await import('/src/intro/cornerRings.ts');
      const { TL } = await import('/src/intro/timeline.ts');
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
      const ctx = canvas.getContext('2d');
      const sample = (time) => {
        drawCornerRings(ctx, time, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let upperLeft = 0, lowerRight = 0, centre = 0;
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          if (!image[(y * canvas.width + x) * 4 + 3]) continue;
          if (x < 180 && y < 180) upperLeft++;
          if (x > 780 && y > 360) lowerRight++;
          if (x > 300 && x < 660 && y > 180 && y < 360) centre++;
        }
        return { upperLeft, lowerRight, centre, image: canvas.toDataURL() };
      };
      return { end: TL.end, finalSettle: TL.finalSettle, early: sample(20), first: sample(50), second: sample(50) };
    });
    assert.equal(rings.end, 51.5);
    assert.equal(rings.finalSettle, 43.5);
    assert.equal(rings.early.upperLeft + rings.early.lowerRight, 0);
    assert.ok(rings.first.upperLeft > 100 && rings.first.lowerRight > 100);
    assert.equal(rings.first.centre, 0);
    assert.equal(rings.first.image, rings.second.image);
    const settingsCheck = await page.evaluate(async () => {
      const { normalizeSettings, DEFAULT_SETTINGS } = await import('/src/intro/settings.ts');
      return { defaults: normalizeSettings(null), invalid: normalizeSettings({ title: 'НАЗВАНИЕ', exposure: 99, bloom: NaN, titleFont: 'bad', ringColor: 'red', videoOrder: [0,0] }), initial: DEFAULT_SETTINGS };
    });
    assert.deepEqual(settingsCheck.defaults, settingsCheck.initial);
    assert.equal(settingsCheck.invalid.title, 'НАЗВАНИЕ');
    assert.equal(settingsCheck.invalid.exposure, 2);
    assert.equal(settingsCheck.invalid.bloom, 1);
    assert.equal(settingsCheck.invalid.titleFont, 'Prata');
    assert.equal(settingsCheck.invalid.ringColor, '#edc67c');
    assert.deepEqual(settingsCheck.invalid.videoOrder, [0,1,2,3,4,5,6,7,8,9]);
    const exit = await page.evaluate(async () => {
      const { logoExit, glyphExit, subtitleExit } = await import('/src/intro/finalExit.ts');
      return { before: [logoExit(47), glyphExit(47, 0), subtitleExit(47)],
        middle: [logoExit(49), glyphExit(49, 0), glyphExit(49, 15), subtitleExit(49)],
        after: [logoExit(51), glyphExit(51, 0), glyphExit(51, 15), subtitleExit(51)] };
    });
    assert.deepEqual(exit.before, [0, 0, 0]);
    assert.ok(exit.middle[0] > 0 && exit.middle[0] < 1);
    assert.ok(exit.middle[1] > exit.middle[2] && exit.middle[2] > 0);
    assert.ok(exit.middle[3] > 0 && exit.middle[3] < 1);
    assert.deepEqual(exit.after, [1, 1, 1, 1]);
    // The compositor must apply the final fade after every film layer, including rings.
    const fadedPixels = await page.evaluate(async () => {
      const { captureOverlay } = await import('/src/intro/captureOverlay.ts');
      const { TL } = await import('/src/intro/timeline.ts');
      const { smoothstep } = await import('/src/intro/math.ts');
      const root = document.createElement('div');
      root.style.cssText = 'position:absolute;left:0;top:0;width:320px;height:180px';
      const rings = document.createElement('canvas'); rings.className = 'corner-rings'; rings.width = 320; rings.height = 180;
      const rctx = rings.getContext('2d'); rctx.fillStyle = 'white'; rctx.fillRect(0, 0, 320, 180);
      const fade = document.createElement('div'); fade.className = 'film-fade';
      root.append(rings, fade); document.body.append(root);
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const ctx = canvas.getContext('2d');
      const sample = time => {
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 320, 180);
        fade.style.opacity = smoothstep(TL.fadeOutStart, TL.fadeOutEnd, time);
        captureOverlay(ctx, root);
        return [...ctx.getImageData(160, 90, 1, 1).data];
      };
      const samples = [sample(TL.fadeOutStart), sample((TL.fadeOutStart + TL.fadeOutEnd) / 2), sample(51), sample(TL.end - 1 / 30)];
      root.remove(); return samples;
    });
    assert.deepEqual(fadedPixels[0], [255, 255, 255, 255]);
    assert.ok(fadedPixels[1][0] >= 126 && fadedPixels[1][0] <= 128);
    assert.deepEqual(fadedPixels[2], [0, 0, 0, 255]);
    assert.deepEqual(fadedPixels[3], [0, 0, 0, 255]);
    let serverJobs = 0;
    page.on('request', request => { if (request.url().includes('/api/cinematic-export')) serverJobs++; });
    await page.route('**/test-harness?export=1&pr=1', route => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
    const result = await page.evaluate(async () => {
      window.__frames = [];
      const { exportLocally } = await import('/src/intro/localExport.ts');
      const progress = [];
      const { DEFAULT_SETTINGS } = await import('/src/intro/settings.ts');
      const settings = { ...DEFAULT_SETTINGS, antialias: false, title: 'ТЕСТ', videoOrder: [2,1,0,3,4,5,6,7,8,9] };
      const blob = await exportLocally({ signal: new AbortController().signal, settings, width: 320, height: 180, onProgress: (n, total, phase) => progress.push([n, total, phase]) });
      return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), frames: window.__frames, snapshot: JSON.parse(window.__snapshot), progress, iframes: document.querySelectorAll('iframe').length };
    });
    assert.deepEqual(result.frames, [[0, 30], [1, 30], [2, 30]]);
    assert.equal(result.iframes, 0);
    assert.equal(result.snapshot.title, 'ТЕСТ');
    assert.equal(result.snapshot.antialias, false);
    assert.deepEqual(result.snapshot.videoOrder, [2,1,0,3,4,5,6,7,8,9]);
    assert.equal(serverJobs, 0);
    assert.deepEqual(result.progress.at(-1), [3, 3, 'finalizing']);
    const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(Uint8Array.from(result.bytes)) });
    const track = await input.getPrimaryVideoTrack();
    assert.ok(track);
    assert.equal(await track.getDisplayWidth(), 320);
    assert.equal(await track.getDisplayHeight(), 180);
    assert.ok(Math.abs(await track.computeDuration() - .1) < .001);
    const packets = [];
    for await (const packet of new EncodedPacketSink(track).packets()) packets.push(packet.timestamp);
    assert.equal(packets.length, 3);
    packets.sort((a, b) => a - b);
    assert.ok(packets.every((t, i) => Math.abs(t - i / 30) < .0001));
    input.dispose();

    // Cancelling a stalled frame releases the temporary iframe and returns no file.
    await page.unrouteAll();
    await page.route('**/test-harness?export=1&pr=1', route => route.fulfill({ status: 200, contentType: 'text/html', body: `<script>window.cinematicExport={ready:Promise.resolve(),duration:.1,renderFrame:()=>new Promise(()=>{}),drawFrame(){}}</script>` }));
    const cancelled = await page.evaluate(async () => {
      const { exportLocally } = await import('/src/intro/localExport.ts');
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 500);
      try { await exportLocally({ signal: controller.signal, width: 320, height: 180, onProgress() {} }); return 'unexpected success'; }
      catch (error) { return `${error.name}:${document.querySelectorAll('iframe').length}`; }
    });
    assert.equal(cancelled, 'AbortError:0');
  } finally {
    await browser?.close();
    await server.close();
  }
});

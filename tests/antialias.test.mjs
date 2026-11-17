import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

test('FXAA smooths diagonal edges at the actual render resolution and survives resize', { timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'aa-harness', configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (req.url === '/aa-harness') { res.setHeader('Content-Type', 'text/html'); res.end('<html><body></body></html>'); }
      else next();
    }); },
  }] });
  let browser;
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    browser = await chromium.launch({ headless: true, ...(process.env.CINEMATIC_BROWSER_PATH ? { executablePath: process.env.CINEMATIC_BROWSER_PATH } : {}) });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/aa-harness`);
    const result = await page.evaluate(async () => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { EffectComposer } = await import('/node_modules/three/examples/jsm/postprocessing/EffectComposer.js');
      const { RenderPass } = await import('/node_modules/three/examples/jsm/postprocessing/RenderPass.js');
      const { OutputPass } = await import('/node_modules/three/examples/jsm/postprocessing/OutputPass.js');
      const { createAntialiasPass, resizeAntialias } = await import('/src/intro/antialias.ts');
      const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
      renderer.setSize(128, 128);
      const scene = new THREE.Scene(); scene.background = new THREE.Color('black');
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10); camera.position.z = 2;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0, 1,-1,0, -.7,1,0], 3));
      scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })));
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera)); composer.addPass(new OutputPass());
      const aa = createAntialiasPass(); resizeAntialias(aa, 128, 128, 1); composer.addPass(aa);
      const sample = enabled => {
        aa.enabled = enabled; composer.render();
        const gl = renderer.getContext(), data = new Uint8Array(128 * 128 * 4);
        gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, data);
        let partial = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 5 && data[i] < 250) partial++;
        return { partial, data: Array.from(data) };
      };
      const off = sample(false), on = sample(true), repeat = sample(true);
      resizeAntialias(aa, 120, 60, 1.5);
      const resolution = aa.uniforms.resolution.value.toArray();
      aa.dispose(); composer.dispose(); geometry.dispose(); renderer.dispose();
      return { offPartial: off.partial, onPartial: on.partial, same: on.data.every((v,i) => v === repeat.data[i]), changed: on.data.some((v,i) => v !== off.data[i]), resolution };
    });
    assert.ok(result.onPartial > result.offPartial, `Expected more smoothed pixels: ${JSON.stringify(result)}`);
    assert.equal(result.changed, true);
    assert.equal(result.same, true);
    assert.ok(Math.abs(result.resolution[0] - 1/180) < 1e-10);
    assert.ok(Math.abs(result.resolution[1] - 1/90) < 1e-10);
  } finally { await browser?.close(); await server.close(); }
});

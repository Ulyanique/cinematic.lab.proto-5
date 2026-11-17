import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

test('video styles affect only footage colour, preserve original and animate deterministically', { timeout: 60000 }, async () => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'video-styles-harness', configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (req.url === '/video-styles-harness') { res.setHeader('Content-Type', 'text/html'); res.end('<html><body></body></html>'); }
      else next();
    }); },
  }] });
  let browser;
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    browser = await chromium.launch({ headless: true, ...(process.env.CINEMATIC_BROWSER_PATH ? { executablePath: process.env.CINEMATIC_BROWSER_PATH } : {}) });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/video-styles-harness`);
    const r = await page.evaluate(async () => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { VIDEO_STYLE_GLSL, VIDEO_STYLES, videoStyleCode } = await import('/src/intro/videoStyles.ts');
      const { normalizeSettings } = await import('/src/intro/settings.ts');
      const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
      renderer.setSize(32, 32);
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10); camera.position.z = 2;
      const material = new THREE.ShaderMaterial({ uniforms: { uStyle: { value: 0 }, uStrength: { value: 1 }, uTime: { value: 10.001 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: `precision highp float; varying vec2 vUv; uniform float uStyle, uStrength, uTime; ${VIDEO_STYLE_GLSL} void main(){ gl_FragColor=vec4(gradeVideo(vec3(.25,.55,.8),vUv,uTime,uStyle,uStrength),1.); }`,
      });
      const geometry = new THREE.PlaneGeometry(2, 2); scene.add(new THREE.Mesh(geometry, material));
      const sample = (style, strength = 1, time = 10.001) => {
        material.uniforms.uStyle.value = style; material.uniforms.uStrength.value = strength; material.uniforms.uTime.value = time;
        renderer.render(scene, camera); const gl = renderer.getContext(); const data = new Uint8Array(32 * 32 * 4);
        gl.readPixels(0, 0, 32, 32, gl.RGBA, gl.UNSIGNED_BYTE, data); return Array.from(data);
      };
      const original = sample(0), styles = VIDEO_STYLES.map(style => sample(style.code));
      const emptyStrength = sample(5, 0), archiveSameFrame = sample(5, 1, 10.02), archiveNextFrame = sample(5, 1, 10.04);
      const result = { ids: VIDEO_STYLES.map(s => [s.id, videoStyleCode(s.id)]), original, styles, emptyStrength, archiveSameFrame, archiveNextFrame,
        legacy: normalizeSettings({}), valid: normalizeSettings({ videoStyle: 'sepia', videoStyleStrength: .4 }), invalid: normalizeSettings({ videoStyle: 'bad', videoStyleStrength: 42 }) };
      geometry.dispose(); material.dispose(); renderer.dispose(); return result;
    });
    assert.deepEqual(r.ids.map(([id]) => id), ['original', 'warm', 'mono', 'sepia', 'cinema', 'archive']);
    assert.deepEqual(r.emptyStrength, r.original);
    for (const pixels of r.styles.slice(1)) assert.notDeepEqual(pixels, r.original);
    const mono = r.styles[2]; assert.equal(mono[0], mono[1]); assert.equal(mono[1], mono[2]);
    assert.deepEqual(r.styles[5], r.archiveSameFrame);
    assert.notDeepEqual(r.styles[5], r.archiveNextFrame);
    assert.equal(r.legacy.videoStyle, 'original');
    assert.equal(r.valid.videoStyle, 'sepia'); assert.equal(r.valid.videoStyleStrength, .4);
    assert.equal(r.invalid.videoStyle, 'original'); assert.equal(r.invalid.videoStyleStrength, 1);
  } finally { await browser?.close(); await server.close(); }
});

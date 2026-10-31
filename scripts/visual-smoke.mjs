import { chromium, webkit } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Actual rendered frames and GPU time, not checks for the presence of CSS animation names.
const useWebKit = process.argv.includes('--webkit');
if (process.argv.slice(2).some((arg) => arg !== '--webkit'))
  throw new Error('Usage: pnpm smoke:visual [--webkit]');
const origin = new URL(process.env.SMOKE_WEB_URL || 'http://127.0.0.1:5173');
if (
  !['http:', 'https:'].includes(origin.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash ||
  origin.pathname !== '/'
)
  throw new Error('SMOKE_WEB_URL must be a loopback origin');
const engine = useWebKit
  ? 'webkit'
  : process.env.SMOKE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chromium');
const directory = new URL(`../.runtime/visual-${randomUUID()}/`, import.meta.url);
await mkdir(directory, { recursive: true });
const report = {
  engine,
  startedAt: new Date().toISOString(),
  target: origin.origin,
  checks: [],
  errors: [],
  externalRequests: 0,
  status: 'running',
};
const assert = (condition, code) => {
  if (!condition) throw new Error(code);
};
let browser,
  stage = 'launch';
try {
  browser = useWebKit
    ? await webkit.launch({ headless: true })
    : await chromium.launch({ headless: true, ...(engine !== 'chromium' ? { channel: engine } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  await context.addInitScript(() => {
    window.__orbitReview = { samples: [], draws: 0 };
    const proto = globalThis.WebGL2RenderingContext?.prototype;
    if (!proto) return;
    const get = proto.getUniformLocation,
      set = proto.uniform1f,
      draw = proto.drawArrays;
    const names = new WeakMap();
    let next = 0;
    proto.getUniformLocation = function (program, name) {
      const location = get.call(this, program, name);
      if (location && name === 'time') names.set(location, next++);
      return location;
    };
    proto.uniform1f = function (location, value) {
      if (names.has(location)) {
        window.__orbitReview.samples.push({ id: names.get(location), value, at: performance.now() });
        if (window.__orbitReview.samples.length > 1500) window.__orbitReview.samples.splice(0, 500);
      }
      return set.call(this, location, value);
    };
    proto.drawArrays = function (...args) {
      window.__orbitReview.draws++;
      return draw.apply(this, args);
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => report.errors.push(error.name));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol !== 'data:' && url.origin !== origin.origin) report.externalRequests++;
  });
  async function check(name, work) {
    stage = name;
    const detail = await work();
    report.checks.push({ name, status: 'passed', ...detail });
    console.log(`PASS ${name}`);
  }
  // Decode browser PNGs using the browser itself; no private Playwright or image package API.
  async function difference(first, second) {
    return page.evaluate(
      async ({ first, second }) => {
        async function pixels(encoded) {
          const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          return {
            width: canvas.width,
            height: canvas.height,
            data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
          };
        }
        const a = await pixels(first),
          b = await pixels(second);
        let changedPixels = 0;
        if (a.width !== b.width || a.height !== b.height) throw new Error('frame_sizes_changed');
        for (let index = a.width * 4 * 20; index < a.data.length - a.width * 4 * 20; index += 4)
          if (
            Math.abs(a.data[index] - b.data[index]) +
              Math.abs(a.data[index + 1] - b.data[index + 1]) +
              Math.abs(a.data[index + 2] - b.data[index + 2]) >
            12
          )
            changedPixels++;
        return { changedPixels, ratio: changedPixels / (a.width * a.height) };
      },
      { first: first.toString('base64'), second: second.toString('base64') },
    );
  }
  await page.goto(new URL('/previews/planet-orbit.html', origin).href);
  await page.locator('body[data-renderer="webgl"]').waitFor({ timeout: 30000 });
  const canvas = page.locator('canvas');
  await check('actual_rendered_frames_move', async () => {
    const first = await canvas.screenshot();
    await page.waitForTimeout(600);
    const delta = await difference(first, await canvas.screenshot());
    assert(delta.changedPixels > 1500, 'scene_is_still');
    await page.screenshot({ path: fileURLToPath(new URL('desktop.png', directory)), fullPage: true });
    return delta;
  });
  await check('pause_stops_pixels_and_draw_calls', async () => {
    await page.locator('#motion-toggle').click();
    await page.waitForTimeout(150);
    const first = await canvas.screenshot(),
      draws = await page.evaluate(() => window.__orbitReview.draws);
    await page.waitForTimeout(450);
    const delta = await difference(first, await canvas.screenshot());
    assert(delta.ratio < 0.00025, 'paused_pixels_move');
    assert((await page.evaluate(() => window.__orbitReview.draws)) === draws, 'paused_drawing_continues');
    return { ...delta, newDraws: 0 };
  });
  await check('drag_keyboard_and_reset', async () => {
    const first = await canvas.screenshot(),
      bounds = await canvas.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 100, bounds.y + bounds.height / 2 + 35, { steps: 6 });
    await page.mouse.up();
    assert((await difference(first, await canvas.screenshot())).changedPixels > 1000, 'drag_did_not_move');
    await canvas.focus();
    await page.keyboard.press('ArrowLeft');
    await page.getByRole('button', { name: '重置视角', exact: true }).click();
    assert((await difference(first, await canvas.screenshot())).ratio < 0.00025, 'reset_did_not_restore');
  });
  await check('opposite_orbits_and_real_speed_change', async () => {
    await page.locator('#motion-toggle').click();
    async function sample() {
      await page.evaluate(() => {
        window.__orbitReview.samples = [];
      });
      await page.waitForTimeout(800);
      return page.evaluate(() =>
        [0, 1, 2].map((id) => {
          const samples = window.__orbitReview.samples.filter((_, index) => index % 3 === id);
          return {
            id,
            velocity:
              (samples.at(-1).value - samples[0].value) / ((samples.at(-1).at - samples[0].at) / 1000),
          };
        }),
      );
    }
    const normal = await sample();
    await page.locator('[data-speed="2"]').click();
    const fast = await sample(),
      ratio = fast[0].velocity / normal[0].velocity;
    assert(
      normal[0].velocity > 0 && normal[1].velocity < 0 && normal[2].velocity > 0,
      'wrong_orbit_direction',
    );
    assert(ratio > 1.5 && ratio < 2.5, 'speed_not_doubled');
    await page.locator('[data-speed="1"]').click();
    return { normal, fast, ratio };
  });
  await check('immersive_mode_and_escape', async () => {
    await page.locator('#focus-toggle').click();
    assert((await page.locator('body').getAttribute('data-immersive')) === 'true', 'not_immersive');
    await page.keyboard.press('Escape');
    assert((await page.locator('body').getAttribute('data-immersive')) === 'false', 'escape_failed');
  });
  await check('responsive_controls', async () => {
    for (const width of [320, 390, 768, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'horizontal_overflow',
      );
      await page.locator('#motion-toggle').scrollIntoViewIfNeeded();
      assert(await page.locator('#motion-toggle').isVisible(), 'motion_control_hidden');
    }
    return { widths: [320, 390, 768, 1920] };
  });
  await check('system_reduced_motion', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('#motion-toggle').disabled);
    const first = await canvas.screenshot(),
      draws = await page.evaluate(() => window.__orbitReview.draws);
    await page.waitForTimeout(250);
    assert(
      (await difference(first, await canvas.screenshot())).ratio < 0.00025,
      'reduced_motion_pixels_move',
    );
    assert((await page.evaluate(() => window.__orbitReview.draws)) === draws, 'reduced_motion_draws');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.body.dataset.motion === 'running');
  });
  await check('webgl_context_restoration', async () => {
    await page.evaluate(() => {
      window.__loseContext = document
        .querySelector('canvas')
        .getContext('webgl2')
        .getExtension('WEBGL_lose_context');
      if (!window.__loseContext) throw new Error('context_loss_extension_unavailable');
      window.__loseContext.loseContext();
    });
    await page.locator('#loading').waitFor({ state: 'visible' });
    await page.evaluate(() => window.__loseContext.restoreContext());
    await page.locator('#loading').waitFor({ state: 'hidden', timeout: 15000 });
    const first = await canvas.screenshot();
    await page.waitForTimeout(350);
    assert(
      (await difference(first, await canvas.screenshot())).changedPixels > 500,
      'restored_scene_is_still',
    );
  });
  await check('local_assets_and_no_script_errors', async () => {
    assert(report.externalRequests === 0, 'external_asset_request');
    assert(report.errors.length === 0, 'browser_script_error');
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.checks.push({
    name: stage,
    status: 'failed',
    reason: /^[a-z_]+$/.test(error.message) ? error.message : error.name,
  });
  console.error(`FAIL ${stage}; inspect the local report.`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(new URL('report.json', directory), JSON.stringify(report, null, 2));
  console.log(`Visual result: ${report.status}. Report: ${fileURLToPath(new URL('report.json', directory))}`);
}

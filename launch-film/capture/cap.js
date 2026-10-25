// Captures real InterviewIQ screens from the local dev server, with the API stubbed in the browser.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = __dirname;
const fx = require('./fixtures.js');
const missing = new Set();
async function page(b, theme) {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5, permissions: ['microphone', 'camera'] });
  await ctx.addInitScript(([key, theme]) => {
    try { localStorage.setItem(key, theme); localStorage.setItem('TanstackQueryDevtools.open', 'false'); } catch {}

    // Fake media for captures: a monitor-surface screen share and a soft abstract camera feed.
    const canvasStream = (draw) => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const g = c.getContext('2d');
      let t = 0; setInterval(() => { draw(g, t += 1 / 30); }, 33); draw(g, 0); return c.captureStream(30); };
    const cam = (g, t) => { const gr = g.createLinearGradient(0, 0, 640, 480); gr.addColorStop(0, '#d9cbb4'); gr.addColorStop(1, '#8c7d68'); g.fillStyle = gr; g.fillRect(0, 0, 640, 480);
      g.fillStyle = '#e9e0d1'; g.beginPath(); g.ellipse(470, 120, 140, 90, 0, 0, 7); g.fill();
      g.fillStyle = '#3d342c'; g.beginPath(); g.ellipse(320, 520, 190, 150, 0, 0, 7); g.fill();
      g.fillStyle = '#b48d6c'; g.beginPath(); g.ellipse(320 + Math.sin(t) * 4, 230 + Math.sin(t * 1.3) * 3, 78, 96, 0, 0, 7); g.fill();
      g.fillStyle = '#2a221c'; g.beginPath(); g.ellipse(320 + Math.sin(t) * 4, 170 + Math.sin(t * 1.3) * 3, 84, 50, 0, 3.1, 6.3); g.fill(); };
    const md = navigator.mediaDevices;
    if (md) {
      md.getDisplayMedia = async () => { const s = canvasStream((g) => { g.fillStyle = '#f5f2ec'; g.fillRect(0, 0, 640, 480); });
        const tr = s.getVideoTracks()[0]; const gs = tr.getSettings.bind(tr); tr.getSettings = () => ({ ...gs(), displaySurface: 'monitor' }); return s; };
      const gum = md.getUserMedia.bind(md);
      md.getUserMedia = async (c) => { const s = c && c.audio ? await gum({ audio: c.audio }) : new MediaStream();
        if (c && c.video) { const v = canvasStream(cam); v.getVideoTracks().forEach((tr) => s.addTrack(tr)); } return s; };
    }
    // Hide the TanStack Query devtools launcher (the bottom-right circle) for captures.
    const st = document.createElement('style');
    st.textContent = '.tsqd-parent-container,.tsqd-open-btn-container,[aria-label="Open Tanstack query devtools"],[class*="tsqd"],nextjs-portal{display:none!important}[data-orb]{background:radial-gradient(circle at 30% 22%,rgb(255 255 255/.92) 0,rgb(255 255 255/.35) 13%,transparent 32%),radial-gradient(circle at 80% 88%,#8C7249 0,transparent 58%),radial-gradient(circle at 18% 82%,#FFF3DE 0,transparent 52%),linear-gradient(150deg,#FFF3DE,#D9C29B 52%,#8C7249)!important;box-shadow:inset 0 -4px 9px rgb(0 0 0/.2),inset 0 2px 3px rgb(255 255 255/.6),inset 0 0 0 .5px rgb(255 255 255/.25),0 7px 18px -6px #D9C29B99!important}';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
  }, [fx.THEME_KEY, theme]);
  await ctx.route('http://localhost:3000/api/v1/**', async (route) => {
    const u = new URL(route.request().url()); const m = route.request().method();
    const hit = fx.match(m, u.pathname, u.searchParams);
    const cors = { 'access-control-allow-origin': 'http://localhost:3000', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (hit === undefined) { missing.add(m + ' ' + u.pathname); return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"message":"stub"}' }); }
    if (hit === null) return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(hit) });
  });
  for (const u of ['https://cdn.jsdelivr.net/npm/@mediapipe/**', 'https://storage.googleapis.com/mediapipe-models/**', 'https://huggingface.co/**', 'https://cdn.jsdelivr.net/npm/onnxruntime-web*/**']) await ctx.route(u, (r) => r.abort());
  return ctx.newPage();
}
(async () => {
  const shots = JSON.parse(process.argv[2]);
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  for (const s of shots) {
    const p = await page(b, s.theme || 'light');
    if (s.w) await p.setViewportSize({ width: s.w, height: s.h || 1000 });
    p.on('pageerror', (e) => console.log('pageerror', s.name, e.message.slice(0, 200)));
    await p.goto('http://localhost:3000' + s.path, { waitUntil: 'networkidle', timeout: 120000 }).catch((e) => console.log('goto', e.message.slice(0, 100)));
    for (const a of s.actions || []) {
      try {
        if (a.click) await p.getByText(a.click, { exact: !!a.exact }).first().click({ timeout: 5000 });
        if (a.role) await p.getByRole(a.role, { name: a.name }).first().click({ timeout: 5000 });
        if (a.wait) await p.waitForTimeout(a.wait);
        if (a.eval) await p.evaluate(a.eval);
        if (a.code) { await p.locator('.monaco-editor .view-lines').first().click(); await p.evaluate((c) => { const m = window.monaco.editor.getModels()[0]; m.setValue(c); }, a.code); await p.keyboard.press('Control+End'); }
        if (a.sel) await p.locator(a.sel).first().click({ timeout: 5000 });
        if (a.shot) await p.screenshot({ path: `${OUT}/${a.shot}.png` });
      } catch (e) { console.log('action', s.name, JSON.stringify(a), e.message.slice(0, 120)); }
    }
    await p.waitForTimeout(s.settle ?? 2500);
    await p.screenshot({ path: `${OUT}/${s.name}.png`, fullPage: !!s.full });
    await p.context().close();
  }
  console.log('MISSING', [...missing].join('\n'));
  await b.close();
})();

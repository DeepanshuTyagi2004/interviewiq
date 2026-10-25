const { chromium } = require('playwright');
const [,, start, end] = process.argv.map(Number);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + __dirname + '/' + (process.env.FILM || 'film.html') + '');
  await p.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); });
  await p.evaluate(() => setup());
  for (let f = start; f < end; f++) {
    await p.evaluate(t => render(t), f / 30);
    await p.screenshot({ path: __dirname + `/frames/f${String(f).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 95 });
  }
  await b.close();
})();

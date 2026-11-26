import { chromium } from 'playwright';
import fs from 'fs';
const [,, svgPath, outPrefix, times, w, h] = process.argv;
const svg = fs.readFileSync(svgPath, 'utf8');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.setContent(`<html><body style="margin:0;background:#888">${svg.replace('<svg ', `<svg style="width:${w}px;height:${h}px;display:block" `)}</body></html>`);
for (const t of times.split(',')) {
  await p.evaluate(ms => document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; }), +t * 1000);
  await p.screenshot({ path: `${outPrefix}-${t}.png` });
}
await b.close();

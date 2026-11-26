import { chromium } from 'playwright';
import fs from 'fs';
const [, , svgPath, dir] = process.argv;
fs.mkdirSync(dir, { recursive: true });
const svg = fs.readFileSync(svgPath, 'utf8');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const p = await b.newPage({ viewport: { width: 1000, height: 560 }, deviceScaleFactor: 1.92 });
await p.setContent(
  `<html><body style="margin:0;background:#101D24">${svg.replace('<svg ', '<svg style="width:1000px;height:560px;display:block" ')}</body></html>`,
);
for (let i = 0; i < 360; i++) {
  await p.evaluate(
    (ms) =>
      document.getAnimations().forEach((a) => {
        a.pause();
        a.currentTime = ms;
      }),
    (i * 1000) / 30,
  );
  await p.screenshot({ path: `${dir}/f${String(i).padStart(4, '0')}.png` });
}
await b.close();

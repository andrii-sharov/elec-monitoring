import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const uiDir = join(root, 'components', 'ui');

const handRolled: [string, RegExp][] = [
  ['Base UI primitive import', /from ['"]@base-ui\/react/],
  ['Recharts import', /from ['"]recharts['"]/],
  ['raw <select>', /<select[\s>]/],
  ['raw <input>', /<input[\s>]/],
  ['raw <textarea>', /<textarea[\s>]/],
  ['popup animation classes', /\b(animate-in|animate-out|zoom-in-|slide-in-from-)/],
  ['pressed or active state styling', /\b(aria-pressed|aria-selected|data-active):/],
  [
    'control height override',
    /<(?:Input|Button|SelectTrigger|InputGroup|TabsTab|Segment)\b(?:=>|[^>])*?className=["'{`][^"'`]*?(?<![\w:-])(?:h|size)-\d/,
  ],
  ['font size below text-xs', /text-\[(?:0\.(?:[0-6]\d*|7[0-4]\d*)rem|(?:\d|1[01])px)\]/],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return path === uiDir ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test('pages and features build controls only from components/ui', () => {
  const offenders = sourceFiles(root).flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return handRolled
      .filter(([, pattern]) => pattern.test(source))
      .map(([rule]) => `${relative(root, path)}: ${rule}`);
  });
  expect(offenders).toEqual([]);
});

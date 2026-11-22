import { expect, test } from 'vitest';
import { languages, resources } from './index.ts';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].map((m) => m[1] ?? '').toSorted();
}

const flat = Object.fromEntries(
  languages.map((lng) => [lng, flatten(resources[lng].translation as Tree)]),
);
const reference = flat.en!;

test.each(languages)('%s has the same keys as en', (lng) => {
  const keys = [...flat[lng]!.keys()];
  const missing = [...reference.keys()].filter((k) => !flat[lng]!.has(k));
  const extra = keys.filter((k) => !reference.has(k));
  expect({ missing, extra }).toEqual({ missing: [], extra: [] });
});

test.each(languages)('%s has no empty values', (lng) => {
  const empty = [...flat[lng]!].filter(([, v]) => v.trim() === '').map(([k]) => k);
  expect(empty).toEqual([]);
});

test.each(languages)('%s uses the same placeholders as en', (lng) => {
  const mismatched = [...reference]
    .filter(([key, text]) => {
      const other = flat[lng]!.get(key);
      return other !== undefined && placeholders(other).join() !== placeholders(text).join();
    })
    .map(([key]) => key);
  expect(mismatched).toEqual([]);
});

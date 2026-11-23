import { expect, test } from 'vitest';
import { apiDocument } from './app.ts';

test('the OpenAPI document matches the snapshot', async () => {
  await expect(JSON.stringify(apiDocument(), null, 2)).toMatchFileSnapshot(
    './__snapshots__/openapi.json',
  );
});

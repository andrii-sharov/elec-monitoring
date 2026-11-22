import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPgTestDb, createTestDb, pgTestUrl } from '../../test/db.ts';

type Backend = {
  query<T>(text: string): Promise<T[]>;
  close(): Promise<void>;
};

const supabaseRoles = `
  do $$
  declare r text;
  begin
    foreach r in array array['anon', 'authenticated'] loop
      if not exists (select from pg_roles where rolname = r) then
        execute format('create role %I nologin', r);
      end if;
    end loop;
  end $$;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

async function pglite(): Promise<Backend> {
  const t = await createTestDb((client) => client.exec(supabaseRoles).then(() => undefined));
  return {
    query: async <T>(text: string) => (await t.client.query<T>(text)).rows,
    close: t.close,
  };
}

async function postgres(): Promise<Backend> {
  const t = await createPgTestDb((sql) => sql.unsafe(supabaseRoles).then(() => undefined));
  return {
    query: async <T>(text: string) => (await t.sql.unsafe(text)) as unknown as T[],
    close: t.close,
  };
}

const backends = [
  { name: 'PGlite', create: pglite, skip: false },
  { name: 'Postgres', create: postgres, skip: !pgTestUrl },
];

describe.each(backends)('privileges on $name with Supabase roles', ({ create, skip }) => {
  let b: Backend;

  beforeAll(async () => {
    if (!skip) b = await create();
  });

  afterAll(async () => {
    await b?.close();
  });

  test.skipIf(skip).each(['anon', 'authenticated'])('%s cannot read any table', async (role) => {
    const readable = await b.query<{ relname: string }>(`
      select relname from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r'
        and has_table_privilege('${role}', oid, 'select')`);
    expect(readable).toEqual([]);
  });

  test.skipIf(skip)('tables created later are not granted to anon', async () => {
    await b.query('create table later_table (id int)');
    const [row] = await b.query<{ allowed: boolean }>(
      `select has_table_privilege('anon', 'later_table', 'select') as allowed`,
    );
    expect(row?.allowed).toBe(false);
  });
});

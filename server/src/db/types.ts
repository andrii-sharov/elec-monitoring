import { customType, timestamp } from 'drizzle-orm/pg-core';

export const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value)),
});

export const tstz = () => timestamp({ withTimezone: true, mode: 'date' });

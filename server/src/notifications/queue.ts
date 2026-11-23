import type { Tx } from '../db/client.ts';

export type OutageEvent = { deviceId: string; outageId: string };

export interface NotificationQueue {
  recovery(tx: Tx, event: OutageEvent): Promise<void>;
  summary(tx: Tx, event: OutageEvent): Promise<void>;
  powerBlip(tx: Tx, event: OutageEvent): Promise<void>;
}

export const noopNotificationQueue: NotificationQueue = {
  recovery: () => Promise.resolve(),
  summary: () => Promise.resolve(),
  powerBlip: () => Promise.resolve(),
};

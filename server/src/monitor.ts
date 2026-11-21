import { offMessage, onMessage } from './messages.js';

export interface MonitorOptions {
  offlineTimeoutMs: number;
  now: () => Date;
  notify: (text: string) => Promise<void>;
}

export function createMonitor({ offlineTimeoutMs, now, notify }: MonitorOptions) {
  let lastSeen: Date | null = null;
  let offlineNotified = false;

  function onPing() {
    const current = now();
    const message = offlineNotified && lastSeen ? onMessage(lastSeen, current) : null;
    lastSeen = current;
    offlineNotified = false;
    if (message) void notify(message);
  }

  function check() {
    if (!lastSeen || offlineNotified) return;
    if (now().getTime() - lastSeen.getTime() <= offlineTimeoutMs) return;
    offlineNotified = true;
    void notify(offMessage(lastSeen));
  }

  return { onPing, check };
}

export type Monitor = ReturnType<typeof createMonitor>;

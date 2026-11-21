import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMonitor } from '../src/monitor.js';

const TIMEOUT = 120_000;
const START = new Date('2026-11-21T16:42:00Z').getTime();

describe('monitor', () => {
  let clock: number;
  let notify: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  let monitor: ReturnType<typeof createMonitor>;

  const advance = (ms: number) => {
    clock += ms;
  };

  beforeEach(() => {
    clock = START;
    notify = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    monitor = createMonitor({ offlineTimeoutMs: TIMEOUT, now: () => new Date(clock), notify });
  });

  it('sends nothing before the first ping', () => {
    advance(10 * TIMEOUT);
    monitor.check();
    expect(notify).not.toHaveBeenCalled();
  });

  it('starts silently on the first ping and stays silent on regular pings', () => {
    for (let i = 0; i < 5; i++) {
      monitor.onPing();
      advance(30_000);
      monitor.check();
    }
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not alert at exactly the timeout', () => {
    monitor.onPing();
    advance(TIMEOUT);
    monitor.check();
    expect(notify).not.toHaveBeenCalled();
  });

  it('sends one OFF after the timeout, however many checks run', () => {
    monitor.onPing();
    advance(TIMEOUT + 1);
    monitor.check();
    advance(10_000);
    monitor.check();
    monitor.check();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('🔴 Power is OFF\nLast signal: 21 Nov 18:42');
  });

  it('sends one ON with the duration on the next ping', () => {
    monitor.onPing();
    advance(135 * 60_000);
    monitor.check();
    monitor.onPing();
    monitor.onPing();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith(
      '🟢 Power is ON\nWas off for 2 h 15 min (18:42 → 20:57)',
    );
  });

  it('sends no ON when the gap was never reported', () => {
    monitor.onPing();
    advance(TIMEOUT + 5_000);
    monitor.onPing();
    expect(notify).not.toHaveBeenCalled();
  });

  it('updates state before notification finishes', () => {
    notify.mockReturnValue(new Promise(() => {}));
    monitor.onPing();
    advance(TIMEOUT + 1);
    monitor.check();
    monitor.check();
    expect(notify).toHaveBeenCalledTimes(1);
    monitor.onPing();
    monitor.onPing();
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('detects a second outage after recovery', () => {
    monitor.onPing();
    advance(TIMEOUT + 1);
    monitor.check();
    monitor.onPing();
    advance(TIMEOUT + 1);
    monitor.check();
    expect(notify).toHaveBeenCalledTimes(3);
    expect(notify.mock.calls[2][0]).toMatch(/^🔴/);
  });

  it('starts fresh after a restart', () => {
    monitor.onPing();
    advance(TIMEOUT + 1);
    monitor.check();
    notify.mockClear();

    const restarted = createMonitor({
      offlineTimeoutMs: TIMEOUT,
      now: () => new Date(clock),
      notify,
    });
    advance(60 * 60_000);
    restarted.onPing();
    expect(notify).not.toHaveBeenCalled();
  });
});

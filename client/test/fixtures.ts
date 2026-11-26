import type {
  Channel,
  Device,
  Invite,
  InvitePreview,
  Me,
  Member,
  OutageItem,
  Session,
} from '@elec/shared/api';

export function meFixture(overrides: Partial<Me> = {}): Me {
  return {
    id: '5b0c1f0e-4f1a-4c39-9d2a-0a8f3c1d2e01',
    email: 'johnny@example.com',
    email_verified: true,
    phone: null,
    phone_verified: false,
    name: 'Johnny',
    language: 'en',
    timezone: 'Europe/Kyiv',
    has_password: true,
    google_linked: false,
    is_admin: false,
    ...overrides,
  };
}

export function sessionFixture(overrides: Partial<Session> = {}): Session {
  return { access_token: 'access-token', expires_in: 900, user: meFixture(), ...overrides };
}

export function outageFixture(overrides: Partial<OutageItem> = {}): OutageItem {
  return {
    id: '9e1d2c3b-4a5f-4e6d-8c7b-1a2b3c4d5e01',
    type: 'OUTAGE',
    started_at: '2026-11-21T16:42:00Z',
    ended_at: '2026-11-21T18:57:00Z',
    duration_s: 8100,
    cause: 'POWER',
    kind: 'LONG',
    ota_attempt_id: null,
    ...overrides,
  };
}

export function deviceFixture(overrides: Partial<Device> = {}): Device {
  return {
    id: '4c0f6a1e-2b3d-4e5f-9a8b-7c6d5e4f3a01',
    name: 'Home',
    role: 'OWNER',
    state: 'ONLINE',
    state_since: '2026-11-21T14:02:00Z',
    last_seen_at: '2026-11-21T16:41:30Z',
    open_outage: null,
    settings: {
      ping_interval_s: 30,
      offline_timeout_s: 120,
      short_outage_threshold_s: 180,
      notify_short_outages: true,
      notify_network_outages: true,
      quiet_hours: { start: '23:00', end: '07:00' },
      auto_update: false,
    },
    telemetry: { rssi: -61, uptime_s: 9420, reset_reason: 'POWER_ON' },
    settings_sync: { desired_version: 3, applied_version: 3, pending: false },
    firmware: { version: '2.0.0', available: null, update: null },
    ...overrides,
  };
}

export function channelFixture(overrides: Partial<Channel> = {}): Channel {
  return {
    id: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c01',
    type: 'TELEGRAM_PLATFORM',
    name: 'Home chat',
    enabled: true,
    disabled_reason: null,
    config: { chat_id: '-1001234567890' },
    created_at: '2026-11-21T16:42:00Z',
    device_ids: [],
    ...overrides,
  };
}

export function memberFixture(overrides: Partial<Member> = {}): Member {
  return {
    user_id: '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e01',
    name: 'Mary',
    email: 'mary@example.com',
    phone: null,
    role: 'VIEWER',
    joined_at: '2026-11-21T16:42:00Z',
    ...overrides,
  };
}

export function inviteFixture(overrides: Partial<Invite> = {}): Invite {
  return {
    id: '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f01',
    email: 'anna@example.com',
    phone: null,
    expires_at: '2026-11-28T16:42:00Z',
    created_at: '2026-11-21T16:42:00Z',
    ...overrides,
  };
}

export function invitePreviewFixture(overrides: Partial<InvitePreview> = {}): InvitePreview {
  return {
    device_name: 'Home',
    inviter_name: 'John',
    email: 'mary@example.com',
    phone: null,
    expires_at: '2026-11-28T16:42:00Z',
    accepted: false,
    ...overrides,
  };
}

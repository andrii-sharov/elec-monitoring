export const deviceStates = ['PENDING', 'ONLINE', 'OFFLINE', 'UPDATING'] as const;
export type DeviceState = (typeof deviceStates)[number];

export const resetReasons = [
  'POWER_ON',
  'BROWNOUT',
  'SOFTWARE',
  'WATCHDOG',
  'PANIC',
  'UNKNOWN',
] as const;
export type ResetReason = (typeof resetReasons)[number];

export const diagnosticKinds = ['WIFI', 'API'] as const;
export type DiagnosticKind = (typeof diagnosticKinds)[number];

export const outageTypes = ['OUTAGE', 'POWER_BLIP'] as const;
export type OutageType = (typeof outageTypes)[number];

export const outageCauses = ['POWER', 'NETWORK', 'UNKNOWN'] as const;
export type OutageCause = (typeof outageCauses)[number];

export const outageKinds = ['SHORT', 'LONG'] as const;
export type OutageKind = (typeof outageKinds)[number];

export const updateOutcomes = ['SUCCEEDED', 'FAILED', 'ROLLED_BACK'] as const;
export type UpdateOutcome = (typeof updateOutcomes)[number];

export const languages = ['uk', 'en', 'ru'] as const;
export type Language = (typeof languages)[number];
export const defaultLanguage: Language = 'uk';

export const appTargets = ['CLIENT', 'ADMIN'] as const;
export type AppTarget = (typeof appTargets)[number];

export const googleIntents = ['LOGIN', 'LINK'] as const;
export type GoogleIntent = (typeof googleIntents)[number];

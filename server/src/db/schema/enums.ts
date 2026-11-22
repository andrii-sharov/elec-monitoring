import {
  deviceStates,
  diagnosticKinds,
  outageCauses,
  outageKinds,
  outageTypes,
  resetReasons,
  updateOutcomes,
} from '@elec/shared';
import { pgEnum } from 'drizzle-orm/pg-core';

export const deviceState = pgEnum('device_state', deviceStates);
export const resetReason = pgEnum('reset_reason', resetReasons);
export const diagnosticKind = pgEnum('diagnostic_kind', diagnosticKinds);
export const outageType = pgEnum('outage_type', outageTypes);
export const outageCause = pgEnum('outage_cause', outageCauses);
export const outageKind = pgEnum('outage_kind', outageKinds);
export const updateOutcome = pgEnum('update_outcome', updateOutcomes);

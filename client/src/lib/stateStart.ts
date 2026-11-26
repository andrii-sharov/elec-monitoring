import type { DeviceListItem } from '@elec/shared/api';

export function stateStart(device: Pick<DeviceListItem, 'state' | 'state_since' | 'open_outage'>) {
  return device.state === 'OFFLINE' && device.open_outage
    ? device.open_outage.started_at
    : device.state_since;
}

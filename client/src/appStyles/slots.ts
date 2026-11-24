import type { DeviceState } from '@elec/shared';
import type { Device, DeviceListItem } from '@elec/shared/api';

export type StatusMarkProps = {
  state: DeviceState;
  lastSeenAt?: string | null;
};

export type DeviceSummaryProps = {
  device: DeviceListItem;
  index: number;
};

export type DeviceHeroProps = {
  device: Device;
};

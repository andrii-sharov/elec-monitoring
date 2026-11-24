import type { AppStyleDefinition } from '../registry';
import { LampDeviceHero } from './LampDeviceHero';
import { LampDeviceSummary } from './LampDeviceSummary';
import { LampStatusMark } from './LampStatusMark';

export const lamp: AppStyleDefinition = {
  id: 'lamp',
  loadFonts: () => import('@fontsource-variable/onest'),
  slots: {
    StatusMark: LampStatusMark,
    DeviceSummary: LampDeviceSummary,
    DeviceHero: LampDeviceHero,
  },
  deviceListClassName: 'grid gap-4 sm:grid-cols-2',
};

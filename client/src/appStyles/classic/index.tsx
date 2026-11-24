import type { AppStyleDefinition } from '../registry';
import { ClassicDeviceHero } from './ClassicDeviceHero';
import { ClassicDeviceSummary } from './ClassicDeviceSummary';
import { ClassicStatusMark } from './ClassicStatusMark';

export const classic: AppStyleDefinition = {
  id: 'classic',
  loadFonts: () => Promise.resolve(),
  slots: {
    StatusMark: ClassicStatusMark,
    DeviceSummary: ClassicDeviceSummary,
    DeviceHero: ClassicDeviceHero,
  },
  deviceListClassName: 'grid gap-3 sm:grid-cols-2',
};

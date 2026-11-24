import { StatusBadge } from '@/components/StatusBadge';
import type { AppStyleDefinition } from '../registry';
import { ClassicDeviceHero } from './ClassicDeviceHero';
import { ClassicDeviceSummary } from './ClassicDeviceSummary';

export const classic: AppStyleDefinition = {
  id: 'classic',
  loadFonts: () => Promise.resolve(),
  slots: {
    StatusMark: StatusBadge,
    DeviceSummary: ClassicDeviceSummary,
    DeviceHero: ClassicDeviceHero,
  },
  deviceListClassName: 'grid gap-3 sm:grid-cols-2',
};

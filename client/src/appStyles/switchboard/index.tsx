import type { AppStyleDefinition } from '../registry';
import { SwitchboardDeviceHero } from './SwitchboardDeviceHero';
import { SwitchboardDeviceSummary } from './SwitchboardDeviceSummary';
import { SwitchboardStatusMark } from './SwitchboardStatusMark';

export const switchboard: AppStyleDefinition = {
  id: 'switchboard',
  loadFonts: () =>
    Promise.all([import('@fontsource-variable/unbounded'), import('@fontsource-variable/onest')]),
  slots: {
    StatusMark: (props) => <SwitchboardStatusMark {...props} showLabel />,
    DeviceSummary: SwitchboardDeviceSummary,
    DeviceHero: SwitchboardDeviceHero,
  },
  deviceListClassName: 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4',
};

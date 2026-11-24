import type { AppStyleDefinition } from '../registry';
import { SonarDeviceHero } from './SonarDeviceHero';
import { SonarDeviceSummary } from './SonarDeviceSummary';
import { SonarStatusMark } from './SonarStatusMark';

export const sonar: AppStyleDefinition = {
  id: 'sonar',
  loadFonts: () => import('@fontsource-variable/geologica'),
  slots: {
    StatusMark: (props) => <SonarStatusMark {...props} showLabel />,
    DeviceSummary: SonarDeviceSummary,
    DeviceHero: SonarDeviceHero,
  },
  deviceListClassName: 'flex flex-col gap-2',
};

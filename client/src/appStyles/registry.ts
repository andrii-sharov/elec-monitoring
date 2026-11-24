import type { ComponentType } from 'react';
import { createPreference } from '@/lib/preference';
import type { DeviceHeroProps, DeviceSummaryProps, StatusMarkProps } from './slots';
import { classic } from './classic';
import { lamp } from './lamp';
import { sonar } from './sonar';
import { switchboard } from './switchboard';

export const appStyleIds = ['classic', 'sonar', 'switchboard', 'lamp'] as const;
export type AppStyleId = (typeof appStyleIds)[number];

export type AppStyleDefinition = {
  id: AppStyleId;
  loadFonts(): Promise<unknown>;
  slots: {
    StatusMark: ComponentType<StatusMarkProps>;
    DeviceSummary: ComponentType<DeviceSummaryProps>;
    DeviceHero: ComponentType<DeviceHeroProps>;
  };
  deviceListClassName: string;
};

export const appStyleStorageKey = 'em.appStyle';

export const appStyles: Record<AppStyleId, AppStyleDefinition> = {
  classic,
  sonar,
  switchboard,
  lamp,
};

export const appStylePreference = createPreference({
  key: appStyleStorageKey,
  choices: appStyleIds,
  fallback: 'classic',
  apply: (id) => {
    document.documentElement.dataset.appStyle = id;
  },
});

export function hasStoredAppStyle(): boolean {
  try {
    return localStorage.getItem(appStyleStorageKey) !== null;
  } catch {
    return true;
  }
}

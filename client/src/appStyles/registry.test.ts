import { resources, languages } from '@elec/shared';
import { describe, expect, test } from 'vitest';
import { appStyleIds, appStyles, appStylePreference } from './registry.ts';

describe('app style registry', () => {
  test.each(appStyleIds)('%s has a definition with all slots', (id) => {
    const style = appStyles[id];
    expect(style.id).toBe(id);
    expect(style.slots.StatusMark).toBeTypeOf('function');
    expect(style.slots.DeviceSummary).toBeTypeOf('function');
    expect(style.slots.DeviceHero).toBeTypeOf('function');
  });

  test.each(appStyleIds)('%s has a name in every language', (id) => {
    for (const language of languages) {
      const names = resources[language].translation.app.appStyle as Record<
        string,
        { name: string }
      >;
      expect(names[id]?.name).toBeTruthy();
    }
  });

  test('an unknown stored style counts as classic', () => {
    localStorage.setItem('em.appStyle', 'neon');
    expect(appStylePreference.read()).toBe('classic');
  });

  test('writing a style sets it on the document', () => {
    appStylePreference.write('sonar');
    expect(document.documentElement.dataset.appStyle).toBe('sonar');
    expect(localStorage.getItem('em.appStyle')).toBe('sonar');
  });
});

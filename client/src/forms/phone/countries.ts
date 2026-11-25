import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js';

export type Country = { code: CountryCode; name: string; callingCode: string };

const cache = new Map<string, Country[]>();

export function countries(language: string): Country[] {
  const cached = cache.get(language);
  if (cached) return cached;
  const names = new Intl.DisplayNames([language], { type: 'region', fallback: 'code' });
  const list = getCountries()
    .map((code) => ({
      code,
      name: names.of(code) ?? code,
      callingCode: `+${getCountryCallingCode(code)}`,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name, language));
  cache.set(language, list);
  return list;
}

import { defaultLanguage, languages, type Language } from '@elec/shared';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSession } from '@/api/session';
import { useUpdateMe } from '@/api/useUpdateMe';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { errorMessage } from '@/forms/errorMessage';
import { rememberLanguage } from '@/lib/i18n';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const updateMe = useUpdateMe();
  const current = languages.find((language) => language === i18n.resolvedLanguage);
  const items = languages.map((value) => ({ value, label: t(`app.common.languages.${value}`) }));

  function change(language: Language | null) {
    if (!language) return;
    if (me) {
      updateMe.mutate({ language }, { onError: (error) => toast.error(errorMessage(t, error)) });
      return;
    }
    rememberLanguage(language);
    void i18n.changeLanguage(language);
  }

  return (
    <Select items={items} value={current ?? defaultLanguage} onValueChange={change}>
      <SelectTrigger size="sm" aria-label={t('app.common.language')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

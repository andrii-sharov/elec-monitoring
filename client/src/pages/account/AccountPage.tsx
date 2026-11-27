import { KeyRound, Palette, TriangleAlert, UserRound, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useSession } from '@/api/session';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { useTabParam } from '@/lib/useTabParam';
import { AppearanceCard } from './AppearanceCard';
import { ChangePasswordForm } from './ChangePasswordForm';
import { DeleteAccount } from './DeleteAccount';
import { Identifiers } from './Identifiers';
import { ProfileForm } from './ProfileForm';
import { SessionsCard } from './SessionsCard';
import { SignInMethods } from './SignInMethods';

const sections = ['profile', 'appearance', 'security', 'danger'] as const;
const icons: Record<(typeof sections)[number], LucideIcon> = {
  profile: UserRound,
  appearance: Palette,
  security: KeyRound,
  danger: TriangleAlert,
};

export function AccountPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  const [params] = useSearchParams();
  const [tab, select] = useTabParam(sections, params.has('confirmDelete') ? 'danger' : 'profile');

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-semibold">{t('app.account.title')}</h1>
      {me ? (
        <Tabs value={tab} onValueChange={(value) => select(value as (typeof sections)[number])}>
          <TabsList aria-label={t('app.account.tabs.label')} className="max-sm:-mx-4 max-sm:px-4">
            {sections.map((section) => {
              const Icon = icons[section];
              return (
                <TabsTab key={section} value={section}>
                  <Icon aria-hidden="true" />
                  {t(`app.account.tabs.${section}`)}
                </TabsTab>
              );
            })}
          </TabsList>
          <TabsPanel value="profile" className="flex flex-col gap-8">
            <ProfileForm key={me.id} me={me} />
          </TabsPanel>
          <TabsPanel value="appearance" className="flex flex-col gap-8">
            <AppearanceCard />
          </TabsPanel>
          <TabsPanel value="security" className="flex flex-col gap-8">
            <Identifiers me={me} />
            <SignInMethods me={me} />
            {me.has_password ? <ChangePasswordForm /> : null}
            <SessionsCard />
          </TabsPanel>
          <TabsPanel value="danger" className="flex flex-col gap-8">
            <DeleteAccount me={me} />
          </TabsPanel>
        </Tabs>
      ) : (
        <output aria-label={t('app.common.loading')} className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
        </output>
      )}
    </div>
  );
}

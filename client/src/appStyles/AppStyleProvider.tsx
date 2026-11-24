import { createContext, use, useEffect, type ReactNode } from 'react';
import {
  appStylePreference,
  appStyles,
  type AppStyleDefinition,
  type AppStyleId,
} from './registry';

const AppStyleContext = createContext<AppStyleDefinition>(appStyles.classic);

type AppStyleProviderProps = {
  id?: AppStyleId;
  children: ReactNode;
};

export function AppStyleProvider({ id, children }: AppStyleProviderProps) {
  const [stored] = appStylePreference.use();
  const style = appStyles[id ?? stored];
  useEffect(() => {
    void style.loadFonts();
  }, [style]);
  return <AppStyleContext value={style}>{children}</AppStyleContext>;
}

export function useAppStyle(): AppStyleDefinition {
  return use(AppStyleContext);
}

export const useAppStylePreference = appStylePreference.use;

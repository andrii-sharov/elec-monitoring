import type { RouteObject } from 'react-router';
import { NotFound } from '@/pages/NotFound';

export const routes: RouteObject[] = [{ path: '*', Component: NotFound }];

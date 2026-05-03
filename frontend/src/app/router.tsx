// [initial module draft]
import {
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { RootLayout } from './layouts/RootLayout.js';
import { LandingPage } from '../pages/LandingPage.js';
import { PlaygroundPage } from '../pages/PlaygroundPage.js';
import { DocsPage } from '../pages/DocsPage.js';

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingPage,
});

export interface PlaygroundSearch {
  user: string;
}

const playgroundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/playground',
  validateSearch: (search: Record<string, unknown>): PlaygroundSearch => ({
    user:
      typeof search.user === 'string' && search.user.trim().length > 0
        ? search.user.trim()
        : 'user-42',
  }),
  component: PlaygroundPage,
});

const docsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/docs',
  component: DocsPage,
});

const routeTree = rootRoute.addChildren([indexRoute, playgroundRoute, docsRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

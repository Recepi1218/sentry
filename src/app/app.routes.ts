import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/shell/shell').then((m) => m.Shell),
    children: [
      {
        path: '',
        title: 'Översikt – Sentry',
        loadComponent: () =>
          import('./features/pages/overview-page').then((m) => m.OverviewPage),
      },
      {
        path: 'agenter',
        title: 'Agenter – Sentry',
        loadComponent: () => import('./features/pages/agents-page').then((m) => m.AgentsPage),
      },
      {
        path: 'forslag',
        title: 'Produktförslag – Sentry',
        loadComponent: () =>
          import('./features/pages/proposals-page').then((m) => m.ProposalsPage),
      },
      {
        path: 'ordrar',
        title: 'Ordrar – Sentry',
        loadComponent: () => import('./features/pages/orders-page').then((m) => m.OrdersPage),
      },
      {
        path: 'ekonomi',
        title: 'Ekonomi och budget – Sentry',
        loadComponent: () => import('./features/pages/economy-page').then((m) => m.EconomyPage),
      },
      {
        path: 'logg',
        title: 'Logg – Sentry',
        loadComponent: () => import('./features/pages/log-page').then((m) => m.LogPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];

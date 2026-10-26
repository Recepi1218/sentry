import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { environment } from '../environments/environment';
import { N8nSentryApi } from './core/api/n8n-sentry-api';
import { operatorTokenInterceptor } from './core/api/operator-token.interceptor';
import { SentryApi } from './core/api/sentry-api';
import { SENTRY_CONFIG } from './core/api/sentry-config';
import { MockSentryApi } from './core/mock/mock-sentry-api';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    provideHttpClient(withFetch(), withInterceptors([operatorTokenInterceptor])),
    { provide: SENTRY_CONFIG, useValue: environment },
    { provide: SentryApi, useClass: environment.mode === 'n8n' ? N8nSentryApi : MockSentryApi },
  ],
};

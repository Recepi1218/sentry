import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { OperatorSession } from './operator-session';
import { SENTRY_CONFIG } from './sentry-config';

/**
 * True when `url` points at or below `baseUrl` – same origin and a path inside the base path.
 * A plain startsWith() would also match https://acme.app.n8n.cloud.attacker.example.
 */
export function isUnderBaseUrl(url: string, baseUrl: string): boolean {
  if (!baseUrl) return false;
  try {
    const target = new URL(url);
    const base = new URL(baseUrl);
    const basePath = base.pathname.replace(/\/+$/, '');
    return (
      target.origin === base.origin &&
      (target.pathname === basePath || target.pathname.startsWith(`${basePath}/`))
    );
  } catch {
    return false;
  }
}

/** Attaches the operator token to requests for the n8n API – and to nothing else. */
export const operatorTokenInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(OperatorSession).token();
  const { n8nBaseUrl } = inject(SENTRY_CONFIG);
  if (!token || !isUnderBaseUrl(request.url, n8nBaseUrl)) return next(request);
  return next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};

import { isUnderBaseUrl } from './operator-token.interceptor';

const BASE = 'https://acme.app.n8n.cloud/webhook/sentry/v1';

describe('isUnderBaseUrl', () => {
  it.each([`${BASE}/snapshot`, `${BASE}/approvals/decision`, BASE, `${BASE}/`])(
    'sends the token to %s',
    (url) => {
      expect(isUnderBaseUrl(url, BASE)).toBe(true);
    },
  );

  it.each([
    'https://acme.app.n8n.cloud.attacker.example/webhook/sentry/v1/snapshot',
    'http://acme.app.n8n.cloud/webhook/sentry/v1/snapshot',
    'https://acme.app.n8n.cloud/webhook/sentry/v10/snapshot',
    'https://acme.app.n8n.cloud/webhook/other',
    'https://fonts.example.com/font.woff2',
    'not a url',
  ])('withholds the token from %s', (url) => {
    expect(isUnderBaseUrl(url, BASE)).toBe(false);
  });

  it('withholds the token when no base URL is configured', () => {
    expect(isUnderBaseUrl(`${BASE}/snapshot`, '')).toBe(false);
  });
});

import * as oidc from 'openid-client';
import { config, requireConfig } from '../config.js';

export const CLIENT_ID = 'taxi-web';
export const REDIRECT_URI = `${config.taxiUrl}/callback`;
export const REQUESTED_SCOPE = 'wallet:read wallet:charge offline_access';

let cached: oidc.Configuration | undefined;

/**
 * Plain OAuth2 server (no OIDC discovery): metadata is configured by hand.
 * openid-client generates/validates `state` and PKCE (S256) for us, and sends the client
 * secret with HTTP Basic (client_secret_basic) — which doubles as a conformance check on our AS.
 */
export function getOAuthConfig(): oidc.Configuration {
  if (cached) return cached;
  requireConfig('taxiWebSecret');
  cached = new oidc.Configuration(
    {
      issuer: config.asUrl,
      authorization_endpoint: `${config.asUrl}/authorize`,
      token_endpoint: `${config.asUrl}/token`,
      jwks_uri: `${config.asUrl}/.well-known/jwks.json`,
    },
    CLIENT_ID,
    undefined,
    oidc.ClientSecretBasic(config.taxiWebSecret),
  );
  // Lab runs on http://localhost; openid-client refuses plain HTTP unless explicitly allowed.
  oidc.allowInsecureRequests(cached);
  return cached;
}

export { oidc };

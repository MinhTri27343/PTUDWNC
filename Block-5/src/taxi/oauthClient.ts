import * as oidc from 'openid-client';
import { config, requireConfig } from '../config.js';

export const CLIENT_ID = 'taxi-web';
export const REDIRECT_URI = `${config.taxiUrl}/callback`;
export const REQUESTED_SCOPE = 'wallet:read wallet:charge offline_access';

/** Marks Taxi's own outbound calls so the Flow UI can draw them as coming from Taxi. */
export const TAXI_HEADERS = { 'X-Flow-Actor': 'taxi' } as const;

const taxiFetch = (url: string, options: RequestInit): Promise<Response> =>
  fetch(url, { ...options, headers: { ...(options.headers as Record<string, string>), ...TAXI_HEADERS } });

function build(clientId: string, secret: string): oidc.Configuration {
  const cfg = new oidc.Configuration(
    {
      issuer: config.asUrl,
      authorization_endpoint: `${config.asUrl}/authorize`,
      token_endpoint: `${config.asUrl}/token`,
      jwks_uri: `${config.asUrl}/.well-known/jwks.json`,
    },
    clientId,
    undefined,
    oidc.ClientSecretBasic(secret),
  );
  // Lab runs on http://localhost; openid-client refuses plain HTTP unless explicitly allowed.
  oidc.allowInsecureRequests(cfg);
  (cfg as unknown as Record<symbol, unknown>)[oidc.customFetch] = taxiFetch;
  return cfg;
}

let web: oidc.Configuration | undefined;
let m2m: oidc.Configuration | undefined;

/**
 * Plain OAuth2 server (no OIDC discovery): metadata is configured by hand.
 * openid-client generates/validates `state` and PKCE (S256) for us, and sends the client
 * secret with HTTP Basic (client_secret_basic) — which doubles as a conformance check on our AS.
 */
export function getOAuthConfig(): oidc.Configuration {
  requireConfig('taxiWebSecret');
  return (web ??= build(CLIENT_ID, config.taxiWebSecret));
}

/** Taxi's machine identity (client_credentials, no user). */
export function getM2mConfig(): oidc.Configuration {
  requireConfig('taxiM2mSecret');
  return (m2m ??= build('taxi-m2m', config.taxiM2mSecret));
}

export { oidc };

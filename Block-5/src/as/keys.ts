import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { calculateJwkThumbprint, SignJWT, type JWK } from 'jose';
import { config, requireConfig } from '../config.js';
import { nowSec, randomToken } from '../util.js';

export type PrincipalType = 'user' | 'client';

export interface AccessTokenInput {
  sub: string;
  clientId: string;
  scope: string;
  principalType: PrincipalType;
}

let privateKey: KeyObject;
let publicJwk: JWK;
let kid: string;

/** Load the ES256 key from env and derive `kid` as the RFC 7638 thumbprint of the public key. */
export async function initKeys(): Promise<void> {
  requireConfig('privateKeyPem');
  privateKey = createPrivateKey(config.privateKeyPem);
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' }) as JWK;
  kid = await calculateJwkThumbprint(jwk);
  publicJwk = { ...jwk, kid, alg: 'ES256', use: 'sig' };
}

export const getJwks = (): { keys: JWK[] } => ({ keys: [publicJwk] });

export async function signAccessToken(input: AccessTokenInput): Promise<{ token: string; exp: number }> {
  const iat = nowSec();
  const exp = iat + config.accessTtl;
  const token = await new SignJWT({
    client_id: input.clientId,
    scope: input.scope,
    principal_type: input.principalType,
  })
    .setProtectedHeader({ alg: 'ES256', kid, typ: 'at+jwt' })
    .setIssuer(config.asUrl)
    .setAudience(config.audience)
    .setSubject(input.sub)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(randomToken(12))
    .sign(privateKey);
  return { token, exp };
}

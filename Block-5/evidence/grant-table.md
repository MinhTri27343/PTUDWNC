# Grant table — filled from observed /token responses
# Captured 2026-10-22T03:42:46.086Z. Values come from the responses and the decoded access-token claims, not from slides.

| grant_type | client | HTTP | refresh_token | sub | aud | scope | principal_type | expires_in | token_type |
|---|---|---|---|---|---|---|---|---|---|
| authorization_code | taxi-web | 200 | yes | `u_alice` | `wallet-api` | `wallet:read wallet:charge offline_access` | `user` | `120` | `Bearer` |
| refresh_token | taxi-web | 200 | yes | `u_alice` | `wallet-api` | `wallet:read wallet:charge offline_access` | `user` | `120` | `Bearer` |
| client_credentials | taxi-m2m | 200 | no | `taxi-m2m` | `wallet-api` | `rates:read` | `client` | `120` | `Bearer` |

## RFC 6749 §5.1 check (per observed response)
- **authorization_code** (taxi-web): access_token present (REQUIRED); token_type Bearer (REQUIRED); expires_in 120 (integer, RECOMMENDED); scope returned; refresh_token present (allowed; offline_access); Cache-Control: no-store + Pragma: no-cache present (MUST, §5.1)
- **refresh_token** (taxi-web): access_token present (REQUIRED); token_type Bearer (REQUIRED); expires_in 120 (integer, RECOMMENDED); scope returned; refresh_token present (allowed; offline_access); Cache-Control: no-store + Pragma: no-cache present (MUST, §5.1)
- **client_credentials** (taxi-m2m): access_token present (REQUIRED); token_type Bearer (REQUIRED); expires_in 120 (integer, RECOMMENDED); scope returned; refresh_token absent (§4.4.3 ok); Cache-Control: no-store + Pragma: no-cache present (MUST, §5.1)

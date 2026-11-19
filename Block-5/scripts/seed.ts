import argon2 from 'argon2';
import { config, requireConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { nowSec } from '../src/util.js';

requireConfig('taxiWebSecret', 'taxiM2mSecret');

// Fake lab data only.
const LAB_USERS = [
  { id: 'u_alice', username: 'alice', display_name: 'Alice', password: 'alice-pass' },
  { id: 'u_bob', username: 'bob', display_name: 'Bob', password: 'bob-pass' },
];

const hash = (plain: string) => argon2.hash(plain, { type: argon2.argon2id });

// --- Authorization Server ---
const as = openDb('as');
const upsertUser = as.prepare(
  `INSERT INTO users (id, username, display_name, password_hash) VALUES (@id, @username, @display_name, @password_hash)
   ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, display_name = excluded.display_name`,
);
for (const u of LAB_USERS) {
  upsertUser.run({
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    password_hash: await hash(u.password),
  });
}

const upsertClient = as.prepare(
  `INSERT INTO clients (client_id, name, secret_hash, redirect_uri, allowed_scopes, grant_types)
   VALUES (@client_id, @name, @secret_hash, @redirect_uri, @allowed_scopes, @grant_types)
   ON CONFLICT(client_id) DO UPDATE SET
     name = excluded.name, secret_hash = excluded.secret_hash, redirect_uri = excluded.redirect_uri,
     allowed_scopes = excluded.allowed_scopes, grant_types = excluded.grant_types`,
);
upsertClient.run({
  client_id: 'taxi-web',
  name: 'Taxi',
  secret_hash: await hash(config.taxiWebSecret),
  redirect_uri: `${config.taxiUrl}/callback`,
  allowed_scopes: 'wallet:read wallet:charge offline_access',
  grant_types: 'authorization_code refresh_token',
});
upsertClient.run({
  client_id: 'taxi-m2m',
  name: 'Taxi Backend (M2M)',
  secret_hash: await hash(config.taxiM2mSecret),
  redirect_uri: null,
  allowed_scopes: 'rates:read',
  grant_types: 'client_credentials',
});
as.close();

// --- Wallet API ---
const api = openDb('api');
const upsertWallet = api.prepare(
  'INSERT INTO wallets (user_id, balance_cents) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING',
);
upsertWallet.run('u_alice', 100_000);
upsertWallet.run('u_bob', 50_000);
api.close();

// --- Taxi ---
const taxi = openDb('taxi');
const upsertTaxiUser = taxi.prepare(
  'INSERT INTO taxi_users (id, display_name) VALUES (?, ?) ON CONFLICT(id) DO NOTHING',
);
upsertTaxiUser.run('alice', 'Alice');
upsertTaxiUser.run('bob', 'Bob');
taxi
  .prepare(
    `INSERT INTO rides (id, taxi_user_id, amount_cents, status, created_at)
     VALUES ('ride-1001', 'alice', 2500, 'pending', ?) ON CONFLICT(id) DO NOTHING`,
  )
  .run(nowSec());
taxi.close();

console.log('Seeded: users alice/bob, clients taxi-web/taxi-m2m, wallets, taxi accounts, ride-1001.');

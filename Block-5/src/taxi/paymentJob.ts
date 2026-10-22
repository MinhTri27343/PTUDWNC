import { pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { openDb } from '../db.js';
import { iso, log } from '../util.js';
import { getAccessToken, NotLinkedError } from './tokenManager.js';
import { TaxiStore } from './store.js';

export interface JobSummary {
  counterBefore: number;
  counterAfter: number;
  charged: string[];
  skipped: string[];
  failed: string[];
}

async function readCounter(): Promise<number> {
  const res = await fetch(`${config.apiUrl}/debug/counter`);
  return ((await res.json()) as { charge_counter: number }).charge_counter;
}

/**
 * Charge pending rides for linked users. Runs with NO user session: only the stored refresh token.
 * Users are processed sequentially; the Idempotency-Key (= ride id) makes a retry harmless.
 */
export async function runPaymentJob(store: TaxiStore, onlyUser?: string): Promise<JobSummary> {
  const summary: JobSummary = { counterBefore: await readCounter(), counterAfter: 0, charged: [], skipped: [], failed: [] };
  log('taxi-job', 'start', { counter_before: summary.counterBefore });

  const users = onlyUser ? [onlyUser] : store.linkedUserIds();
  for (const userId of users) {
    for (const ride of store.pendingRides(userId)) {
      try {
        const accessToken = await getAccessToken(store, userId);
        const link = store.getLink(userId);
        const res = await fetch(`${config.apiUrl}/wallet/charges`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': ride.id,
          },
          body: JSON.stringify({ amount_cents: ride.amount_cents }),
        });
        log('taxi-job', 'charge_response', {
          user: userId,
          ride: ride.id,
          http_status: res.status,
          access_exp: link?.access_exp ? iso(link.access_exp) : null,
        });
        if (res.ok) {
          store.markRide(ride.id, 'charged');
          summary.charged.push(ride.id);
        } else {
          summary.failed.push(ride.id);
        }
      } catch (err) {
        if (err instanceof NotLinkedError) {
          summary.skipped.push(ride.id);
          log('taxi-job', 'skipped', { user: userId, ride: ride.id, reason: 'wallet not linked' });
          break;
        }
        throw err;
      }
    }
  }

  summary.counterAfter = await readCounter();
  log('taxi-job', 'done', { ...summary });
  return summary;
}

// CLI: `npm run taxi:job [-- --expire]`. --expire simulates "Alice left > 2 minutes ago" (access token stale).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = new TaxiStore(openDb('taxi'));
  if (process.argv.includes('--expire')) {
    store.expireAccessTokens();
    log('taxi-job', 'simulated_expiry', { note: 'stored access tokens marked expired' });
  }
  await runPaymentJob(store);
}

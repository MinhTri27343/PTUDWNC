/** Starting data shared by `npm run db:seed` and the Flow UI "Reset demo" button. */
export const SEED_BALANCES: Record<string, number> = { u_alice: 100_000, u_bob: 50_000 };
export const SEED_RIDE = { id: 'ride-1001', taxiUser: 'alice', amountCents: 2500 } as const;

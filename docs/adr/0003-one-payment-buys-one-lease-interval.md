# One payment buys exactly one lease interval, with no refunds

Every listing fixes a lease interval and a price per interval. A spawn buys the first interval and each extension buys one more. At expiry the workload is destroyed immediately, with no grace period. Nothing is refunded: not unused time, and not a paid spawn the provider then fails to provision.

A TOON route has a fixed price, so "one route price = one interval price" needs no amount arithmetic at the provider and keeps each packet far below the `u64` per-packet ceiling. The price is that a long lease is many extensions.

Failed spawns are not credited. TOON bills for *an* answer, so a capacity race or provisioning error still costs the tenant the interval. We accept that loss, which is bounded by one interval, rather than keep a per-payer credit ledger at every provider.

## Considered Options

- **A spawn or extension buys N intervals.** Rejected: it needs a variable amount against a fixed route price.
- **Credit failed spawns to the payer.** Rejected for now: it adds per-provider state for a loss already bounded by one interval.

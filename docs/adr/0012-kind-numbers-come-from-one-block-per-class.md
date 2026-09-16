# Kind numbers come from one contiguous block per NIP-01 class

**Status:** Accepted, 2026-09-16. Answers [issue #13](https://github.com/toon-protocol/TOON_Network/issues/13); the allocation is in spec §3.1 and the reference provider's `src/nostr/kinds.rs` carries it.

TOON Network allocates its event kinds from one contiguous block per NIP-01 class — `4432`–`4441` regular, `10432`–`10441` replaceable, `30432`–`30441` addressable — rather than picking a free number wherever one happens to sit. A relay filter or a tenant's directory read can then name a range instead of a list, the shared `432` suffix makes a stray kind obvious on sight, and every future TOON Network kind has an obvious home next to the ones already allocated. The blocks and the collision check behind them are in spec §3.1.

The numbers themselves were already in the reference provider (`toon-provider`, `src/nostr/kinds.rs`) as placeholders. We ratified them rather than choosing fresh ones: they survived the collision check unchanged, and changing them would have invalidated the provider's tests and the wire fixtures for no gain.

## Considered Options

- **A number per kind, chosen wherever the registry is free.** Rejected: it gives tenants no cheap range filter and no rule for where the next kind goes, so each new kind reopens the whole question.
- **Reusing Paygress's `38383`–`38386` and `20384` for wire compatibility.** Rejected: `38383` collides with NIP-69, and the other four name events this protocol does not have (ADR 0001 already forked the schema).

## Consequences

- The blocks are ten kinds wide. A block that fills up is extended by a new block chosen the same way and recorded in §3.1, not by spilling into neighbouring numbers.
- The collision check is a point-in-time claim, not a reservation: nothing stops a NIP from later claiming a number in a block. §3.1.1 records what was checked and when, so a future collision can be dated.
- One addressable kind, `30437`, is reserved for a record the provider never publishes or reads (the tenant-side Deployment). Reserving it here keeps `toon.network` one namespace across both sides.

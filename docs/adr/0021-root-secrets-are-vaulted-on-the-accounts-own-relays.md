# Root secrets are vaulted on the account's own relays

**Status:** Proposed, 2026-09-22. Decided in the console design session; the glossary term is **Lease Vault**.

The console keeps each lease's root secret in the account's **Lease Vault**: one NIP-78 app-data event per lease (kind 30078, one `d` tag per lease), with the contents NIP-44-sealed to the account itself. The vault is published to the account's NIP-65 write relays and cached locally. An account that signs in on a new machine gets its leases back.

A lost root secret loses the lease, and nothing in the protocol can recover it (spec §6.1.1). A local-only store would make one disk the single point of failure for every workload an account runs. The TOON relay stores 30000-range kinds, and a write costs 1 µUSDC, paid from the account's own channel.

## Considered Options

- **Local storage only.** Rejected as the default, and kept as a per-lease "local only" switch.
- **A console backend.** Rejected by ADR 0019.

## Consequences

- **The privacy line moves, but only to the account's own relays.** A provider still learns nothing that links a lease to an account; the rule that a tenant has no published identity towards providers holds. The account's relays learn how many vault records it has and when they change, but not their contents. Those contents include the `workload_id`, which ADR 0016 took off public relays. An account that wants no such trail uses local-only leases.
- A rotation (ADR 0018) updates the vault record *before* the first `rotate` request and keeps both roots until every member confirms, as the tooling's lease file does today.

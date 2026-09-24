# A gateway's sealing key is pinned by its URL, not by a signature

**Status:** Accepted, 2026-09-23, with a limit this ADR states plainly and Milestone 9 is expected to revisit. Decided while implementing [#97](https://github.com/toon-protocol/TOON_Network/issues/97), the console's Gateway Handover. The glossary terms are **Workload Gateway**, **Gateway Grant** and **Gateway Handover**; the console carries it in `packages/daemon/src/gateway.ts` and the one pinned URL is a network profile's `gatewayConnectorUrl`.

A tenant seals a Gateway Handover to the gateway's connector, and to seal it must know that connector's sealing key. A provider's key comes from a **signed** document: its Provider Profile pins it, and a tenant refuses if the connector reports another (ADR 0011). **A Workload Gateway has no such document.** It publishes nothing and signs nothing, because a gateway is chosen by a packet rather than by a publication (ADR 0017).

So a tenant pins **one URL** — the gateway's connector — and reads the ILP address, the sealing key and the route's price from that connector's own `GET /ilp` when it sends. What vouches for the key is the name the URL points at: DNS, and the certificate served under it. The console already trusts exactly that for its own connector and its relay (ADR 0024 says the same of a relay's write edge), so this adds no new kind of trust. It replaces a key typed into a configuration file by hand, which is what the reference tooling does today (`tools/grant/seal.mjs --gateway-seal-key`), and a key a person types is a key a person can get wrong.

## The limit, stated

A party that controls the name can answer with a key of its own, open the handover and read the Gateway Grant. What that buys it is bounded, and the bound is the reason this is acceptable now:

- It **can** read the workload's lease state and access details, for as long as the grant lasts — 24 hours by default — and it can serve or withhold the hostname.
- It **cannot** rotate the Continuation Token: a grant presented on `rotate` is refused (§6.8).
- It **cannot** terminate the lease, take it from its tenant, or spend from the tenant's channel.
- The tenant ends it early by rotating, which kills every grant derived from the old token at once (ADR 0018) — proven live on 2026-09-23, when a rotation turned a served hostname into `bad_grant` without the gateway being told anything.

## Why not the alternatives, yet

- **The tenant pins the key itself.** Strongest, and rejected for now because somebody has to type a key. A person typing a 65-byte public key into a config file is a worse failure mode than a certificate, and the console's own profile test forbids hex blobs in a profile for that reason.
- **A gateway publishes a signed record.** This is the right answer eventually, and it does **not** conflict with ADR 0017: a signed document stating a gateway's key would not *choose* the gateway, and a packet would still do that. It is deferred rather than rejected.

## When to revisit

Before a tenant hands a workload to a gateway that a stranger operates. On devnet every name in play is controlled by the same party as the gateway itself, so a signature would vouch for nothing that the certificate does not. On a network with third-party gateways that stops being true, and a signed key is worth more than a certificate — the same argument ADR 0024 defers for a relay.

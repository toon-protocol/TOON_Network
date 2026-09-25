# A hidden provider hides ingress, egress and its settlement RPC, or it is not hidden

A provider may declare itself a Hidden Provider only if all of the following hold:
- its connector is reachable only at an `.anyone` address;
- every lease's ports and SSH are reachable only at an `.anyone` address;
- all outbound traffic from workloads leaves through `anon`;
- it publishes no hostname or IP;
- its settlement RPC is self-hosted, or reached only through its `anon` proxy.

The declaration is a self-assertion; nobody outside can verify it.

A hidden connector alone looks sufficient, and anytoon runs that way. But tenants may run any image (ADR 0004), and a tenant's code can simply look up its own public IP. Without the other conditions a "hidden" provider is a clearnet provider with an onion front door. Anytoon's own analysis also shows an unproxied settlement RPC links the operator's network location to its on-chain identity.

**Amended 2026-09-25 ([#167](https://github.com/toon-protocol/TOON_Network/issues/167)).** This ADR used to require a hidden provider to *run its own* settlement RPC, full stop, because self-hosting was the only way known to keep an unproxied read from linking the operator's address to its on-chain identity. It made hidden settlement mean self-hosting a Solana devnet RPC node — hundreds of GB of RAM, several TB of NVMe — which put "hidden" out of reach for the operators it was written for. [ADR 0030](0030-a-hidden-providers-settlement-rpc-may-ride-its-anon-proxy.md) allows the alternative stated in the bullet above, on the evidence in connector ADR 0073: a public RPC reached only through the provider's proxy, on a pinned circuit per chain, covering every process that dials it, failing closed. It also states plainly that self-hosting is not automatically the stronger choice, because a self-hosted node's own p2p traffic is itself an identifying signal that this spec does not require to be proxied. See ADR 0030 for the full rule, the privacy analysis and why that gap is left open rather than closed by fiat.

## Consequences

- Payments still reveal who paid whom on a public chain. Hiding the provider hides where it is, not that it was paid.
- Hidden providers are slower for bandwidth-heavy workloads, because all their traffic crosses `anon` circuits.

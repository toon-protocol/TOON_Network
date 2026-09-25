# A Hidden Provider's settlement RPC may ride its anon proxy

**Status:** Accepted, 2026-09-25. Decided by [#167](https://github.com/toon-protocol/TOON_Network/issues/167), on the evidence gathered and the decision proposed in connector [ADR 0073](https://github.com/toon-protocol/connector/pull/1330) (`docs/adr/0073-settlement-rpc-may-ride-the-circuit-once-every-wait-on-it-is-bounded.md`). Amends [ADR 0008](0008-a-hidden-provider-hides-ingress-egress-and-settlement.md)'s fifth condition and spec §10. Nothing else in ADR 0008 changes.

ADR 0008 required a Hidden Provider to "run its own settlement RPC," because an unproxied read of a public RPC links the operator's network location to its on-chain identity. That made hidden settlement mean self-hosting a Solana devnet RPC node — by the chain's own published requirements, roughly 256 GB+ RAM and several TB of NVMe — and a Base Sepolia node, on a private network. No first-time operator will do that, so "hidden" was unavailable to the operators it was written for, even though it is the headline of the operator pitch (found by #159, provider#26).

**The fifth condition is replaced.** A Hidden Provider's settlement RPC MUST be **either**:

- self-hosted, on a loopback or private address, as ADR 0008 already required; **or**
- a public endpoint reached only through the provider's `anon` proxy, on one pinned circuit per chain, with no direct fallback.

Either way, the route MUST cover **every process on the box that dials that RPC** — one process left dialling direct is the whole leak. Today that is the connector's settlement backends, its EVM channel-index syncer and its EVM rate source, under `rpc_via_socks_proxy` (connector ADR 0073); it also includes the directory publisher, which reads the same RPC to price and time its writes, under the client's hidden-payer mode that `toon-client` is building. A configured proxy that is unreachable is a fatal error on that process's settlement path, never a silent fallback to a direct dial.

## What this hides, stated honestly

Connector ADR 0073's Evidence 3 carries over unchanged. Payments are public on chain either way: every deposit, claim and settlement already names the provider's on-chain addresses, and every counterparty already knows them. Proxying the RPC changes **who learns the operator's network address alongside those addresses** — not the identity, and not the payments.

- The **RPC provider** still sees every query and every transaction, all of it naming the same keys, but sees an exit relay's address in place of the operator's. It can profile the operator's settlement activity; it cannot locate the operator.
- The operator's **ISP or LAN** sees a connection to the anon network's guard, not to the RPC's hostname.
- Splitting calls across more circuits buys nothing extra here: connector ADR 0073 measured and rejected a circuit per call, because the RPC provider still links every call by the keys it names, at real cost in latency and tail failures. One pinned circuit per chain is the rule.
- An **API-keyed** RPC endpoint is not fixed by this at all: a key ties every query to the account that holds it, by email and payment method, proxy or no proxy. A Hidden Provider that proxies its RPC still needs a keyless endpoint, or it has not hidden anything.

## Self-hosting is not automatically the stronger choice

ADR 0008 read as if self-hosting were simply the safe option and an unproxied public RPC the unsafe one. Connector ADR 0073's Evidence 3 shows that is only true for reads. A self-hosted node's own network traffic — its chain's p2p gossip, which publishes the node's contact information, and the first p2p hop of every transaction it submits — is itself an identifying signal, unless that traffic is also proxied or otherwise unlinkable. Nothing in this protocol proxies a self-hosted node's own p2p traffic today.

**This ADR takes no normative position on that gap**, and states why rather than leaving it silent: a self-hosted settlement RPC continues to satisfy the fifth condition exactly as ADR 0008 left it, because a node's own chain-sync and gossip traffic is outside the settlement-RPC seam this section governs, and proxying an entire chain node's egress is a different and materially larger problem than proxying RPC calls — one nobody has measured the cost of. Requiring it without evidence would repeat the mistake this amendment exists to fix: a rule stated ahead of measurement that makes the feature it gates impractical. An operator who self-hosts and wants the same protection at the p2p layer must proxy that node's traffic themselves; the spec neither requires nor forbids it, and says only that it is not covered here.

## Considered options

- **Reject, keep self-hosting as the only option.** This is the status quo ADR 0008 set, and it stays available as the stronger option for reads. Rejected as the *only* option because it makes hidden settlement unavailable to any operator who cannot run a Solana validator-class RPC node (#167), and because self-hosting leaks the operator's address at the p2p layer instead (above).
- **Require proxying for a self-hosted node's own traffic too.** Rejected for now, and not silently: nobody has gathered evidence for what proxying a full chain node's sync and gossip traffic costs, and requiring it anyway is exactly the unevidenced-rule failure this amendment corrects.
- **Allow the proxy option without the connector's hardening.** Rejected. Connector ADR 0073 recommends allowing proxied settlement only together with bounded timeouts, a confirm loop that survives a failed poll, nonces read from `pending`, and a boot that reads before it transacts. This ADR carries that condition rather than restating its detail; the connector repository owns the mechanism.

## Consequences

- Spec §10's fifth Hidden Provider condition is reworded to match (below); §10's other four conditions, and ADR 0008 itself, are unchanged.
- The reference provider's startup gate (`settlement_rpc_verdict`) accepts a proxied public RPC in addition to loopback/private once the connector ships `rpc_via_socks_proxy` and its required hardening (connector ADR 0073) — tracked in the provider repository, not here.
- The directory publisher's own settlement-RPC traffic must go through the same proxy in hidden-payer mode once `toon-client` provides it. Leaving it direct while the connector is proxied would just move the leak to the other process that dials the same RPC.
- A self-hosted node's own chain-sync and gossip traffic stays outside this spec's settlement-RPC rule, stated as a known gap rather than glossed over; revisiting it needs its own evidence, the way this amendment needed connector ADR 0073's.

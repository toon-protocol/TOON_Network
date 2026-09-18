# A lease's authority comes from the request, never from payment headers

A tenant reaches a provider's connector either directly or through any number of hops. A provider must work identically either way, so it never reads `X-TOON-Payer` or `X-TOON-Amount`. The connector sets those headers only when it collected the payment itself; a packet that arrived through a hop carries neither (connector ADR 0040).

- **Paid:** a provider treats a request that arrives on a paid route as paid at that route's price.
- **Spawn:** carries a Lease Request presenting a Continuation Token, which binds the lease to whoever holds that token.
- **Status and termination:** require that same token.
- **Extension:** accepted from anyone, for any lease, because it only adds time and reveals nothing.

**Amended 2026-09-18 (Milestone 6, [#57](https://github.com/toon-protocol/TOON_Network/issues/57)).** This ADR used to say *tenant identity comes only from a Lease Request signature*. There is no tenant identity any more: a Lease Request is signed by nobody, and what binds a lease is a **Continuation Token**, which names nobody (ADR 0016). The rule the title carries is unchanged and is what mattered — authority comes from the request body, never from who paid — and everything below stands. It becomes more load-bearing, not less: with the tenant absent from the relays entirely, the separation of payer from tenant is now the whole of what a third party cannot cross.

## Consequences

- Payer and tenant are never linked by the provider, so a sponsor can pay for someone else's lease. The provider does not learn who the tenant *is* at all (ADR 0016), so a chain observer sees a payer and nothing else.
- A provider profile must publish its connector's URL, so a tenant paying through hops can seal requests to it.
- Joining the marketplace as a provider needs no hub operator's approval.

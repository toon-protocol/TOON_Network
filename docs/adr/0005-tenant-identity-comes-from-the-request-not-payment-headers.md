# Tenant identity comes from a signed request, never from payment headers

A tenant reaches a provider's connector either directly or through any number of hops. A provider must work identically either way, so it never reads `X-TOON-Payer` or `X-TOON-Amount`. The connector sets those headers only when it collected the payment itself; a packet that arrived through a hop carries neither (connector ADR 0040).

- **Paid:** a provider treats a request that arrives on a paid route as paid at that route's price.
- **Spawn:** carries an event signed by the tenant, which binds the lease to that tenant.
- **Status and access details:** require the tenant's signature.
- **Extension:** accepted from anyone, for any lease, because it only adds time and reveals nothing.

## Consequences

- Payer and tenant are never linked by the provider, so a sponsor can pay for someone else's lease.
- A provider profile must publish its connector's URL, so a tenant paying through hops can seal requests to it.
- Joining the marketplace as a provider needs no hub operator's approval.

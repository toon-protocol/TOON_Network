# A price change is a new listing version, and running leases keep their price

A provider's routes are per listing version: `<addr>.<listing>.spawn` and `.extend` at the listing price, and `.standby` and `.standby.extend` at the standby price. Status, availability and terminate are free provider-wide routes. A provider chooses its own ILP address and publishes it in its profile.

A connector route has one fixed price, so a price change on the same route would reprice every running lease at its next extension. That would let a provider raise the price on a tenant who is locked in by running state. Instead, changing a listing's price publishes a new listing version with new routes. The old version's routes stay until its last lease ends.

## Consequences

- Every listing change is a connector config change and restart, because the connector has no runtime write for a terminated route. A runtime route-write endpoint would remove that.
- A provider carries routes for retired listing versions until their leases end.

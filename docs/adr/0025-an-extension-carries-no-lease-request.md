# An extension carries no Lease Request, and the shape is the authorisation

**Status:** Accepted, 2026-09-23. Decided by [#115](https://github.com/toon-protocol/TOON_Network/issues/115), after a tenant verifying [#86](https://github.com/toon-protocol/TOON_Network/issues/86) on the live devnet wrapped an extension the way its neighbours are wrapped, was refused `invalid_request`, and was billed a full Lease Interval for the refusal: a lease that should have cost 2000 µUSDC cost 3000. The rule is spec §5 and §6.3; it amends nothing in [ADR 0005](0005-tenant-identity-comes-from-the-request-not-payment-headers.md) and makes its extension clause visible on the wire.

**`.extend` and `.standby.extend` take a bare `{ "workload_id": "…" }`. The five routes that act on a lease under the tenant's authority take the §6.1 Lease Request envelope, `{ "request": … }`. The asymmetry stays, because the envelope is the Continuation Token's carriage and an extension presents no token.**

## The mistake this decision does not fix

An extension wrapped as `{ "request": { … } }` is an unknown field, refused `invalid_request`. The connector collected the route's price before the provider app read a byte of the body (ADR 0003, ADR 0005), so the refusal is billed and nothing is refunded. Making `extend` accept the sibling envelope would remove that particular mistake and would remove it in the one place where it is *cheapest to make and most expensive to pay for*, so the case for doing it is real. It is refused anyway, for four reasons, and the mistake is instead made unreachable in the tooling that builds the body (§5, and #115's client, sandbox and console changes).

## Why the envelope does not fit an extension

- **It is a carriage for a secret that is not presented here.** §6.1 says what a Lease Request is: the thing that binds a lease to the party that bought it, carrying one fact about that party, its Continuation Token. An extension binds nothing. ADR 0005 has said since Milestone 1 that an extension is *accepted from anyone, for any lease, because it only adds time and reveals nothing*.
- **Either branch of carrying it is wrong.** Put the lease's token in an extension and the tenant hands a secret to a route that will never compare it — widening the exposure of the one value §6.1.1 says a provider MUST NOT let reach a log, a metric or an error message, on the one route a stranger is invited to call. Leave it out and §6.1 has already defined what that is: *a request asserting no authority over the lease — refused, never read as an unauthenticated success*. The envelope's own rules refuse the only honest way to fill it in.
- **It would make a stranger's request stateful.** §6.1.2 steps 2 and 3 are not optional parts of the envelope: a provider MUST hold every accepted `request_id` until its `expiration` and refuse repeats. Today that set is bounded by requests bearing a token. Putting the envelope on the two routes any payer may call would have a provider retain replay state on behalf of anyone who can pay one interval, which is memory a stranger writes.
- **It would cost sponsorship.** ADR 0005's consequence is that *a sponsor can pay for someone else's lease*. A sponsor holds no token. The envelope would leave the tenant either unable to be sponsored or handing over a token that also buys `terminate` and `rotate` — trading a billing footgun for a capability leak.

So the shape is not an accident of who wrote which route first. **The shape is the authorisation statement:** an envelope means *I am the party that took this lease*, and a bare body means *I am paying, and paying is all the authority this route needs*. Two shapes for two kinds of authority is one fact fewer to get wrong than one shape whose token field is sometimes load-bearing and sometimes ignored.

## Wire compatibility, which decides it on its own

The reference provider (`toon-protocol/provider`) deserialises the extension body into a struct that refuses unknown fields, and the devnet provider is running it. There is no version negotiation for a route's body shape: a Listing version prices resources (§4.2, ADR 0009) and says nothing about wire shapes, so widening `extend` is a flag day across every deployed provider, with old providers refusing the new body — **at full price** — for as long as one is unupgraded. A change whose whole purpose is to stop tenants paying for refusals would begin by making tenants pay for refusals.

## Considered Options

- **Accept both shapes on `extend`, ignoring `request`'s contents.** Rejected. A field that is parsed and not acted on is exactly what §6.2 already has to apologise for with `template`, and here it would be a field tenants fill with a secret. It also breaks ADR 0004's rule that an unnamed field is refused rather than dropped.
- **Accept both, and honour the token when present.** Rejected harder. It gives one route two authorisation models and invites a tenant to believe an extension is authenticated, which it is not and must not become: ADR 0005's openness is what lets a sponsor pay.
- **Move the whole protocol to one envelope, `availability` included.** Rejected. Same flag day, wider, and it would put a `continuation` field on a route that names no lease.
- **Keep the asymmetry, state it in §5 where every body is now listed together, and make the malformed body unsendable in the tooling.** Chosen.

## Consequences

- **§5 lists every route's request body in one table**, and says that a wrong shape is `invalid_request` at the route's full price with no refund. A reader no longer has to assemble that from five sections.
- **Tooling owns the guard.** `@toon-protocol/client`, `infra/sandbox`'s scripts and the console daemon each check an extension's body before a packet leaves, so a malformed one costs nothing. A test sends the wrong shape and asserts that no payment left the channel.
- **The provider is unchanged**, and so is every deployed connector's configuration. Nothing needs a flag day, and the fixtures keep their shapes.
- **The gotcha is written down** where someone driving the routes by hand meets it (`infra/docs/devnet.md`, `infra/sandbox/README.md`), because the tooling's guard does not protect a `curl`.
- **If a future route ever does need both a payment and a token**, it takes the envelope and is an authenticated route with all four of §6.1.2's steps. This decision fixes the meaning of the two shapes; it does not close the set of routes.

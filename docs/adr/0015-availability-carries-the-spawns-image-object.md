# Availability carries the spawn's image object

**Status:** Accepted, 2026-09-16. Settles the last open disagreement between the spec draft and the provider that toon-protocol/TOON_Network#16's fixtures recorded.

The free `<addr>.availability` route (§6.4) takes `{ "listing", "version", "image" }`, where `image` is exactly the object a spawn's content carries (§6.2: upstream reference plus digest, registry entry plus digest, or digest alone), and it applies the same parse and the same image policy a paid spawn would. The draft had `{ "listing", "version", "image_digest", "role"? }`.

A digest names bytes, not a way to get them. Whether an image would run on a provider depends on where the provider is told to look: an upstream reference is pulled as `reference@digest` and touches no Image Registry; a registry entry names a source per blob; a bare digest is resolved through Blob Records on the Relay Set. Two spawns with the same digest and different forms can get different answers (§8.4), so an availability check over the digest alone could say "yes" to an image the spawn would then be refused — and billed for (ADR 0003). The point of the free route is to catch `refused_image` before a tenant pays, which it can only do with the object the spawn will send.

`role` is dropped rather than kept as an optional field. In Milestone 1 and 2 nothing sells a standby, and an unknown field is `invalid_request` everywhere else (ADR 0004), so accepting `role` here would be the one place a tenant can send a field that means nothing. When Warm Standby lands (Milestone 3, #11) it decides what an availability check for a standby looks like, and that may not be a `role` field at all.

## Considered Options

- **Keep the draft's `image_digest` and `role`.** Rejected: it cannot answer the question the route exists to answer for two of the three image forms, and it makes a tenant write the image twice, in two shapes.
- **Accept both shapes.** Rejected: two request shapes for one route is a permanent cost for every implementation, to spare the provider a change it had already made.
- **The full image object, no `role`.** Chosen. The provider already implemented and tested it; the spec is corrected to state it.

## Consequences

- §6.4 states the body normatively and names this ADR.
- A tenant's availability call is the spawn's `image` object verbatim, so one serialiser serves both, and the `availability.*.json` fixtures carry it.
- Milestone 3 (#11) owns the standby question: whether availability grows a field, or a standby check is a separate route, is decided there.

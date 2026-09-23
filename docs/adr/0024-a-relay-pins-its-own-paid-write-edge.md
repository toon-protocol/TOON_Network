# A relay pins its own paid write edge, the way a Provider Profile pins a provider's

**Status:** Accepted, 2026-09-23. Decided and implemented by [#121](https://github.com/toon-protocol/TOON_Network/issues/121), found on the live devnet: `GET https://relay-ws.devnet.toonprotocol.dev/` with `Accept: application/nostr+json` answered `Upgrade Required`, and a write refused on the websocket said `restricted: writes require ILP payment` and named nobody. The rule is spec §13; the relay carries it in `packages/relay/src/nips/relay-information.ts` and `packages/relay/src/launcher/connector-edge.ts`. The glossary terms are **Write Edge** and **Relay Information Document**. Follows ADR 0011 (a Profile pins its connector's sealing key) and ADR 0007 (a relay write is a paid packet); touches ADR 0023 (a gateway reaches a member the way its Profile says).

A TOON relay **names its own paid write edge in its own relay information document, at its own URL**: `ilp_address`, `connector_url` and `connector_seal_key` — the same three fields a Provider Profile publishes (§4.1) and spelled the same way — plus the carriage its write route pins and what a write costs. A party holding nothing but a relay's URL can buy a write to it, and needs nothing else and nobody else.

## What went wrong, because it is the argument

Every party that writes to a TOON relay had been told where to pay out of band, and each had been told differently.

The provider's publisher carries a `RELAY_WRITE_ROUTES` environment variable: a hand-written map from a relay's read URL to the ILP address that buys a write to it. The console reads its destination out of **its own** connector's `GET /ilp`, which works only because the profile's connector happens to terminate the relay's route — it is the right answer by coincidence, and the coincidence is one deployment wide. Neither can pay a relay it merely knows the URL of.

That is not a tidiness problem, and the cost of it is already visible. An Account's NIP-65 list names the relays it writes to, and the console can only write to the one relay its own connector can reach; the Account's other relays get nothing. Its Chain Seed and its Lease Vault therefore live in one place, and "recoverable anywhere" (ADR 0021) rests on that one relay keeping them — which is precisely the arrangement the vault exists to avoid.

Meanwhile a relay was already answering for itself about everything else. It serves reads to anybody at its URL and it refuses writes at that same URL. The one thing it would not say is the one thing the refusal was about.

## Why the same three fields, and not something new

Because they are the same fact, and the network already knows how to read it. A Profile's `connector_url`, `ilp_address` and `connector_seal_key` say "seal this to that key, address it there, and post it there" (§12.4, ADR 0023). A relay's write is the same shape of thing: a sealed packet to an address at a connector. Naming those three the same way means one parser reads a relay's edge and a provider's, and a client that already knows how to pay a Provider already knows how to pay a relay.

The carriage is the fourth field and it is not from ADR 0011, because carriage was not a question when ADR 0011 was written. It is one now: the devnet relay pins `g.toon.relay` to BTP and a client that dials HTTP is refused `TRANSPORT_REQUIRED` with no way to have known. A relay that names where to pay and leaves out how to get there has not finished the sentence.

## A relay's pin is not worth what a Profile's pin is, and says so

A Provider Profile is a Nostr event signed by the provider's key, so the sealing key inside it cannot be forged even by whoever controls the URL beside it — that asymmetry is the whole of ADR 0011. **A relay's information document has no signature at all.** It is an HTTP response from the relay's own URL, and it is worth exactly what that URL is worth.

That is honest, and it is enough, for two reasons. A client reading the document is already trusting that URL: it is the URL it reads its own records from, and a relay that would lie about its edge could as easily lie about the events it serves. And the alternative being replaced is not a signature — it is an environment variable a human typed, trusting the same URL plus their own memory. Nobody is worse off, and a party that was configured by hand now is not.

What this rules out is a **client** treating a relay's pin as it treats a provider's. A tenant seals a Spawn to a provider's pinned key and refuses the connector's own self-description when the two disagree, because the Profile is the stronger statement. Against a relay the two statements are equally strong, so a client that checks them is checking for a misconfiguration, not for an attack, and §13.2 says only that it MUST refuse when they disagree — not that either one wins.

A signed relay edge is a real option and it is deferred, not rejected: a relay has a Nostr key already, and a replaceable event it signs would make its edge as unforgeable as a Profile's. Nobody needs that yet, and adding a kind for it would put the edge somewhere a client holding only a URL cannot look.

## The document is derived, so it cannot drift

A relay speaks no ILP, holds no price and enforces no payment — that is the whole design of the relay repository, and it is why the edge is **read** rather than configured. The relay asks its connector's own `GET /ilp` (connector ADR 0050), narrows the answer to the one route that terminates at its write surface, and republishes what it found. It restates a price, a key and a carriage it did not decide and cannot edit, and when its connector says nothing it says nothing.

The one fact it cannot read is which of its connector's routes arrives at its own write surface: a self-description publishes routes' prefixes and prices and never their handler, deliberately, because a handler is the app's fact and not the network's. So the relay is told exactly one thing, and refuses to advertise an address its connector does not say it terminates.

## Considered Options

- **Put the edge in the relay's own configuration.** Rejected, and it is what every other party did. It is a second copy of the connector's price, key and carriage, and a second copy drifts: the failure mode is a relay advertising a price nobody charges or a key nobody holds, discovered by a client whose money has already gone.
- **Lean on the connector's `GET /ilp` alone and publish nothing on the relay.** Rejected, and it was the tempting one, because the document is a restatement of exactly that. But a client holds the relay's **read** URL — that is what a NIP-65 list carries — and nothing in a read URL says which connector terminates writes to it or which of that connector's several prefixes does. The devnet relay's connector terminates four, one of which belongs to the store. The document is the missing hop, and it is one request to a URL the client already has.
- **Publish the relay's edge as a signed Nostr event.** Deferred, not rejected. See above: it would make the pin as strong as a Profile's, and it would put it somewhere a client holding only a URL cannot look. A relay that wants both can do both later.
- **Invent top-level NIP-11 keys rather than one `toon` object.** Rejected. NIP-11 has grown top-level keys over time — `limitation`, `fees`, `retention` — so a bare `carriage` or `settlement` is a name a later NIP may take for something else. One namespaced object is also one presence check for "can I pay this relay", rather than four that can half-succeed.
- **Say nothing in NIP-11's own vocabulary and put everything in `toon`.** Rejected. `limitation.payment_required` and `fees.publication` are what a Nostr client that has never heard of this network reads, and a relay that left them empty while charging for writes would be lying to that client in its own language.

## Consequences

- **A relay that cannot check its address advertises nothing.** It serves the document with no `toon` object rather than one it could not verify, and says so in its refusal. Silence is the honest answer and a client can act on it; a plausible wrong address is neither.
- **An absent `carriage` is a statement, not a gap.** It means the route pins none that the relay could learn of, so a client dials what it likes and honours a transport refusal. Until [#111](https://github.com/toon-protocol/TOON_Network/issues/111) lands, a connector does not publish the pin it enforces, so a relay's carriage comes from its operator — and only where the connector is silent, so the stopgap can never contradict the thing doing the enforcing. When #111 lands the operator's value goes and nothing else changes.
- **A free relay still refuses a websocket write.** The restriction is the lane, not the price: `limitation.restricted_writes` is true on every TOON relay and `payment_required` is false on a free one. A relay that conflated the two would send a client looking for a payment channel it does not need.
- **The refusal and the document are one statement.** A relay renders both from one value, so it cannot refuse a write towards one address while advertising another. The refusal carries the address, the connector and the price but never the sealing key: a key is too long for a message a client logs a line at a time.
- **`RELAY_WRITE_ROUTES` becomes a fallback rather than the way.** The provider's publisher can read a relay's document instead of being handed a map, and a party that writes to a relay it was never configured for can now do so. Retiring the variable is not this decision's to make.
- **A relay's URL now answers two questions.** A `GET` asking for `application/nostr+json` gets the document; everything else answers as it did before, so no existing client's behaviour changes and the websocket handshake is untouched.

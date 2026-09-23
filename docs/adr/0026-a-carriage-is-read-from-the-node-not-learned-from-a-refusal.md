# A carriage is read from the node, not learned from a refusal

**Status:** Accepted, 2026-09-23. Decided and implemented by [#111](https://github.com/toon-protocol/TOON_Network/issues/111), after a healthy provider was absent from the Provider Directory for hours on 2026-09-22. The rule is spec §4; it is carried by connector [ADR 0072](https://github.com/toon-protocol/connector/blob/main/docs/adr/0072-a-carriage-pin-is-published-on-the-route-that-enforces-it.md), which publishes a route's pin on that route's own `GET /ilp` entry, and by `@toon-protocol/client`, whose `auto` reads it there. The reference provider's publisher is `tools/publisher/`; its deploy bundle still names `btp` outright, and `tests/deploy_bundle.rs` says what has to become true of the relay box before that goes back to `auto`.

**A relay's connector MAY require that a paid directory write arrive over one carriage, and where it does it MUST say so in the self-description a publisher already reads. A publisher MUST read the requirement and use the carriage it names. Neither party may treat the refusal as the discovery mechanism.**

A Provider Profile, a Listing and Liveness are paid ILP packets to the relay's own prefix (§4, ADR 0007). A relay may pin that prefix to BTP — the TOON relay does, because its other traffic is per-audio-frame and a persistent session amortises what an HTTP one-shot pays on every packet. A publisher on the wrong carriage is refused before payment is considered at all, so none of the three events is ever written: the provider is running, serving, and invisible.

## What went wrong, and it was not the refusal

The refusal worked. The relay answered `402` carrying `extra.requiredTransport: "btp"`, the client turned it into `TRANSPORT_REQUIRED`, and the message said what was wrong in words.

What failed is that nothing said it **first**. The publisher's carriage is `auto` precisely so it reads the pin out of the node's self-description and dials it — and the document named none, because the connector published the pin **per node** while enforcing it **per route**. A node-wide answer exists only where every route covering the node's own addresses agrees; the relay answers to `g.toon.relay`, pinned, and `g.toon.relay.ephemeral`, not pinned, so there was no honest node-wide value and the field was correctly omitted. Greeting each destination unpaid shows the split plainly: `g.toon.relay` answers `402` with `extra.requiredTransport: "btp"`, and `.ephemeral`, `.gas` and `.store` answer `402` with no such key.

That shape is not exotic. **A node with a paid apex and a free sub-lane has two policies the moment it pins the paid one**, and the free ephemeral lane §4.3 forbids Liveness on is exactly such a sub-lane. Any relay that pins its paid write route and keeps an unpinned lane beside it reproduces this.

## Considered Options

- **Name the carriage in every deployment's configuration.** This is what was done on the day, and it is what the reference provider's bundle still does. It works and it does not scale: the fact lives on the relay, changes when the relay's operator changes it, and every deployment that has copied it is then wrong in a way that shows up as an empty directory rather than as an error. Configuration that restates someone else's fact is configuration that goes stale silently.
- **Try HTTP, read the refusal, retry over the named carriage.** Rejected. It is one wasted round trip on a good day, and on a bad one it is nothing at all: before the relay box moved to `rust-2026.09.11.1` its connector could not parse the client's wire and answered `OER length determinant wider than 8 bytes`, which names neither the carriage nor the problem. A refusal is also a refusal — a client that retries a refused paid write by reflex is a client that will retry the wrong things.
- **Widen the node-wide field to cover every route.** Rejected. It makes disagreement more likely, so the field falls silent on more nodes than it does today.
- **Publish `both` rather than omitting the field.** Rejected. It puts a key on the wire to say nothing, and still gives one answer for a node with two policies.
- **Publish the pin on the route that enforces it.** Chosen. It is the granularity the refusal is decided at — a connector takes the transport policy off a longest-prefix route lookup, once per packet — so an advertisement derived from that lookup cannot describe anything but what will happen.

## Consequences

- **A publisher's `auto` is the ordinary setting, and naming a carriage is the exception.** A deployment that names one is asserting something about a relay it does not run, so it SHOULD say in place what has to become true before it stops doing so.
- **The refusal stays.** It is the backstop for a client that ignores the advertisement, not the way a well-behaved one finds out. Removing it would let a wrong-carriage write reach payment.
- **A relay operator who pins a route publishes the pin by running a connector that does.** Nothing is added to a provider's configuration and nothing to the directory's events: this is the connector's self-description, which a publisher already fetches once at bootstrap, and the whole of the change is that the answer is now there.
- **A node that pins nothing is untouched**, and so is a client reading one. The field is omitted rather than emitted, so such a node's document is byte-for-byte what it was.
- **The fleet is not fixed by this record.** A connector build reaching a devnet box is a release and a pin bump, and until the relay box carries one its document still names no pin. A deployment against it names `btp` by hand in the meantime, with the one request that says when to stop: `curl -s <relay>/ilp | jq '.routes[] | select(.prefix == "g.toon.relay")'`.

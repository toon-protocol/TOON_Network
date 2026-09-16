# Reusable CI actions are not TOON Network's concern

**Status:** Accepted, 2026-09-16. Answers [issue #17](https://github.com/toon-protocol/TOON_Network/issues/17) with option 3; `rig` builds against it.

A reusable CI action — the TOON-native equivalent of `uses: actions/checkout@v4`, a published name that resolves to a NIP-34 repo coordinate plus a commit — is not a TOON Network concept. TOON Network's marketplace stays compute-only: the Provider Directory, plus Templates. `rig` owns the action record, allocates its kind outside the `toon.network` label, and TOON Network's spec says so in one line at §8.3.

A Template describes a **spawn**: an image by content address, its ports, and the settings a tenant may fill in. An action describes a step that runs *inside* a workload that already exists, and names no image, no lease, no listing and no provider. Giving Template a second shape (option 1) would leave it with no definition except "a publisher-signed addressable pointer to something", would break the one-sentence glossary entry, and would put a union type in front of every tenant that expands a Template. That is a category error, and the small saving — one kind instead of two — does not pay for it.

Owning a separate Action kind (option 2) is not a category error, but TOON Network gains nothing by it. The comparison with the tenant-side **Deployment** record reserved in #13 is the useful test, and it cuts the other way: Deployment is tenant-only, but every field in it is a TOON Network concept (provider, workload id, listing, image digest), so it belongs in the one `["L","toon.network"]` namespace and a directory reader can make sense of it. An action record contains a git coordinate and a commit — nothing a Provider Directory query would ever want, and nothing a provider ever reads. "Tenant-only" is not what makes Deployment ours; "made of our concepts" is.

The fragmentation argument is also weaker than it looks. Compute leases and reusable actions are already two marketplaces: different publishers, different readers, no payment on one side, no capability on either. Putting both in one kind block merges the numbering, not the market. A reusable action is a general Nostr-CI concept that belongs next to NIP-34 and NIP-C1 — which `rig` already publishes on the same relays — not inside a compute vendor's namespace, where TOON Network would inherit action naming and squatting policy it cannot enforce and does not benefit from.

Finally, the spec's own scope line ("everything a provider must publish, accept and do; tenant tooling is out of scope for v1") already excludes it, and the cost of an exception is real: a glossary term, a wire schema, conformance fixtures (#16), and a standing obligation to re-spec whenever `rig`'s CI design moves — on a record no provider will ever parse.

## Considered Options

- **Template grows a second shape (spawn or action).** Rejected as a category error: see above. It also collides with ADR 0004's framing, where a Template is a spawn convenience that grants nothing.
- **A separate Action kind inside the `toon.network` block.** Rejected: TOON Network would own a record built entirely from concepts it does not define, for readers it does not serve. Reconsider only if an action record starts naming a provider, listing or lease.
- **No record at all: `uses:` resolves straight to a NIP-34 `naddr` plus a commit.** Not ours to decide, but worth flagging to `rig`: the registry event may be unnecessary, which is another reason not to spend a TOON Network kind on it now.

## Consequences

- `CONTEXT.md` is unchanged: **Template** keeps its definition, and no **Action** term enters the glossary.
- `rig` allocates its own kind outside the TOON Network blocks. §3.1 documents the reserved blocks themselves, not only the allocated numbers (ADR 0012), so `rig` can allocate clear of them and of any future TOON Network kind.
- If `rig` later needs an action to reference a listing, a capability or a lease, that is the trigger to reopen this and take option 2.

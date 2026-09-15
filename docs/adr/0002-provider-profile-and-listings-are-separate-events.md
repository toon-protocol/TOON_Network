# A provider profile and its listings are separate relay events

Paygress publishes one offer event per provider, with every tier inside its JSON content. We split that into one **Provider Profile** event per provider (identity, how it is reached and paid, isolation, capabilities) and one **Listing** event per tier (resources and price).

Two properties of the TOON relay drive this:
- Every write is paid, so changing one tier's price should cost one write, not a rewrite of the whole offer.
- NIP-01 filters match only single-letter tags, never fields inside content. Listings therefore carry searchable attributes as tags, so the relay can do the search instead of every tenant downloading every offer.

## Consequences

- A tenant needs two lookups to act on a listing: the listing, then its provider's profile.
- A listing must name its provider profile, and a listing whose profile is missing is not purchasable.

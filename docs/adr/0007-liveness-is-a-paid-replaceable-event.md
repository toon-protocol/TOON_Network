# Liveness is a paid replaceable event, not the free ephemeral lane

A provider publishes liveness as a paid replaceable event (one per provider; each replaces the last) with a NIP-40 expiration of about five times its publishing cadence. It publishes to every relay in its relay set.

The TOON relay has a free ephemeral lane, which looks like the obvious home for liveness. We rejected it because its rate limit, 200 requests per 10 seconds, is keyed by remote address. Behind a connector every request shares one address, so the limit is shared by the whole lane. That caps fleet size, and it would fail exactly the warm-standby takeover that depends on liveness.

A paid replaceable event can be both queried (the Provider Directory) and subscribed to (warm standbys), and relay storage stays at one event per provider. On the devnet relay a 60-second cadence costs about $0.0014 a day.

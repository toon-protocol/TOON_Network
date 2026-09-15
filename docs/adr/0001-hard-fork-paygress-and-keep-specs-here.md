# Hard-fork Paygress for the provider; keep the specs in this repo

The provider is a hard fork of [Paygress](https://github.com/DhananjayPurohit/Paygress) (Apache-2.0, Rust) under a new name, in its own repository. This repository holds the protocol specs, the glossary and the ADRs, the way `toon-meta` sits apart from `connector`.

We take Paygress's compute backends, lease accounting, expiry cleanup and failover state machine. We replace its payments (Cashu, `ngx_l402`, Lightning), request transport (NIP-17 DMs), discovery (its offer and heartbeat kinds) and storage (Blossom) with TOON-native equivalents.

## Considered Options

- **Contribute a TOON payment backend upstream.** Rejected: once transport, payment, discovery and storage are all replaced, upstream shares only the backends and the lease state machine with us, and tracking its Cashu and Lightning roadmap costs more than that is worth.
- **Write a new provider and use Paygress as reference only.** Rejected: its backends, cleanup and warm-standby logic are working, tested code we would otherwise rewrite.

## Consequences

- The fork keeps Paygress's LICENSE and NOTICE attribution.
- It does not interoperate with Paygress clients or providers.

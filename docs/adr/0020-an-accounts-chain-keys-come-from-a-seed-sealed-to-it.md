# An account's chain keys come from a seed sealed to it

**Status:** Proposed, 2026-09-22. Decided in the console design session; the glossary terms are **Account**, **Signer** and **Chain Seed**.

An account's payer keys on every settlement chain come from **one BIP-39 Chain Seed**. The seed is random and is **NIP-44-sealed to the account's own Nostr key**. It is kept on the account's relays with a local cache, so the keys can be recovered anywhere the account can sign. They are derived with `toon-client`'s existing paths: EVM at `m/44'/60'/0'/0/i` and Solana at `m/44'/501'/i'/0'`. "The same wallet" therefore means that the account's Nostr key unlocks its chain keys, not that the chain keys are computed from it.

The most Nostr-native place for a key is a **signer**: a NIP-46 remote signer (Amber, nsec.app, `nak bunker`) or the console's local keystore in gnome-keyring. A remote signer never reveals the private key. Its BIP-340 signatures and NIP-44 ciphertexts are randomized, so no deterministic seed can be squeezed out of it. Deriving the chain keys from the Nostr key would therefore shut out exactly the accounts that follow Nostr's own custody advice. Sealing a random seed to the key works with every signer, and it follows the pattern NIP-60 uses for a Cashu wallet's key.

## Considered Options

- **Derive the chain keys from the Nostr key (NIP-06 mnemonic or nsec).** Rejected as the rule. It works only when the account pastes key material into the console. A NIP-06 mnemonic can still be *imported* as the chain seed, if an account wants its chain keys to match another wallet's.
- **A chain seed kept only on the local machine.** Rejected. Losing the machine would lose the funds in every channel, and the account could not sign in anywhere else.

## Consequences

- The Nostr key and the payer keys stay unlinked on chain. This keeps spec §3's separation of Payer and Tenant.
- Anyone who holds the account's Nostr key holds its funds. The console says so when an account first seals a seed.
- A relay learns that the account has one sealed seed record, but not what it contains.

## Two rulings this left open, decided 2026-09-22

- **A Chain Seed is never revealed.** There is no export, no reveal-once-at-mint, and no route that could grow one. Recovery is the Nostr key and nothing else, which is what makes "the npub unlocks the funds" a complete sentence rather than one of two paths. The cost is stated plainly: an Account that loses its Nostr key loses the funds at its payer addresses, and the console says so once, before it ever shows an address to deposit to.
- **More than one seed is surfaced, not merged.** Two machines that both mint while offline leave two sealed records, and NIP-01's replacement rule picks one. The console warns loudly, shows both addresses, and neither merges them nor keeps deriving from the loser. Recovering funds from a superseded seed would mean carrying every seed an Account ever had, forever, to rescue a case a warning prevents.

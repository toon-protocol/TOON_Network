# Image bytes are verified by digest, wherever they are stored

An Image Registry entry resolves a publisher-scoped name and tag (`<npub>/name:tag`) to an image's content address. Each blob of the image names its source: either the TOON store (Arweave data items bought through `g.toon.store`) or an upstream OCI registry. The provider verifies every blob's digest before using it, whatever the source.

Public base layers therefore stay in upstream registries, and the TOON store holds the bytes that exist nowhere else. Putting every layer into TOON-paid storage would be more "TOON native", but it would pay to re-store bytes that are already public. It would also add no integrity, because integrity comes from the digest, not the storage.

A blob stored in the TOON store is split into ordered parts, each small enough for one data item. Its **Blob Record**, one event per blob keyed by the blob's digest, lists the parts. The Blob Record is published to relays for lookup by digest, and the same signed event is stored once in the TOON store for durability. An Image Registry entry lists each blob's digest and the Arweave transaction id of its Blob Record. A part list therefore survives the loss of every relay, and a layer shared by many images is described once.

The fetcher fetches each part from a configurable gateway URL pattern, checks each part's hash and the whole blob's digest, and reassembles it. It uses no Blossom endpoint. Because every blob is verified, a Blob Record from any signer is safe to use: a wrong one fails verification.

## Considered Options

- **Lading as the store.** Deferred: Lading is not yet runnable in the development sandbox. It may become a third source type later.

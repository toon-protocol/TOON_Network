# A provider profile pins its connector's sealing key; the URL is only a hint

A provider profile publishes its connector's sealing public key alongside the connector's URL. A tenant seals requests only to that key, and refuses to proceed if the self-description at the URL reports a different key.

Spawn requests carry environment variables that may hold secrets. The profile is signed by the provider's Nostr key, so the sealing key inside it cannot be forged, while a URL can be spoofed or intercepted. Pinning the key also covers the case where a request reaches the provider through hops and the tenant never contacts the provider's URL at all.

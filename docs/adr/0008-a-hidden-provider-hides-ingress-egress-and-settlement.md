# A hidden provider hides ingress, egress and its settlement RPC, or it is not hidden

A provider may declare itself a Hidden Provider only if all of the following hold:
- its connector is reachable only at an `.anyone` address;
- every lease's ports and SSH are reachable only at an `.anyone` address;
- all outbound traffic from workloads leaves through `anon`;
- it publishes no hostname or IP;
- it runs its own settlement RPC.

The declaration is a self-assertion; nobody outside can verify it.

A hidden connector alone looks sufficient, and anytoon runs that way. But tenants may run any image (ADR 0004), and a tenant's code can simply look up its own public IP. Without the other conditions a "hidden" provider is a clearnet provider with an onion front door. Anytoon's own analysis also shows an unproxied settlement RPC links the operator's network location to its on-chain identity.

## Consequences

- Payments still reveal who paid whom on a public chain. Hiding the provider hides where it is, not that it was paid.
- Hidden providers are slower for bandwidth-heavy workloads, because all their traffic crosses `anon` circuits.

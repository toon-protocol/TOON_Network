# TOON Network

A decentralized compute marketplace built on TOON: providers sell leases on workloads, tenants buy them over TOON payment channels, the TOON relay carries discovery, and the TOON store holds image bytes.

## Language

### Parties

**Provider**:
An operator who sells leases on workloads running on hardware they control.
_Avoid_: Host, seller, node

**Tenant**:
The holder of a lease's continuation token. A tenant has no published identity and signs nothing.
_Avoid_: Consumer, buyer, customer, user, tenant key

**Payer**:
The channel identity a payment was collected from. A payer need not be the tenant.
_Avoid_: Tenant (when the channel identity is meant)

### Leasing

**Workload**:
The thing a provider runs for a tenant under a lease.
_Avoid_: Pod, container, VM, box

**Lease**:
A tenant's prepaid right to one workload on one provider, until it expires.
_Avoid_: Rental, job, subscription

**Root Secret**:
The random value a tenant mints for a lease and keeps, from which every continuation token and gateway grant of that lease is derived. A tenant holds one per lease, mints a fresh one for each rotation, and never sends it.
_Avoid_: Master key, seed, private key, lease key

**Continuation Token**:
The secret a tenant derives from a lease's root secret for one provider and presents on every later request to it, by which that provider knows the same party that took the lease is asking again. One per provider, so no member of a standby set can act as the tenant against another.
_Avoid_: Session token, API key, bearer token, password, tenant secret

**Rotation**:
The act of replacing a lease's continuation token at one provider, after which the old token and every gateway grant derived from it no longer work.
_Avoid_: Revocation, re-key, reset

**Lease Interval**:
The fixed period of a lease that one payment buys, set by the listing.
_Avoid_: Tick, period, billing cycle

**Spawn**:
The paid request that starts a lease and buys its first lease interval.
_Avoid_: Deploy, create, launch

**Extension**:
A paid request that adds one lease interval to an existing lease.
_Avoid_: Top-up, renewal

**Capability**:
A privilege beyond an ordinary workload, such as running Docker inside it, that a listing grants.
_Avoid_: Runtime flag, permission, privilege

**Docker Capability**:
The capability that gives a workload a Docker daemon of its own, at the conventional socket path, scoped to its lease.
_Avoid_: Docker-in-Docker, dind, privileged mode

**Nesting Capability**:
The capability that lets a workload create containers or virtual machines of its own, by a mechanism its own image brings.
_Avoid_: Virtualization, inner container, privileged mode

**Expiry**:
The end of a lease because no payment bought another lease interval.
_Avoid_: Timeout, lapse

**Termination**:
The end of a lease before expiry, requested by its tenant.
_Avoid_: Cancellation, kill, stop

**Eviction**:
The end of a lease before expiry, decided by its provider.
_Avoid_: Cancellation, revocation, kill

**Eviction Notice**:
A provider's signed public record that it evicted a lease, and why.
_Avoid_: Revocation, termination notice

**Warm Standby**:
A provider holding capacity to take over a lease's workload if the provider running it goes silent.
_Avoid_: Replica, backup, failover node

**Reservation**:
The capacity a warm standby holds and is paid for, on which nothing runs until takeover.
_Avoid_: Booking, hold, idle lease

**Standby Set**:
A primary lease and its warm standby leases, which serve one workload across several providers under one tenant-chosen workload id.
_Avoid_: Replica set, cluster, group

**Takeover**:
The moment a warm standby starts running the workload of a lease whose provider went silent.
_Avoid_: Failover, promotion

**Self-stop**:
A primary stopping its own workload because it can no longer publish liveness to a majority of its relay set, leaving the lease paid and nothing running.
_Avoid_: Fencing, self-eviction, shutdown

**Hidden Provider**:
A provider whose network location is not revealed to tenants or observers by anything it publishes or serves.
_Avoid_: Anonymous provider, onion provider

**Workload Gateway**:
A TOON app that fronts a workload at a stable hostname, resolving its workload id to whichever provider is currently running it.
_Avoid_: Gateway (unqualified: the TOON store's gateway is a different thing), ingress, load balancer, reverse proxy

### Directory

**Provider Directory**:
The set of published provider profiles, listings and liveness that tenants search to find a provider.
_Avoid_: Registry, marketplace

**Provider Profile**:
A provider's published statement of who it is and how it is reached and paid, independent of anything it sells.
_Avoid_: Offer, provider ad

**Listing**:
One sellable tier published by a provider: the resources a lease gets, the capabilities it grants, and its prices.
_Avoid_: Offer, spec, pod spec, plan

**Liveness**:
A provider's short-lived published statement that it is up, which expires unless renewed.
_Avoid_: Heartbeat, ping, presence

**Relay Set**:
The relays a provider publishes its profile, listings and liveness to.
_Avoid_: The relay

### Registries

**Image Registry**:
The published mapping from a publisher's image name and tag to an image's content address.
_Avoid_: Docker registry, Blossom

**Blob Record**:
A signed record of how one blob's bytes are split into ordered parts in the TOON store, kept both on relays and in the TOON store itself.
_Avoid_: Manifest, bill of lading, part list

**Template**:
A signed, published description of a spawn: an image by content address, its ports, its fixed settings and the settings a tenant may set. It grants no capability.
_Avoid_: Preset, app

### Tenant records

**Deployment**:
A tenant's signed statement that one environment of one repository is currently served by a lease. Only a tenant signs one, and a provider neither publishes nor reads it.
_Avoid_: Release, rollout, environment record

### Gateway delegation

**Gateway Grant**:
A tenant's delegation of reading one workload's lease state and access details until it expires or the continuation token it is derived from is rotated.
_Avoid_: Token, API key, delegation certificate

**Gateway Handover**:
The message by which a tenant chooses a workload gateway, carrying the workload's gateway grant and what the gateway needs to serve it.
_Avoid_: Registration, enrolment, onboarding, grant publication

**Gateway Withdrawal**:
The message by which a tenant stops a workload gateway serving a workload, which ends its serving but not its grant.
_Avoid_: Revocation, deregistration, cancellation

### Console

**Console**:
The local app through which an account finds providers, funds its payment channels and manages its workloads. The dashboard, landing page and docs are parts of it, or of its public site.
_Avoid_: Frontend, dashboard (for the whole app), client, wallet app

**Account**:
A Nostr identity that holds a person's chain seed and the root secrets of their leases, and signs for them in the console. An account is the tenant of each of its leases and usually their payer, but nothing a provider sees links a lease to its account.
_Avoid_: User, customer, profile, login, wallet

**Signer**:
Whatever holds an account's Nostr key and signs for it: a remote signer the account connects, or the console's local keystore.
_Avoid_: Wallet, extension, key manager

**Chain Seed**:
The mnemonic an account seals to itself, from which its payer keys on every settlement chain are derived. It is not derived from the account's Nostr key, so it works with a signer that never reveals that key.
_Avoid_: Wallet, master key, root secret, mnemonic (unqualified)

**Lease Vault**:
An account's records, each sealed to itself and kept on its own relays, that hold the root secret of each of its leases, so the leases can be managed from any machine the account signs in on.
_Avoid_: Backup, keystore, lease file

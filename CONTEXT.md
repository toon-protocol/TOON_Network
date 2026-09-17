# TOON Network

A decentralized compute marketplace built on TOON: providers sell leases on workloads, tenants buy them over TOON payment channels, the TOON relay carries discovery, and the TOON store holds image bytes.

## Language

### Parties

**Provider**:
An operator who sells leases on workloads running on hardware they control.
_Avoid_: Host, seller, node

**Tenant**:
The Nostr identity a lease belongs to.
_Avoid_: Consumer, buyer, customer, user

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

**Gateway Grant**:
A tenant's signed, published delegation that lets one workload gateway read a workload's lease state and access details until the grant expires.
_Avoid_: Token, API key, delegation certificate

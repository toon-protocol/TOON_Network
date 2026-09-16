# TOON Network protocol v1 (draft)

**Status:** draft, 2026-09-15. Written from the design session that produced [`CONTEXT.md`](../../CONTEXT.md) and [ADRs 0001–0011](../adr/). Where this spec and an ADR disagree, the ADR wins and this spec has a bug.

**Scope:** everything a **provider** must publish, accept and do. Tenant tooling is out of scope for v1. It is described only as far as a provider needs to validate what a tenant sends.

**Words:** the terms in `CONTEXT.md` are normative. MUST, SHOULD and MAY are used as in RFC 2119.

**Kind numbers:** every kind is allocated (§3.1). The numbers and their NIP-01 classes are normative, and an implementation MUST use them verbatim. The constant names (`K_PROFILE` and friends) are a convenience for implementations, not wire values.

---

## 1. Overview

A **provider** runs a **Paygress-derived provider app** (ADR 0001) as an ordinary HTTP app behind its own TOON connector. It publishes a **Provider Profile**, one **Listing** per tier, and **Liveness** to its **Relay Set**.

A **tenant** finds a listing on a relay and pays the provider's connector, directly or through any number of hops. A **Spawn** creates a **Lease**, and each **Extension** buys one more **Lease Interval**. A lease ends by **Expiry**, **Termination** or **Eviction**.

Images are published to the **Image Registry** on relays, with their bytes in the TOON store or an upstream OCI registry. A tenant may back a lease with **Warm Standbys**, which form a **Standby Set** and perform a **Takeover** if the primary goes silent.

```
tenant ──paid sealed packet (direct or n hops)──▶ provider connector ──HTTP──▶ provider app ──▶ workload
   │                                                                              │
   └──── reads Profile / Listing / Liveness / Image Registry ◀── relays ◀──────────┘ publishes
                                                                                  │
                                    TOON store (Arweave) ◀── Blob Records, parts ◀┘ fetches
```

---

## 2. Money

- **Token:** v1 prices everything in **USDC** and is settled on the chains the provider's connector accepts. Amounts are integers in **µUSDC** (6 decimals).
- **Prices:** every price is **per lease interval** (ADR 0003). No price is per second.
- **One route, one price:** a route charges exactly its configured price. A request that arrives on a paid route **is** paid, at that route's price (ADR 0005).
- **Payment headers:** the provider app MUST NOT read `X-TOON-Payer`, `X-TOON-Amount` or `X-TOON-Chain`. They are absent whenever the packet came through a hop.
- **Refunds:** there are none. That covers unused time, Termination, Eviction, and a paid request the provider answers with an error (ADR 0003).

---

## 3. Identity and keys

| Key | Held by | Signs |
|---|---|---|
| Provider Nostr key | provider | Provider Profile, Listings, Liveness, Takeover events, Eviction Notices |
| Connector sealing key | provider's connector | nothing in this protocol; tenants seal to it |
| Tenant Nostr key | tenant | Lease Requests (§6.1), Deployments (§3.1.2) |
| Publisher Nostr key | image or template publisher | Image Registry entries, Blob Records, Templates |

- **Pinned sealing key:** a Provider Profile MUST publish its connector's sealing public key. A tenant seals to that key and refuses if the URL's self-description reports another key (ADR 0011).
- **Payer vs tenant:** the provider never links a payer to a tenant. Tenant identity comes only from a Lease Request signature (ADR 0005).

### 3.1 Event kinds

Every TOON Network kind is allocated from one contiguous block per NIP-01 class, so that a relay filter on a block is cheap and future kinds land next to the existing ones (ADR 0012). The blocks are:

| Class | Block | Allocated | Free for later kinds |
|---|---|---|---|
| Regular (`1000`–`9999`) | `4432`–`4441` | `4432`–`4433` | `4434`–`4441` |
| Replaceable (`10000`–`19999`) | `10432`–`10441` | `10432`–`10433` | `10434`–`10441` |
| Addressable (`30000`–`39999`) | `30432`–`30441` | `30432`–`30437` | `30438`–`30441` |

A new TOON Network kind MUST be taken from the free range of the block for its class, lowest number first. When a block runs out, the next block is chosen by the same collision check as §3.1.1 and recorded here.

| Kind | Constant | Event | Class | Signer | Section |
|---|---|---|---|---|---|
| `4432` | `K_LEASE_REQUEST` | Lease Request | regular, **never published** | Tenant | §6.1 |
| `4433` | `K_EVICTION` | Eviction Notice | regular | Provider | §6.7 |
| `10432` | `K_PROFILE` | Provider Profile | replaceable | Provider | §4.1 |
| `10433` | `K_LIVENESS` | Liveness | replaceable | Provider | §4.3 |
| `30432` | `K_LISTING` | Listing | addressable, `d` = listing name | Provider | §4.2 |
| `30433` | `K_TAKEOVER` | Takeover | addressable, `d` = workload id | Provider (the warm standby) | §7.1 |
| `30434` | `K_IMAGE` | Image Registry entry | addressable, `d` = `<name>:<tag>` | Publisher | §8.1 |
| `30435` | `K_BLOB` | Blob Record | addressable, `d` = `sha256:<hex>` | Uploader | §8.2 |
| `30436` | `K_TEMPLATE` | Template | addressable, `d` = template name | Publisher | §8.3 |
| `30437` | `K_DEPLOYMENT` | Deployment | addressable, `d` = environment | Tenant | §3.1.2 |

Every event in the table except kind `4432` carries `["L","toon.network"]`, so the whole namespace is one label. A kind `4432` event is carried inside a request body and MUST NOT reach a relay (§6.1).

#### 3.1.1 What these numbers were checked against

Checked on **2026-09-16**, and no allocated number appears in any of them:

- the [NIPs kind table](https://github.com/nostr-protocol/nips#event-kinds), read from `README.md` at `master`, including NIP-69's `38383` (which is why no Paygress kind is reused) and NIP-29's `9000`–`9030` and `39000`–`39009` ranges;
- the [machine-readable registry of kinds](https://github.com/nostr-protocol/registry-of-kinds) (`schema.yaml` at `master`), which is broader than the README table. The nearest used kinds to the blocks are `4312`/`4454` (regular), `10377`/`11111` (replaceable) and `30403`/`30443` (addressable);
- Nostr CI / NIP-C1's `9840`–`9844`, `19843`, `19844`, `29846`, `39842` and `39844`, which `rig` publishes on the same relays. **Unverified upstream:** there is no `C1.md` in the NIPs repository as of this date, so these numbers were taken from issue #13 rather than from a merged NIP;
- TOON's `5094`–`5098` and Lading's `5320` and `30320`;
- Paygress's `38383`–`38386` and `20384`, none of which is reused.

#### 3.1.2 Deployment: kind `30437` (addressable), reserved

A **Deployment** is a tenant's signed statement that one environment of one repository is currently served by a lease. It is reserved here so that tenant tooling shares the `toon.network` namespace, and it is **out of this spec's scope**: a provider never publishes a Deployment, never reads one, and nothing in this spec depends on one existing. Only the tenant signs it.

Its tags are sketched, not normative:

```
["d", "<environment>"]                             e.g. production, preview-42
["a", "<repo coordinate>"]                         the repository this deploys
["p", "<provider pubkey>"]                         the provider running the lease
["x", "<workload_id>"]                             the lease's workload id
["x", "<image digest>"]                            the image the workload runs
["a", "30432:<provider pubkey>:<listing name>"]    the Listing it was bought from
["L", "toon.network"]
```

The repeated `a` and `x` tags are deliberate: a single `#a` filter finds a Deployment by either its repository or its Listing, and a single `#x` filter finds it by either its workload id or its image digest, which is the same use of `x` as the Eviction Notice (§6.7) and the Image Registry entry (§8.1).

Tenant tooling fixes the exact shape; until it does, a provider MUST ignore kind `30437`.

---

## 4. Provider Directory

A provider publishes the events in this section to **every relay in its Relay Set**. Each event MUST carry the tag `["L","toon.network"]` so directory queries can select them.

### 4.1 Provider Profile: kind `10432` (replaceable)

One per provider. Content is JSON:

| Field | Type | Meaning |
|---|---|---|
| `ilp_address` | string | The provider's ILP address, chosen by the provider, e.g. `g.acme` |
| `connector_url` | string | The connector's self-description URL, e.g. `https://c.acme.example/ilp`. A location hint only. |
| `connector_seal_key` | hex | The connector's sealing public key (§3) |
| `relays` | string[] | The Relay Set |
| `settlement` | object[] | `{ "chain": "solana" \| "evm:<chainId>", "token": "<address or mint>", "decimals": 6 }` |
| `isolation` | string | `shared-kernel` \| `dedicated-host` |
| `hidden` | bool | Hidden Provider declaration (§10) |
| `host` | string? | Public host tenants connect to. MUST be absent when `hidden` is true. |
| `liveness_cadence_s` | int | How often Liveness is republished |

### 4.2 Listing: kind `30432` (addressable)

One per sellable tier. `d` is the provider-chosen listing name, which is stable across versions.

Content is JSON:

| Field | Type | Meaning |
|---|---|---|
| `version` | int | Increases on every price or resource change (ADR 0009) |
| `resources` | object | `{ "cpu_millicores", "memory_mb", "storage_gb", "gpu"? }` |
| `arch` | string | `amd64` \| `arm64` |
| `lease_interval_s` | int | Length of one Lease Interval |
| `price` | int | µUSDC per interval for a running lease |
| `standby_price` | int? | µUSDC per interval for a Warm Standby. Absent — never `0` — means the listing sells no standbys (§5). |
| `capabilities` | string[] | Capabilities granted, e.g. `docker`, `nesting` (ADR 0004) |

Tags. Everything a relay should match goes in a single-letter tag; numbers stay in content.

```
["d", "<listing name>"]
["a", "10432:<provider pubkey>:"]                  profile this listing belongs to (ADR 0002)
["L", "toon.network"]
["l", "isolation:<value>", "toon.network"]
["l", "arch:<value>", "toon.network"]
["l", "gpu:<model>", "toon.network"]              when resources.gpu is set
["t", "<capability>"]                              one per capability
["g", "<geohash>"]                                 optional region
```

A new version replaces the previous Listing event on the relay. The provider MUST keep serving the routes of every version that still has a running lease (§5).

A listing that sells no Warm Standby MUST omit `standby_price` rather than publish `0`: a price of zero would sell held capacity for nothing, and it is the presence of the field that gives the listing its standby routes (§5).

A Listing whose Provider Profile cannot be found is not purchasable.

### 4.3 Liveness: kind `10433` (replaceable)

- **Cadence:** one per provider, republished every `liveness_cadence_s` seconds.
- **Expiration:** it MUST carry `["expiration", now + 5 × liveness_cadence_s]` (ADR 0007).
- **Not the ephemeral lane:** it MUST NOT be sent on the free ephemeral lane.

Content is JSON:

```json
{ "available": { "<listing name>": <int leases that could start now> } }
```

A provider is **live on a relay** while that relay holds an unexpired kind `10433` event from it.

### 4.4 Label vocabulary

The values a relay matches on come from a fixed vocabulary. A tenant picks a Listing by these tags alone, so a value MUST mean the same thing on every provider.

| Tag | Values |
|---|---|
| `l` `isolation:<value>` | `shared-kernel`, `dedicated-host` (§4.1) |
| `l` `arch:<value>` | `amd64`, `arm64` (§4.2) |
| `l` `gpu:<model>` | open (§11, item 1) |
| `t` `<capability>` | `docker`, `nesting` |

- A Listing MUST carry one `["t", "<capability>"]` tag per entry in `capabilities`, and MUST NOT carry a `t` tag for a capability it does not grant.
- A tenant MUST ignore a capability value this section does not define, and MUST NOT read an unknown value as implying a known one. A provider experimenting with a capability before it is specified here SHOULD prefix it `x-`.
- Capabilities are granted by the Listing alone (ADR 0004). A spawn never names one (§6.2).

#### `docker`

A lease from a Listing that grants `docker` runs a workload with a **Docker-compatible daemon of its own**.

- **Reachability.** The daemon MUST be reachable from inside the workload at the conventional socket path `/var/run/docker.sock`. A tenant may assume a client with no `DOCKER_HOST` set finds it; a provider MAY set `DOCKER_HOST` as well.
- **Scope.** The daemon MUST be scoped to that one lease. Its images, containers, volumes and networks belong to that lease, are invisible to every other lease, and are destroyed when the lease ends (§6.7).
- **Never the host daemon.** The provider MUST NOT expose the daemon it runs its own workloads with, nor any daemon shared between leases, to a workload: not by bind-mounting its socket, not through a device, not over TCP, and not by proxying it. A provider app that itself drives a host daemon to create workloads is unaffected — that socket stays on the provider's side of the workload boundary.
- **Reference shape.** A per-lease `dind` sidecar — a second container in the lease's isolation unit, sharing a private network with the workload, whose socket is the only one the workload sees — is the reference implementation. A backend MAY run an equivalent (a rootless daemon inside the workload, a daemon inside a nested VM) if it has the same scope and isolation, and the backend MUST document which it runs.
- **Image pulls.** What the lease's daemon pulls is ordinary workload egress: it reaches exactly what the provider's egress policy allows that lease and nothing more. §8.4 does not apply to it — the Image Registry names the lease's own image, never the images a tenant pulls inside it — and the provider's own image cache MUST NOT be shared into the daemon. A provider whose egress policy blocks public registries SHOULD NOT grant `docker`, because a daemon that cannot pull cannot be used. For a Hidden Provider, nested pulls leave through `anon` like all other egress (§10).
- **Privilege.** Granting `docker` is the provider accepting that it will run, per lease, a component that needs elevated privileges on its host — classically a privileged `dind` container. That is why it is a per-Listing decision and never a per-spawn one. It gives the **workload container itself** no extra Linux capabilities, no host mounts and no device mappings, and a spawn still may not ask for any (§6.2, ADR 0004). A provider on `shared-kernel` isolation that grants `docker` is accepting that privileged component on the kernel its other leases share.
- **Resource accounting.** The Listing's `resources` bound the whole lease: the workload, its daemon, and every container that daemon runs. The provider MUST enforce `cpu_millicores` and `memory_mb` across that unit as a whole, not per container. Nested image layers and volumes count against `storage_gb`, and against `volume_gb` when they sit on the persistent volume. A lease that outgrows its budget is treated like any other overrun: the provider MAY throttle it, MAY let the kernel kill it, and MAY evict it (§6.7).
- **Arch.** Nested containers run on the same machine, so the Listing's `arch` is their architecture too. `docker` promises no emulation: a pull of another architecture inside the workload MAY fail, and a provider that does offer emulation offers it outside this spec.
- **Not included.** `docker` grants no nested VMs, no host network, no host devices and no GPU — a GPU comes from `resources.gpu`.

#### `nesting`

A lease from a Listing that grants `nesting` may create **isolation units of its own** — containers, sandboxes or virtual machines — with whatever mechanism its image brings: user namespaces, a container runtime it ships, or a hypervisor.

- **How it differs from `docker`.** `docker` is a service the provider supplies at a known path; `nesting` is a permission the provider extends to tenant code. Under `docker` the privileged component is one the provider built and controls; under `nesting` the workload itself holds the kernel privileges its mechanism needs.
- **Neither implies the other.** A Listing granting `docker` does not grant `nesting`: the workload may drive the daemon it was given and nothing else. A Listing granting `nesting` puts nothing at `/var/run/docker.sock`. A tenant that needs both MUST pick a Listing whose `capabilities` contains both.
- **Privilege.** A provider MUST NOT grant `nesting` unless it accepts tenant-supplied code holding those privileges; `isolation: dedicated-host` (§4.1) is the expected shape. Which devices a `nesting` lease is given — `/dev/kvm`, `/dev/fuse` and the like — is the provider's decision, and it SHOULD document that decision. A spawn still names no device (§6.2, ADR 0004).
- **Resource accounting** and **arch** are as for `docker`: everything nested counts against the Listing's `resources`, and nested guests run on the Listing's `arch`.

#### Asking for a capability in a spawn

A spawn carries no capability field, and a provider MUST NOT accept one (§6.2). Where a provider can recognise that a spawn is asking for a capability the route's Listing does not grant — a field outside the §6.2 table, or a request convention its backend documents — it MUST refuse the spawn with `invalid_request` rather than start a workload that cannot do what was asked of it.

---

## 5. Routes

The provider's connector terminates these routes and forwards them to the provider app. `<addr>` is the profile's `ilp_address`, and `v<n>` is a listing version.

| Route | Price | Purpose |
|---|---|---|
| `<addr>.<listing>.v<n>.spawn` | `price` | Spawn a primary or standalone lease |
| `<addr>.<listing>.v<n>.extend` | `price` | Extend a running lease by one interval |
| `<addr>.<listing>.v<n>.standby` | `standby_price` | Spawn a Warm Standby lease |
| `<addr>.<listing>.v<n>.standby.extend` | `standby_price` | Extend a Warm Standby by one interval |
| `<addr>.availability` | free | Would a spawn run? |
| `<addr>.status` | free | Lease state and access details |
| `<addr>.terminate` | free | Termination |

- **Standby routes:** `<addr>.<listing>.v<n>.standby` and `<addr>.<listing>.v<n>.standby.extend` exist for exactly the listings whose Listing event carries `standby_price` (§4.2). A listing that prices no Warm Standby has neither route, and a connector MUST NOT terminate a route the provider did not price.
- **Rate limits:** the provider SHOULD rate-limit free routes.
- **Restarts:** adding or retiring a listing version is a connector config change and restart (ADR 0009).

Every response is JSON. Errors use this shape, and on a paid route they are still billed (§2):

```json
{ "error": "<code>", "message": "<human readable>" }
```

Error codes: `unknown_workload`, `wrong_listing_version`, `not_tenant`, `workload_id_taken`, `refused_image`, `no_capacity`, `no_matching_arch`, `invalid_request`, `expired`, `not_standby`, `bad_signature`, `stale_request`.

---

## 6. Leases

### 6.1 Lease Request: kind `4432` (regular, never published)

This is a tenant-signed event carried in request bodies. The provider validates it and MUST NOT publish it.

- **Tags:**
  - `["p", "<provider pubkey>"]`: the provider MUST refuse unless one of the `p` tags is its own key. A spawn that forms a Standby Set carries **one `p` tag per member** (§7), because the tenant signs that spawn once and sends the same bytes to every member; every other request carries exactly one `p` tag, and a provider MUST refuse a `status` or a `terminate` that names a second provider. Which `p` tags a spawn may carry is §6.2 step 3, where the `standby_set` is known.
  - `["op", "spawn" | "status" | "terminate"]`
  - `["expiration", t]`: the provider MUST refuse if `now > t`, and SHOULD refuse if `t - created_at` exceeds 300 s (`stale_request`).
- **Replay:** the provider MUST keep the ids of Lease Requests it has accepted until their expiration, and refuse repeats.

#### 6.1.1 Signing and packet body encoding

- **A NIP-01 event, nothing more.** A Lease Request is an ordinary Nostr event of kind `K_LEASE_REQUEST` signed by the tenant's Nostr key. Its `id` is the SHA-256 of the NIP-01 serialization `[0, <pubkey>, <created_at>, <kind>, <tags>, <content>]` (UTF-8, no whitespace, NIP-01 escaping), and `sig` is a BIP-340 Schnorr signature over that `id` by `pubkey`. Nothing TOON-specific is hashed or signed, so any NIP-01 library produces and verifies a Lease Request.
- **Content.** `content` is the op's JSON object (§6.2, §6.5, §6.6) serialised to a string. A field the spec does not name, anywhere in it, MUST be refused as `invalid_request`, never dropped (ADR 0004).
- **Packet body.** The request body of a signed route is the JSON object `{ "request": <event> }`: the signed event as a JSON object, unmodified, as the value of the single key `request`. It is not re-encoded, base64'd or wrapped further, and a body with any other key MUST be refused as `invalid_request`. This body is the HTTP body inside the connector's sealed envelope: the tenant seals the whole HTTP request to the provider's pinned `connector_seal_key` (§3, ADR 0011; connector ADR 0018), the connector unseals it and forwards plain HTTP, and the provider app reads the body as plaintext JSON and no payment header (§2).
- **Verification order.** The provider verifies `id` and `sig` first (`bad_signature`), then the kind, the `p` tags and the `op` tag (`invalid_request`), then `expiration` and the window (`stale_request`), then replay (`stale_request`). This is the whole of §6.2 step 1, and every signed route runs it identically.
- **Fixtures.** Signed Lease Requests per `op`, with their packet bodies, are in Appendix B.

### 6.2 Spawn

**Request body** on `.spawn` or `.standby`: `{ "request": <kind 4432 event, op=spawn> }`. The request's content is JSON:

| Field | Type | Meaning |
|---|---|---|
| `workload_id` | hex, 32 bytes | Chosen at random by the tenant; shared by a Standby Set |
| `image` | object | One of the three forms below. The digest names an index or a manifest. |
| `env` | object | Environment variables |
| `ports` | object[] | `{ "container_port", "protocol": "tcp" \| "udp" }` |
| `volume_gb` | int? | Persistent volume, ≤ `resources.storage_gb` |
| `ssh_public_key` | string | Tenant's SSH key. No password is ever issued. |
| `entrypoint`, `args` | string[]? | Overrides of the image's own |
| `standby_set` | string[]? | Provider pubkeys, primary first (§7) |
| `template` | string? | Informational `30436:<pubkey>:<d>` the values came from |

**The `image` object** takes exactly one of three forms:

| Form | Fields | Where the bytes come from |
|---|---|---|
| Upstream | `{ "reference": "<oci repository>", "digest": "sha256:…" }` | Pulled as `reference@digest` from the registry the reference names. No Image Registry lookup at all. |
| Registry entry | `{ "digest": "sha256:…", "registry_entry": { "address": "30434:<pubkey>:<d>", "relay": "<url>" } }` | The entry at `address` lists every blob and the source of each (§8.1). `relay` is a hint for finding the entry, not an authority: the entry is addressed by its signer. |
| Digest alone | `{ "digest": "sha256:…" }` | Blob Records found by `#x` on the provider's Relay Set (§8.4 step 3). |

`reference` is an OCI repository (`[registry[:port]/]repo[/path…]`) with no tag and no `@digest`. `digest` is `sha256:` followed by exactly 64 lowercase hex characters. `reference` and `registry_entry` MUST NOT both be present; any other shape is `invalid_request`.

Because an Image Registry entry's `d` is itself `<name>:<tag>` (§8.1), the coordinate in `registry_entry.address` has four colon-separated fields — `30434:<pubkey>:<name>:<tag>` — and a reader MUST split it into at most three parts, so the `d` keeps its own colon.

**The provider MUST NOT accept** runtime flags, host mounts, device mappings or capabilities in a spawn. Capabilities come only from the listing (ADR 0004). `template` is informational: the provider parses it so it cannot arrive as an unknown field, and never acts on it.

**Validation**, in order, refusing with the first failing code:
1. The signature is valid, a `p` tag names this provider, and the request is not expired or replayed.
2. The route's listing version exists, and `volume_gb` and the ports fit the listing. On `.standby` the listing MUST also price standbys: a listing with no `standby_price` sells none and has no `.standby` route at all (§4.2, §5), so a spawn that arrives on one is refused `wrong_listing_version` — the route is not on sale here, exactly as a retired version's is not.
3. **Role:**
   - With no `standby_set`, the route MUST be `.spawn`, and the request MUST name no provider but this one.
   - With a `standby_set`, this provider MUST be in the set, and every `p` tag MUST name a member of it. Index 0 MUST arrive on `.spawn`, and any other index on `.standby`.
   - A `standby_set` MUST list each member once, as a public key; a list that repeats a provider gives it two positions and so two roles.
   - Every failure of this step is `invalid_request`: the spawn is mis-addressed and the tenant must correct it, not retry it. It is still billed (ADR 0003).
4. `workload_id` is not held by this provider for a different tenant (`workload_id_taken`).
5. **Image:** resolve it (§8.4). With an index, pick the manifest for the listing's `arch` (`no_matching_arch`). Apply the provider's image policy (`refused_image`).
6. Capacity is available (`no_capacity`).

**On success:**
- **Primary or standalone:** the provider starts the workload and sets `expires_at = now + lease_interval_s`.
- **Standby:** the provider reserves capacity without starting anything, and sets `expires_at` the same way.

The response is:

```json
{
  "workload_id": "…",
  "role": "standalone" | "primary" | "standby",
  "expires_at": 1757350000,
  "access": { "host": "…", "ssh_port": 22022, "ports": [ { "container_port": 443, "host_port": 30443 } ] }
}
```

`access` is absent for a standby until Takeover. For a Hidden Provider, `host` is a per-lease `.anyone` address (§10).

### 6.3 Extension

**Request body:** `{ "workload_id": "…" }`, with no signature. Any payer may extend any lease (ADR 0005).

- **On `.extend`:** the lease MUST be a running standalone or primary lease, or a standby after Takeover, and its listing version MUST equal the route's. The provider then sets `expires_at += lease_interval_s`.
- **On `.standby.extend`:** the lease MUST be a standby before Takeover. The provider sets `expires_at += lease_interval_s`.
- **Otherwise:** the provider refuses with `unknown_workload`, `wrong_listing_version`, `not_standby` or `expired`.

It responds with `{ "workload_id", "expires_at" }`.

### 6.4 Availability (free)

**Request body:** `{ "listing": "<name>", "version": <n>, "image_digest": "sha256:…", "role"?: "primary" | "standby" }`

**Response:** `{ "would_run": true }` or `{ "would_run": false, "error": "<code>", "message": "…" }`

It applies §6.2 steps 2, 5 and 6 without starting anything. A positive answer is advice, not a reservation: a spawn that later fails is still billed (ADR 0003).

With `role: "standby"` it answers whether a Warm Standby **would be reserved** here, and reserves nothing: the listing must price standbys — one that does not is refused `wrong_listing_version`, the same answer its `.standby` route would have given — and capacity is counted with reservations subtracted, exactly as for a running lease (§6.7). Omitting `role`, or `role: "primary"`, asks the ordinary question.

### 6.5 Status (free)

**Request body:** `{ "request": <kind 4432 event, op=status> }`. Content: `{ "workload_id": "…" }`.

The signer MUST be the lease's tenant (`not_tenant`). The response has `workload_id`, `role`, `state` (§6.7), `expires_at`, `access` when present, and `template` when the spawn named one (§6.2) — echoed as given, never resolved.

### 6.6 Termination (free)

**Request body:** `{ "request": <kind 4432 event, op=terminate> }`. Content: `{ "workload_id": "…" }`.

The signer MUST be the lease's tenant. The provider destroys the workload or releases the reservation immediately. There is no refund.

### 6.7 Lease states and endings

```
standalone/primary:   Provisioning ──▶ Running ──▶ Ended(expiry | termination | eviction)
standby:              Reserved ──takeover──▶ Running ──▶ Ended(…)
                      Reserved ──▶ Ended(expiry | termination | eviction)
```

- **On the wire:** `status` (§6.5) answers the state as `"provisioning"`, `"reserved"`, `"running"` or `{ "ended": "expiry" | "termination" | "eviction" }`. `Reserved` is a Warm Standby before Takeover: the capacity is held and paid for, nothing runs, and the answer carries no `access`.
- **Reservations count:** a `Reserved` lease holds its `workload_id` and its capacity slot exactly as a running one does, so Liveness `available` (§4.3) and `availability` (§6.4) both subtract it.
- **Expiry:** the provider MUST sweep at least every 30 s and end every lease with `expires_at <= now`. There is no grace period (ADR 0003).
- **Eviction:** a provider MAY evict a lease for abuse, policy or maintenance. It MUST publish an Eviction Notice.
- **Eviction Notice** (kind `4433`, regular): published to the Relay Set, with content `{ "workload_id": "…", "reason": "<code>", "message": "…" }` and tag `["x", "<workload_id>"]`.
- **Persistence:** the provider MUST persist running leases and reservations across its own restarts.

---

## 7. Warm Standby

- **Standby Set:** every lease in a Standby Set is spawned with the same `workload_id` and the same `standby_set` list. Index 0 is the primary. A provider's role comes from its position in the list.
- **One signed spawn:** the tenant signs that spawn **once**, names every member in its `p` tags (§6.1), and sends the same bytes to each. Nothing in the request singles out a member, so a provider's role is its position together with the route the request was paid on (§6.2 step 3): the primary's spawn is bought on `.spawn` at `price`, each standby's on `.standby` at `standby_price`.
- **A reservation is a lease:** a Warm Standby's lease is `Reserved` from the spawn (§6.7). It holds its `workload_id` and its capacity slot, is persisted across the provider's restarts, expires on the sweep if nothing pays it, and is released by a Termination — all without the provider ever starting anything.
- **Membership changes:** changing membership means new spawns under a new `workload_id`.

### 7.1 Takeover (ADR 0010)

A standby watches the primary's Liveness on the **primary's** Relay Set, read from the primary's Provider Profile.

1. **Trigger:** the primary's Liveness is expired or absent on a strict majority of that Relay Set, continuously for `liveness_cadence_s` seconds.
2. **Announce:** the standby publishes a Takeover event to the primary's Relay Set.
   - Kind `30433` (addressable), `d = <workload_id>`. Addressable, so a standby leaves one claim per workload rather than a history, and step 3 reads a set of claimants.
   - Content: `{ "workload_id": "…", "primary": "<pubkey>" }`, where `primary` is the hex pubkey at `standby_set[0]`.
   - Signed by the **standby** that claims the workload, never by the primary.
3. **Settle:** after 2 × `liveness_cadence_s`, the standby queries kind `30433` events for `d = <workload_id>` from **pubkeys in `standby_set`**. The winner has the earliest `created_at`; a tie goes to the lower index in `standby_set`.
4. **If it won:** the standby starts the workload and the lease becomes Running. From then on the lease needs a `.extend` (full price) before its current `expires_at`, or it expires. `.standby.extend` is refused.
5. **If it lost:** the standby stays Reserved, and watches the winner as its new primary.

**Primary self-stop:** a primary that cannot publish Liveness to a strict majority of its own Relay Set for 5 × `liveness_cadence_s` MUST stop its workload. Its lease stays paid until `expires_at`, and it may restart the workload once it regains a majority and no Takeover event exists for the lease.

**No state moves on Takeover.** The standby starts from the image, and data replication is the workload's own job.

---

## 8. Image Registry and image bytes

The three events in this section are signed by a **publisher**, never by a provider: a provider only reads them. Like every other TOON Network event they carry `["L","toon.network"]` (§4), so one relay filter finds them whatever their kind.

### 8.1 Image Registry entry: kind `30434` (addressable)

Signed by the publisher, with `d = "<name>:<tag>"`. The canonical name is `<publisher npub>/<name>:<tag>`.

Content is JSON:

```json
{
  "digest": "sha256:…",
  "media_type": "application/vnd.oci.image.index.v1+json",
  "blobs": [
    { "digest": "sha256:…", "size": 1234, "media_type": "…",
      "source": { "type": "toon-store", "blob_record_txid": "<arweave txid>" } },
    { "digest": "sha256:…", "size": 5678, "media_type": "…",
      "source": { "type": "oci", "registry": "registry-1.docker.io", "repository": "library/alpine" } }
  ]
}
```

- **Blob list:** `blobs` MUST list every blob reachable from `digest`: the index, the manifests, the configs and the layers.
- **Tag:** `["x", "<digest hex>"]` — the hex ALONE, with no `sha256:` prefix, so an `#x` filter is over the same string whatever wrote it.
- **Source:** `type` is `"toon-store"` or `"oci"` and nothing else in v1; a reader MUST refuse a source type it does not know rather than skip the blob.
- **Moving a tag:** re-publishing the same `d` points the tag at a new image.

### 8.2 Blob Record: kind `30435` (addressable)

Signed by whoever uploaded the parts, with `d = "sha256:<hex>"`.

Content is JSON:

```json
{ "digest": "sha256:…", "size": 31457280, "part_size": 102400,
  "parts": [ { "txid": "…", "sha256": "…", "size": 102400 } ] }
```

- **Tag:** `["x", "<hex>"]` — as in §8.1, the hex with no `sha256:` prefix. `d` keeps the prefix; the tag does not.
- **Parts:** each is stored as one TOON store upload (`kind:5094`), and `parts` is ORDERED: a reader concatenates them as they appear and checks the result against `digest`. A part's `sha256` is bare hex, with no `sha256:` prefix — a part is not content-addressed the way a blob is.
- **`part_size`:** the size every part but the last has. The last part is the remainder, so the parts' sizes MUST sum to `size`.
- **Where it lives:** the Blob Record is published to relays, and the same signed event JSON is also uploaded once to the TOON store. That upload's transaction id is the `blob_record_txid` used in Image Registry entries (ADR 0006).

### 8.3 Template: kind `30436` (addressable)

Signed by the publisher, with `d = <template name>`.

- **Content:** `{ "version": n, "image": { "digest", "registry_entry"? }, "ports": [ { "container_port", "protocol" } ], "data_path"?, "env_fixed": {…}, "env_tenant": ["NAME", …], "min_resources"?: { "cpu_millicores", "memory_mb", "storage_gb", "gpu"? } }`
- **Shapes it borrows:** `image` is §6.2's registry-entry or digest-alone form (never the upstream one — a Template names an image by content address); `ports` is a spawn's `ports` (§6.2); `min_resources` is a Listing's `resources` (§4.2), read as a floor for choosing a Listing rather than as a rule on any provider.
- **No capabilities:** a Template grants nothing (ADR 0004).
- **Not actions:** a Template describes a spawn only. Reusable CI actions are out of scope for TOON Network and belong to rig, outside the `toon.network` label (ADR 0014, proposed).
- **Who expands it:** in v1 the **tenant** expands a Template into a spawn. The provider never reads Templates, and `template` in a spawn is informational (§11, item 5).

### 8.4 Resolving and fetching an image (provider)

For each blob the provider needs, it tries these sources in order, and stops at the first that yields bytes matching the digest:
1. **Local cache.**
2. **The spawn's `registry_entry`**, if present: that blob's `source`.
   - For `toon-store`, fetch the Blob Record by `blob_record_txid`, then its parts.
   - For `oci`, pull by digest from that registry.
3. **Blob Records on its Relay Set:** those found by `#x = <hex>`.

A fetch MUST:
- read each part from a configurable gateway pattern, e.g. `{gateway}/raw/{txid}`;
- check each part's `sha256` and size;
- concatenate the parts in order;
- check the whole blob's digest.

A blob that fails verification is discarded, and the next source is tried. A blob that no source can serve fails the spawn with `refused_image`, or `no_capacity` if the disk is full. Verified blobs SHOULD be cached across leases.

A provider that does not implement this resolution at all answers `refused_image` for both Image Registry forms of §6.2's `image`, with a message saying so — never `invalid_request`, which would send a tenant to fix a request that is already correct. Whether the refusal is that or exhaustion of the chain above, it MUST come before capacity is counted and before anything is created, so `availability` (§6.4) reports it for free. The `{ reference, digest }` form consults none of this: the provider pulls `reference@digest` from the named registry and verifies the digest there.

---

## 9. Workload rules

- **v1 workloads are OCI containers** (ADR 0001 scope; Paygress Docker backend).
- **Access:** SSH uses only the tenant's `ssh_public_key`. Ports are exposed as `host:host_port`.
- **Hostnames and TLS:** outside the provider protocol. A provider never owns a domain, runs ACME or terminates TLS, and never holds a tenant's certificate key. A stable HTTPS name for a workload is the job of a **Workload Gateway**, a separate TOON app keyed by `workload_id` (ADR 0013, *Proposed*; §11, item 6). Until one exists, a tenant that wants HTTPS terminates it inside its own workload.
- **Capabilities:** Docker-in-workload, nesting and similar are enabled only when the listing grants them, and mean what §4.4 says they mean.
- **Refusals:** the provider MAY refuse any image by its own policy. It SHOULD answer that refusal on `availability` first.

---

## 10. Hidden Provider

A provider MAY set `hidden: true` only if all of these hold (ADR 0008):
- its connector is reachable only at an `.anyone` address;
- every lease's SSH and ports are reachable only at a per-lease `.anyone` address;
- all workload egress leaves through `anon`;
- its profile has no `host`;
- it runs its own settlement RPC.

`hidden` is a self-assertion. Payments still reveal who paid whom on chain.

---

## 11. Open items

1. **Label vocabulary:** §4.4 fixes `isolation`, `arch`, and the `docker` and `nesting` capabilities. Still open: `gpu:<model>` naming, and how a capability beyond the `x-` prefix gets added.
2. **Large Blob Records:** a record over one store data item (~700 parts at 100 KiB) needs paging or a larger `part_size`.
3. **Timing constants:** the 300 s request window, the 30 s sweep, and the takeover settle window are first guesses.
4. **Runtime route writes:** the connector has none for terminated routes, so every listing change restarts it.
5. **Template expansion:** v1 has the tenant expand Templates. An earlier walkthrough described the provider reading the Template; confirm which.
6. **Hostnames and TLS, and later rounds.** Hostnames and TLS are decided in principle by ADR 0013 (*Proposed*): they stay out of the provider protocol and belong to a **Workload Gateway** keyed by `workload_id`. The gateway itself is unspecified. Its first open question is authority: `.status` (§6.5) needs the tenant's signature, so a gateway cannot re-resolve a workload after a Takeover without a delegation v1 does not define (ADR 0005). Also unspecified: which of a spawn's `ports` is the HTTP one. Still later: reputation receipts, auditor labels, streaming state to standbys, Lading as a blob source, more tokens, and KVM workloads.

---

## Appendix A. Sandbox profile (development)

v1 is developed against `infra/sandbox`, then pointed at production URLs.

| Thing | Sandbox value |
|---|---|
| Hub connector client edge | `http://localhost:3200` |
| Relay (reads) | `ws://localhost:7100` |
| Relay write routes | `g.toon.relay` (1 µUSDC); `g.toon.relay.ephemeral` is not used |
| TOON store | `g.toon.store`, `kind:5094`; free tier ≤ 107,520 bytes per data item, so `part_size` ≤ 102,400 |
| Gateway pattern | `http://localhost:3000/raw/{txid}` |
| Settlement | Solana mock USDC (the hub's client leg) and anvil mock USDC; a provider connector copies `conf/connector-store.toml` |
| Provider connector | Level 2 shape (README §5); tenants may pay it directly or through the hub |
| Hidden Provider | the sandbox `hs` profile |

### A.1 The `ci` Listing

The sandbox provider (`g.toon.provider`) sells a `ci` tier: the tier a workflow runner buys when it needs `act`, or any other tool that drives a Docker daemon, to work inside the workload. It is the worked example of a `docker` grant (§4.4), and the one target the Milestone 1 smoke and a tenant-side runner share.

Content:

```json
{
  "version": 1,
  "resources": { "cpu_millicores": 2000, "memory_mb": 4096, "storage_gb": 10 },
  "arch": "amd64",
  "lease_interval_s": 600,
  "price": 5000,
  "capabilities": ["docker"]
}
```

Tags:

```
["d", "ci"]
["a", "10432:<provider pubkey>:"]                  the sandbox provider's Profile (§4.2)
["L", "toon.network"]
["l", "isolation:shared-kernel", "toon.network"]
["l", "arch:amd64", "toon.network"]
["t", "docker"]
```

Its paid routes are `g.toon.provider.ci.v1.spawn` and `g.toon.provider.ci.v1.extend` (§5).

A tenant selecting for CI matches `["t", "docker"]`, and gets a workload whose `/var/run/docker.sock` is its own daemon's — within the 2000 millicores, 4 GiB and 10 GB the tier sells, that daemon's own containers and image layers included (§4.4). Nested images are `amd64`, like the tier. A provider publishes this Listing only once its backend supplies that per-lease daemon; publishing `["t", "docker"]` without one is a Listing that lies (§4.4).

---

## Appendix B. Wire fixtures

Golden fixtures for every tenant-facing surface Milestone 1 implements live in [`fixtures/`](fixtures/README.md): a signed Lease Request per `op` with its packet body (§6.1.1), request and response bodies per route (§5, §6), one refusal per §5 error code in validation order, one event per directory kind (§4, §6.7), and the routes a Listing generates (§5). They are generated by the provider's wire tests (`toon-provider`, `tests/wire_fixtures.rs`), verified byte-for-byte by its CI, and copied here with `make fixtures TOON_SPEC_DIR=…`, so the copy is exactly what the provider accepts and emits. Signatures use all-zero BIP-340 auxiliary randomness so they are reproducible; the keys are test-only. `fixtures/check.mjs` verifies the copy with no dependencies. Milestone 2 adds one fixture per §8 event — an Image Registry entry with both source types, a Blob Record with three parts, and a Template — each signed by a publisher test key of its own, plus one spawn per form of §6.2's `image` and the availability answer for an image no source can serve. Milestone 3 adds the Warm Standby wire shapes: a Takeover event (§7.1), a Listing that prices standbys and the four paid routes it generates (§4.2, §5), and an availability request carrying `role` (§6.4); then the Standby Set roles themselves — one signed spawn answered `role: "primary"` with access at index 0 and `role: "standby"` with none at index 1, and a `status` for each, the standby's in the `reserved` state (§6.2, §6.5, §6.7). The surfaces that pay and take over a standby arrive with the rest of Milestone 3; the README says which fixture is still a shape only.

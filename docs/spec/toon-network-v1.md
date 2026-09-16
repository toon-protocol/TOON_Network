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
| `standby_price` | int? | µUSDC per interval for a Warm Standby. Absent means the listing sells no standbys. |
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
  - `["p", "<provider pubkey>"]`: the provider MUST refuse if it isn't its own key.
  - `["op", "spawn" | "status" | "terminate"]`
  - `["expiration", t]`: the provider MUST refuse if `now > t`, and SHOULD refuse if `t - created_at` exceeds 300 s (`stale_request`).
- **Replay:** the provider MUST keep the ids of Lease Requests it has accepted until their expiration, and refuse repeats.

### 6.2 Spawn

**Request body** on `.spawn` or `.standby`: `{ "request": <kind 4432 event, op=spawn> }`. The request's content is JSON:

| Field | Type | Meaning |
|---|---|---|
| `workload_id` | hex, 32 bytes | Chosen at random by the tenant; shared by a Standby Set |
| `image` | object | `{ "digest": "sha256:…", "registry_entry"?: { "address": "30434:<pubkey>:<d>", "relay": "<url>" } }`. The digest names an index or a manifest. |
| `env` | object | Environment variables |
| `ports` | object[] | `{ "container_port", "protocol": "tcp" \| "udp" }` |
| `volume_gb` | int? | Persistent volume, ≤ `resources.storage_gb` |
| `ssh_public_key` | string | Tenant's SSH key. No password is ever issued. |
| `entrypoint`, `args` | string[]? | Overrides of the image's own |
| `standby_set` | string[]? | Provider pubkeys, primary first (§7) |
| `template` | string? | Informational `30436:<pubkey>:<d>` the values came from |

**The provider MUST NOT accept** runtime flags, host mounts, device mappings or capabilities in a spawn. Capabilities come only from the listing (ADR 0004).

**Validation**, in order, refusing with the first failing code:
1. The signature is valid, `p` is this provider, and the request is not expired or replayed.
2. The route's listing version exists, and `volume_gb` and the ports fit the listing.
3. **Role:**
   - With no `standby_set`, the route MUST be `.spawn`.
   - With a `standby_set`, this provider MUST be in the set. Index 0 MUST arrive on `.spawn`, and any other index on `.standby`.
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

### 6.5 Status (free)

**Request body:** `{ "request": <kind 4432 event, op=status> }`. Content: `{ "workload_id": "…" }`.

The signer MUST be the lease's tenant (`not_tenant`). The response has `workload_id`, `role`, `state` (§6.7), `expires_at`, and `access` when present.

### 6.6 Termination (free)

**Request body:** `{ "request": <kind 4432 event, op=terminate> }`. Content: `{ "workload_id": "…" }`.

The signer MUST be the lease's tenant. The provider destroys the workload or releases the reservation immediately. There is no refund.

### 6.7 Lease states and endings

```
standalone/primary:   Provisioning ──▶ Running ──▶ Ended(expiry | termination | eviction)
standby:              Reserved ──takeover──▶ Running ──▶ Ended(…)
                      Reserved ──▶ Ended(expiry | termination | eviction)
```

- **Expiry:** the provider MUST sweep at least every 30 s and end every lease with `expires_at <= now`. There is no grace period (ADR 0003).
- **Eviction:** a provider MAY evict a lease for abuse, policy or maintenance. It MUST publish an Eviction Notice.
- **Eviction Notice** (kind `4433`, regular): published to the Relay Set, with content `{ "workload_id": "…", "reason": "<code>", "message": "…" }` and tag `["x", "<workload_id>"]`.
- **Persistence:** the provider MUST persist running leases and reservations across its own restarts.

---

## 7. Warm Standby

- **Standby Set:** every lease in a Standby Set is spawned with the same `workload_id` and the same `standby_set` list. Index 0 is the primary. A provider's role comes from its position in the list.
- **Membership changes:** changing membership means new spawns under a new `workload_id`.

### 7.1 Takeover (ADR 0010)

A standby watches the primary's Liveness on the **primary's** Relay Set, read from the primary's Provider Profile.

1. **Trigger:** the primary's Liveness is expired or absent on a strict majority of that Relay Set, continuously for `liveness_cadence_s` seconds.
2. **Announce:** the standby publishes a Takeover event to the primary's Relay Set.
   - Kind `30433` (addressable), `d = <workload_id>`.
   - Content: `{ "workload_id": "…", "primary": "<pubkey>" }`.
3. **Settle:** after 2 × `liveness_cadence_s`, the standby queries kind `30433` events for `d = <workload_id>` from **pubkeys in `standby_set`**. The winner has the earliest `created_at`; a tie goes to the lower index in `standby_set`.
4. **If it won:** the standby starts the workload and the lease becomes Running. From then on the lease needs a `.extend` (full price) before its current `expires_at`, or it expires. `.standby.extend` is refused.
5. **If it lost:** the standby stays Reserved, and watches the winner as its new primary.

**Primary self-stop:** a primary that cannot publish Liveness to a strict majority of its own Relay Set for 5 × `liveness_cadence_s` MUST stop its workload. Its lease stays paid until `expires_at`, and it may restart the workload once it regains a majority and no Takeover event exists for the lease.

**No state moves on Takeover.** The standby starts from the image, and data replication is the workload's own job.

---

## 8. Image Registry and image bytes

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
- **Tag:** `["x", "<digest hex>"]`.
- **Moving a tag:** re-publishing the same `d` points the tag at a new image.

### 8.2 Blob Record: kind `30435` (addressable)

Signed by whoever uploaded the parts, with `d = "sha256:<hex>"`.

Content is JSON:

```json
{ "digest": "sha256:…", "size": 31457280, "part_size": 102400,
  "parts": [ { "txid": "…", "sha256": "…", "size": 102400 } ] }
```

- **Tag:** `["x", "<hex>"]`.
- **Parts:** each is stored as one TOON store upload (`kind:5094`).
- **Where it lives:** the Blob Record is published to relays, and the same signed event JSON is also uploaded once to the TOON store. That upload's transaction id is the `blob_record_txid` used in Image Registry entries (ADR 0006).

### 8.3 Template: kind `30436` (addressable)

Signed by the publisher, with `d = <template name>`.

- **Content:** `{ "version": n, "image": { "digest", "registry_entry"? }, "ports", "data_path"?, "env_fixed": {…}, "env_tenant": ["NAME", …], "min_resources"?: {…} }`
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

---

## 9. Workload rules

- **v1 workloads are OCI containers** (ADR 0001 scope; Paygress Docker backend).
- **Access:** SSH uses only the tenant's `ssh_public_key`. Ports are exposed as `host:host_port`.
- **Hostnames and TLS:** outside the provider protocol. A provider never owns a domain, runs ACME or terminates TLS, and never holds a tenant's certificate key. A stable HTTPS name for a workload is the job of a **Workload Gateway**, a separate TOON app keyed by `workload_id` (ADR 0013, *Proposed*; §11, item 6). Until one exists, a tenant that wants HTTPS terminates it inside its own workload.
- **Capabilities:** Docker-in-workload, nesting and similar are enabled only when the listing grants them.
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

1. **Label vocabulary:** the allowed `isolation`, `arch`, `gpu` and capability values, and how to add more.
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

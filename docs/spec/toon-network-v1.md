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
| Publisher Nostr key | image or template publisher | Image Registry entries, Blob Records, Templates |

A tenant has no key in this table. It signs nothing, anywhere: what it holds is a secret, not an identity.

| Secret | Held by | Proves |
|---|---|---|
| Lease root secret | tenant | nothing to anybody. 32 random bytes per lease, from which every Continuation Token of that lease derives (§6.1) |
| Continuation Token | tenant **and** the provider it was derived for | to that provider alone, that whoever presents it is the party that took this lease |

- **Pinned sealing key:** a Provider Profile MUST publish its connector's sealing public key. A tenant seals to that key and refuses if the URL's self-description reports another key (ADR 0011). A **relay** pins the same three facts about itself, in its own relay information document rather than in a signed event (§13, ADR 0024), so that a party holding nothing but a relay's URL can pay for a write to it.
- **Payer vs tenant:** the provider never links a payer to a tenant. It never learns who the tenant *is* at all: a Lease Request carries a Continuation Token, and a token names nobody (ADR 0005, ADR 0016).
- **A tenant Nostr key is out of the request path.** The reserved tenant-side Deployment (§3.1.2) is signed by whatever key its tooling uses; nothing in this protocol reads one, and no provider ever sees it.

### 3.1 Event kinds

Every TOON Network kind is allocated from one contiguous block per NIP-01 class, so that a relay filter on a block is cheap and future kinds land next to the existing ones (ADR 0012). The blocks are:

| Class | Block | Allocated | Free for later kinds |
|---|---|---|---|
| Regular (`1000`–`9999`) | `4432`–`4441` | `4433` | `4432`, `4434`–`4441` |
| Replaceable (`10000`–`19999`) | `10432`–`10441` | `10432`–`10433` | `10434`–`10441` |
| Addressable (`30000`–`39999`) | `30432`–`30441` | `30432`–`30437` | `30438`–`30441` |

A new TOON Network kind MUST be taken from the free range of the block for its class, lowest number first. When a block runs out, the next block is chosen by the same collision check as §3.1.1 and recorded here.

**Two numbers were allocated and given back.** `4432` was the Lease Request and `30438` the Gateway Grant. A Lease Request is not a Nostr event any more, and a gateway's delegation is derived rather than published (ADR 0016), so both numbers are free again and a later kind takes them in the ordinary way. A freed number inside a reserved block is not a contradiction of ADR 0012: the block is still one block, and the rule is still lowest free number first.

| Kind | Constant | Event | Class | Signer | Section |
|---|---|---|---|---|---|
| `4433` | `K_EVICTION` | Eviction Notice | regular | Provider | §6.7 |
| `10432` | `K_PROFILE` | Provider Profile | replaceable | Provider | §4.1 |
| `10433` | `K_LIVENESS` | Liveness | replaceable | Provider | §4.3 |
| `30432` | `K_LISTING` | Listing | addressable, `d` = listing name | Provider | §4.2 |
| `30433` | `K_TAKEOVER` | Takeover | addressable, `d` = workload id | Provider (the warm standby) | §7.1 |
| `30434` | `K_IMAGE` | Image Registry entry | addressable, `d` = `<name>:<tag>` | Publisher | §8.1 |
| `30435` | `K_BLOB` | Blob Record | addressable, `d` = `sha256:<hex>` | Uploader | §8.2 |
| `30436` | `K_TEMPLATE` | Template | addressable, `d` = template name | Publisher | §8.3 |
| `30437` | `K_DEPLOYMENT` | Deployment | addressable, `d` = environment | Tenant | §3.1.2 |

Every event in the table carries `["L","toon.network"]`, so the whole namespace is one label. Every one of them is signed by a **Provider** or by a **Publisher**: nothing a tenant produces is an event at all, so a relay observer finds no Tenant-signed event of this protocol anywhere (ADR 0016).

#### 3.1.1 What these numbers were checked against

Checked on **2026-09-17** for `30438`, and on 2026-09-16 for every number allocated before it; no allocated number appears in any of them. `4432` and `30438` have since been returned to their blocks' free ranges, and the checks below stand for the blocks either way:

- the [NIPs kind table](https://github.com/nostr-protocol/nips#event-kinds), read from `README.md` at `master`, including NIP-69's `38383` (which is why no Paygress kind is reused) and NIP-29's `9000`–`9030` and `39000`–`39009` ranges;
- the [machine-readable registry of kinds](https://github.com/nostr-protocol/registry-of-kinds) (`schema.yaml` at `master`), which is broader than the README table. The nearest used kinds to the blocks are `4312`/`4454` (regular), `10377`/`11111` (replaceable) and `30403`/`30443` (addressable), so nothing between them is taken — `30438` included;
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

A provider publishes the events in this section to **every relay in its Relay Set**. Each event MUST carry the tag `["L","toon.network"]` so directory queries can select them. Every one of those writes is a paid packet, and where it is paid for is the relay's own to say (§13).

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
| `hidden` | bool | Hidden Provider declaration (§10). A self-assertion: nobody verifies it, and it hides where the provider is, not that it was paid — payments stay public on chain. |
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
["l", "hidden:true", "toon.network"]              when the Profile declares hidden: true (§10)
["l", "gpu:<vendor>-<model>", "toon.network"]     when resources.gpu is set (§4.4)
["t", "<capability>"]                              one per capability
["g", "<geohash>"]                                 optional region
```

A new version replaces the previous Listing event on the relay. The provider MUST keep serving the routes of every version that still has a running lease (§5).

A listing that sells no Warm Standby MUST omit `standby_price` rather than publish `0`: a price of zero would sell held capacity for nothing, and it is the presence of the field that gives the listing its standby routes (§5).

A Listing whose Provider Profile cannot be found is not purchasable.

A Listing of a Hidden Provider MUST carry `["l", "hidden:true", "toon.network"]`, and a Listing of any other provider MUST NOT carry an `l hidden:` tag at all — never `hidden:false` — so a tenant filters for hidden compute with `#l = hidden:true` and against it by the tag's absence (§4.4, §10).

A Listing whose `resources.gpu` is set MUST carry an `l gpu:<vendor>-<model>` tag equal to it, byte for byte, and a Listing where the two disagree is not purchasable (§4.4). `resources.gpu` names one device of that model; a Listing selling more than one GPU is out of scope.

### 4.3 Liveness: kind `10433` (replaceable)

- **Cadence:** one per provider, republished every `liveness_cadence_s` seconds.
- **Expiration:** it MUST carry `["expiration", now + <Liveness expiry>]`, the value §7.2's table fixes (ADR 0007).
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
| `l` `hidden:<value>` | `true` only, present exactly when the provider's Profile has `hidden: true` (§4.2, §10); a provider that is not hidden carries no `hidden:` label |
| `l` `gpu:<vendor>-<model>` | `gpu:<vendor>-<model>`, where the value after `gpu:` matches `[a-z0-9]+(-[a-z0-9]+)*` in full. `<vendor>` is `nvidia`, `amd`, `intel` or `apple`, and the vendor list grows by amendment. `<model>` is an open set within the grammar: the vendor's own model name, lowercased and hyphenated, including a memory size when the vendor sells variants, e.g. `nvidia-rtx-4090`, `nvidia-a100-80gb` (§4.2; §11, item 1, closed) |
| `t` `<capability>` | `docker`, `nesting` |

- A Listing MUST carry one `["t", "<capability>"]` tag per entry in `capabilities`, and MUST NOT carry a `t` tag for a capability it does not grant.
- A tenant MUST ignore a capability value this section does not define, and MUST NOT read an unknown value as implying a known one. A provider experimenting with a capability before it is specified here SHOULD prefix it `x-`.
- **Capability graduation.** A capability becomes specified only by an ADR plus an entry in this table; only then may a provider publish the bare name. `x-<name>` and `<name>` are distinct values forever, and a tenant MUST NOT read one as the other — a graduation never changes what an already-published `x-<name>` Listing grants.
- Capabilities are granted by the Listing alone (ADR 0004). A spawn never names one (§6.2).
- **GPU labels.** `resources.gpu` (§4.2) and the `gpu:<vendor>-<model>` label MUST carry the same value; a Listing where they disagree is not purchasable. A tenant MUST ignore a `gpu:` value that breaks the grammar above, rather than guess at what it means. `resources.gpu` names exactly one device of that model — multi-GPU counts are out of scope (§11, item 1, closed).

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
| `<addr>.rotate` | free | Rotation of the lease's Continuation Token (§6.8) |

- **Standby routes:** `<addr>.<listing>.v<n>.standby` and `<addr>.<listing>.v<n>.standby.extend` exist for exactly the listings whose Listing event carries `standby_price` (§4.2). A listing that prices no Warm Standby has neither route, and a connector MUST NOT terminate a route the provider did not price.
- **Rate limits:** the provider SHOULD rate-limit free routes.
- **Restarts:** adding or retiring a listing version is a connector config change and restart (ADR 0009).

Every response is JSON. Errors use this shape — exactly these two keys — and on a paid route they are still billed (§2):

```json
{ "error": "<code>", "message": "<human readable>" }
```

Error codes: `unknown_workload`, `wrong_listing_version`, `not_tenant`, `workload_id_taken`, `refused_image`, `no_capacity`, `no_matching_arch`, `invalid_request`, `expired`, `not_standby`, `not_running`, `stale_request`, `bad_grant`, `unavailable`.

- **`not_tenant`** is a request whose Continuation Token is not the one the lease was taken with — wrong, or absent altogether (§6.1). The two are one answer on purpose: both assert no authority over the lease, and telling them apart would leave a prober knowing which half of its guess was wrong.
- **`bad_grant` vs `not_tenant`:** `bad_grant` is a `status` whose asserted Gateway Grant does not apply to this lease (§6.5.1). **The assertion decides which of the two a request hears, not the defect:** a request naming a `gateway_expires_at` is `bad_grant`, one naming none is `not_tenant`. One says *you are not the tenant*, the other *your delegation does not apply here*, and one code covers every way a delegation can fail — so a Workload Gateway learns nothing about a lease from being refused.
- **`unavailable`** means the provider could not do this right now: nothing changed, and the tenant should retry. It is the one code that is never about the request — every other code says the request was wrong in some way, and this one can only follow every other check passing. A provider answers it when an effect it MUST make before it may confirm the request fails to happen, e.g. a write to disk (§6.8 names the first case: a rotation it cannot persist). It carries a 5xx rather than a 4xx (below), and its general form here is deliberate: a later route MAY adopt it for an effect of its own that fails the same way, rather than treat the failure as a refusal of the request.

- **The body is the contract; the HTTP status is not.** A tenant reads `error`, never the status: the connector carries the response inside an ILP packet, and whether an HTTP status survives that at all is the connector's business. A provider MAY answer a refusal with any 4xx it finds fitting (the reference provider uses 400/403/404/409/422; Appendix B's fixtures record its mapping as `response_status`), or, for `unavailable` alone, a 5xx (the reference provider uses 503) since that code is never about a mistaken request — and a tenant MUST NOT branch on it either way. `message` is for people and MAY change without notice.

---

## 6. Leases

### 6.1 Lease Request

A Lease Request is a plain JSON object carried in request bodies. Nobody signs it. It is what binds a lease to the party that bought it, and the only thing it carries about that party is a **Continuation Token** — a secret the tenant minted, which names nobody (ADR 0016).

```json
{
  "request": {
    "request_id":   "<32 bytes, hex>",
    "op":           "spawn" | "standby" | "status" | "terminate" | "rotate",
    "provider":     "<provider pubkey, hex>",
    "expiration":   <unix seconds>,
    "continuation": "<32 bytes, hex>",
    "content":      { … }
  }
}
```

- **`request_id`** is 32 random bytes chosen by the tenant, as 64 lowercase hex characters. Nothing is hashed and nothing is canonically serialised on either side, so two implementations have no serialisation to disagree about. The replay set keys on it.
- **`op`** says what the request asks for, and MUST be the one the route serves: `spawn` on `<addr>.<listing>.v<n>.spawn`, `standby` on `<addr>.<listing>.v<n>.standby`, `status` on `<addr>.status`, `terminate` on `<addr>.terminate`, `rotate` on `<addr>.rotate`. Anything else is `invalid_request`.
- **`provider`** is **exactly one** provider's public key, on every op — a spawn that forms a Standby Set included (§7). A provider MUST refuse a request naming any other key. A tenant forming a set sends one request to each member, each naming only that member.
- **`expiration`** is unix seconds. A provider MUST refuse if `now > expiration`, and SHOULD refuse if `expiration` is more than the Request window ahead of `now` (§7.2; `stale_request` for either).
- **`continuation`** is the lease's Continuation Token for this provider. It MAY be absent, which is a request asserting no authority over the lease — refused, never read as an unauthenticated success (below).
- **`content`** is the op's own JSON object (§6.2, §6.5, §6.6, §6.8). A field this spec does not name, anywhere in it, MUST be refused as `invalid_request`, never dropped (ADR 0004).

**Replay:** the provider MUST keep the `request_id`s it has accepted until their `expiration`, and refuse repeats.

#### 6.1.1 The Continuation Token

A tenant mints **one 32-byte root secret per lease** and holds it. It never leaves the tenant. From it, every token of that lease derives:

```
continuation(provider) = HKDF-SHA256(ikm = root,
                                     salt = empty,
                                     info = "toon-network-continuation:" || provider_pubkey,
                                     L = 32)
```

`provider_pubkey` is the provider's public key as **64 lowercase hex characters**, so the whole `info` is ASCII and there is nothing about byte order or encoding to guess. HKDF-SHA256 is RFC 5869; an empty salt is its own default, which extracts with 32 zero bytes. The output is 32 bytes, carried on the wire as 64 lowercase hex characters. Appendix B carries a vector.

Three properties follow, and they are the whole point (ADR 0016):

- **Both parties hold it**, so either could produce a request bearing it. Neither can prove anything to a third party with it.
- **No key pair makes it.** It names nobody, and it links to no other lease.
- **It is fresh per lease and per provider**, so two leases of one tenant share no observable value — and every member of a Standby Set holds a *different* token by construction, so one member cannot act as the tenant against another (§7).

**A provider stores `continuation(provider)` against the lease and nothing else about the tenant.** It MUST persist it with the lease across its own restarts (§6.7). A **rotation** replaces it with another token the tenant names, and from then on that one is the lease's (§6.8). It MUST NOT write it to a log, a metric or an error message: operational surfaces must not become the leak the signature was.

#### 6.1.2 Validation order

Every authenticated route runs the same four steps and refuses with the first that fails:

1. The body parses as the shape above, `op` matches the route, and `provider` is this provider — else `invalid_request`.
2. `expiration` is in the future and inside the window — else `stale_request`.
3. `request_id` is unseen — else `stale_request`.
4. `continuation` matches the token stored against the lease, compared in **constant time** — else `not_tenant`.

A wrong token and an absent one are both `not_tenant`: a request that presents no token asserts no authority, which is exactly what a wrong one does.

**Step 4 branches on `status` alone.** A request there MAY instead present a Gateway Grant derived from the lease's token and name the moment it was derived for, and §6.5.1 gives the order that admits one and the refusal it earns. No other route has that branch.


**A spawn skips step 4.** There is no stored token yet, so the presented one is stored against the new lease and becomes what every later request presents. A spawn carrying no `continuation` is `invalid_request` rather than `not_tenant`: it would buy a lease nobody could ever read, extend or stop, which is a request the tenant must correct.

**Packet body.** The request body of an authenticated route is the JSON object `{ "request": … }`: the request object above, unmodified, as the value of the single key `request`. It is not re-encoded, base64'd or wrapped further, and a body with any other key MUST be refused as `invalid_request`. This body is the HTTP body inside the connector's sealed envelope: the tenant seals the whole HTTP request to the provider's pinned `connector_seal_key` (§3, ADR 0011; connector ADR 0018), the connector unseals it and forwards plain HTTP, and the provider app reads the body as plaintext JSON and no payment header (§2).

**Fixtures.** A Lease Request per `op`, with its packet body, and the derivation vector, are in Appendix B.

### 6.2 Spawn

**Request body** on `.spawn`: `{ "request": <Lease Request, op=spawn> }`; on `.standby`, the same with `op=standby` (§6.1). The request's content is JSON:

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
1. The Lease Request passes §6.1.2: the shape, the `op` and `provider`, the window, and replay. A spawn brings the Continuation Token its Lease will keep, and there is none stored to compare it with yet.
2. The route's listing version exists, and `volume_gb` and the ports fit the listing. On `.standby` the listing MUST also price standbys: a listing with no `standby_price` sells none and has no `.standby` route at all (§4.2, §5), so a spawn that arrives on one is refused `wrong_listing_version` — the route is not on sale here, exactly as a retired version's is not.
3. **Role:**
   - With no `standby_set`, the route MUST be `.spawn`.
   - With a `standby_set`, this provider MUST be in the set. Index 0 MUST arrive on `.spawn`, and any other index on `.standby`. Which provider the request was for is §6.1.2 step 1's, not this step's: a Lease Request names one provider on every op.
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

A lease is always billed at the price for what it is doing, so each route wants the lease in the opposite state from the other:

- **On `.extend`:** the lease MUST be a running standalone or primary lease, or a standby after Takeover, and its listing version MUST equal the route's. The provider then sets `expires_at += lease_interval_s`. A lease that is instead a Warm Standby reservation is refused `not_running`: it is billed at `standby_price` on `.standby.extend`, not at `price` here.
- **On `.standby.extend`:** the lease MUST be a Reserved standby before Takeover, and its listing version MUST equal the route's. The provider then sets `expires_at += lease_interval_s`; the backend is never touched, since nothing runs for a reservation either before or after paying it. A running lease of any role — standalone, primary, or a standby after Takeover — is refused `not_standby`: it is billed at `price` on `.extend` instead.
- **Otherwise, on either route:** an unknown `workload_id` is `unknown_workload`; a lease whose listing version does not match the route's is `wrong_listing_version`; a lease that has ended is `expired`, whatever ended it.

It responds with `{ "workload_id", "expires_at" }`.

### 6.4 Availability (free)

**Request body:** `{ "listing": "<name>", "version": <n>, "image": { … }, "role"?: "primary" | "standby" }`, unsigned, where `image` is exactly the object a spawn would carry — any of §6.2's three forms, validated by the same rules (ADR 0015). A digest alone is not enough to say whether an image would run: with `registry_entry` the provider resolves it through the entry, and with `reference` through the upstream registry, and only the object says which. `role` is optional, and `primary` and `standby` are its whole vocabulary: `standalone` is a lease's role (§6.2) rather than a question — a spawn that names no Standby Set is standalone already — so it, any other value, and any field this section does not name are `invalid_request`.

**Response:** `{ "would_run": true }` or `{ "would_run": false, "error": "<code>", "message": "…" }`, always HTTP 200 — the refusal is the answer, not a transport failure.

It applies §6.2 steps 2, 5 and 6 without starting anything: `wrong_listing_version`, then the image (`refused_image`, `no_matching_arch`), then `no_capacity`. A positive answer is advice, not a reservation: a spawn that later fails is still billed (ADR 0003).

With `role: "standby"` it answers whether a Warm Standby **would be reserved** here, and reserves nothing: the listing must price standbys — one that does not is refused `wrong_listing_version`, the same answer its `.standby` route would have given — and capacity is counted with reservations subtracted, exactly as for a running lease (§6.7). Omitting `role`, or `role: "primary"`, asks the ordinary question.

### 6.5 Status (free)

**Request body:** `{ "request": <Lease Request, op=status> }`. Content:

```json
{ "workload_id": "…", "gateway_expires_at": <unix seconds, optional> }
```

The request MUST present the lease's Continuation Token (`not_tenant`, §6.1.2), **or** a **Gateway Grant** derived from it (§6.5.1), in which case `gateway_expires_at` names the moment that grant was derived for. The response has `workload_id`, `role`, `state` (§6.7), `expires_at`, `access` when present, `template` when the spawn named one (§6.2) — echoed as given, never resolved — and `takeover` once a Takeover on the workload has settled at this member (§7.1 steps 3–5): `{ "winner": "<pubkey>" }`, the member of the `standby_set` that runs the workload now. A standby that won answers it beside `state: "running"` and its `access`; one that lost answers it beside `state: "reserved"` and no `access`. So a tenant asking any member learns its role, whether a Takeover happened, and where the workload is.

#### 6.5.1 The Gateway Grant

A tenant may let **one** Workload Gateway read a lease without letting it do anything else, and without publishing anything. The **Gateway Grant** is a value derived from the lease's Continuation Token rather than an event:

```
gateway_sub(provider, expires_at) = HKDF-SHA256(ikm = continuation(provider),
                                                salt = empty,
                                                info = "toon-network-gateway:" || expires_at,
                                                L = 32)
```

`expires_at` is unix seconds written as **decimal ASCII digits, unpadded and unsigned**, so this `info` is ASCII exactly as §6.1.1's is and there is nothing about how a number was spelled to guess. Same HKDF-SHA256, same empty salt, same 32 bytes of output, carried the same way: 64 lowercase hex characters. Appendix B carries a vector.

It derives from the **token** and not from the root secret, and that is the whole of the design. A provider already stores `continuation(provider)`, so it can recompute any grant it is shown: it stores no second value, keeps nothing per gateway, reads no relay, and — a Hidden Provider included (§10) — opens no connection to check one. The tenant hands the value and its `expires_at` to the gateway out of band (§12); nothing is published, so no `workload_id` reaches a relay (ADR 0016).

**Presenting one.** The grant rides in the request's `continuation`, exactly where the lease's own token rides, and `gateway_expires_at` names the moment it was derived for. That field is named by `status` content and by nothing else: a request carrying it anywhere else — a spawn, a `standby`, either extension, `availability`, `terminate` or `rotate` — is `invalid_request`, like any other field this spec does not name (§6.1, ADR 0004).

**Verifying one.** After §6.1.2's steps 1 to 3, step 4 branches:

1. The presented value is compared against the lease's stored token in **constant time**. A match is **full authority**, and nothing below runs: a tenant is never weighed against a delegation it did not assert.
2. Failing that, and only when `gateway_expires_at` is present, the provider MUST check `now <= gateway_expires_at` **before deriving anything**. A moment that has passed is refused there, so nothing is derived for a grant that could not apply however well it was formed.
3. It then computes `gateway_sub(provider, gateway_expires_at)` from the token it stores and compares that, in **constant time**, against the presented value. A match is **read authority**, and the answer is byte for byte what the lease's own token would have been answered — a grant delegates *reading* this lease, and changes nothing about what reading it says.

**The assertion decides the refusal.** Anything that is neither is refused on what the request *claimed* rather than on what it got wrong:

- a request that asserted a delegation — `gateway_expires_at` present — is **`bad_grant`**;
- a request that asserted none is **`not_tenant`**, exactly as any other stranger's is.

One code covers every way a delegation can fail: derived for another moment, derived from another lease's token, past its moment, or never derived at all. So a Workload Gateway learns that its delegation does not apply here and nothing about the lease — not whose it is, not when it ends, not whether the grant it holds was nearly right. And the two codes stay tellable apart, because `not_tenant` says *you are not the tenant* while `bad_grant` says *your delegation does not apply here* (§5).

**What it admits.** `status`, and nothing else. `terminate` requires the lease's own token (§6.6), and the shape is what says so rather than a rule: a `terminate` carrying `gateway_expires_at` is `invalid_request`, and one without it presents a value that is not the lease's token, which is `not_tenant`.

**Rotation of the grant; revocation by rotating the token.** A grant rotates by re-derivation at a new `expires_at`: the tenant derives a second value and hands it over (§12), and the one it replaces keeps working until its own moment passes. Nothing moves, nothing is published, and the provider is not told. Re-deriving revokes nothing, because both values derive from the same token. **What revokes a grant is rotating the lease's own Continuation Token** (§6.8, ADR 0018): a provider recomputes every grant from the one token it stores, so once it stores another, every grant derived from the old one is `bad_grant` at once, with nothing kept per gateway. A grant has no revocation of its own, and a rotation ends every grant of the old token together, so a tenant still SHOULD derive grants for the shortest `expires_at` it can live with and hand out new ones.

### 6.6 Termination (free)

**Request body:** `{ "request": <Lease Request, op=terminate> }`. Content: `{ "workload_id": "…" }` — that key and no other.

The request MUST present the lease's own Continuation Token (`not_tenant`, §6.1.2). The provider destroys the workload or releases the reservation immediately. There is no refund.

A Gateway Grant is **not** enough here: it admits `status` and nothing else (§6.5.1). There is no `gateway_expires_at` in this content, so a Workload Gateway that asserts its grant here is refused `invalid_request` for a field this route does not name, and one that asserts nothing presents a value that is not the lease's token, which is `not_tenant` exactly as any other stranger's is. Step 4 does not branch on this route.

It responds with `{ "workload_id", "state" }`, where `state` is `{ "ended": "termination" }` (§6.7), so a tenant needs no second call to see that its lease is over. A lease that has already ended, however it ended, is `expired` (§6.3); a workload id this provider never leased is `unknown_workload`.

### 6.7 Lease states and endings

```
standalone:           Provisioning ──▶ Running ──▶ Ended(expiry | termination | eviction)
primary:              Provisioning ──▶ Running ⇄ Stopped ──▶ Ended(…)
standby:              Reserved ──takeover──▶ Running ──▶ Ended(…)
                      Reserved ──▶ Ended(expiry | termination | eviction)
```

- **On the wire** (`.status`, `.terminate`), `state` is a string for a state with nothing to say and a one-key object for one that has an ending: `"provisioning" | "reserved" | "running" | "stopped" | { "ended": "expiry" | "termination" | "eviction" }`. `provisioning` is a lease that is paid and holds its workload id and capacity while its workload starts; a tenant that sees it polls `.status` again.
- **Reserved:** a Warm Standby before Takeover: the capacity is held and paid for, nothing runs, and the answer carries no `access`. The `takeover` edge does not change the role — a standby that runs its workload still answers `role: "standby"` — and adds `takeover.winner` to the answer of every member the race settled at (§6.5), the losers included, which stay `Reserved`.
- **Stopped:** a primary that stopped its own workload under §7.1's self-stop rule. The lease is live and paid to its `expires_at` like any other — it holds its capacity slot and its `workload_id`, `.extend` still adds an interval at the running price, and the sweep still ends it — but the workload is off, so the answer carries no `access`. Only a primary reaches it, and only §7.1 moves a lease into or out of it. A provider MUST persist it: a restart must not start again what the rule stopped.
- **Reservations count:** a `Reserved` lease holds its `workload_id` and its capacity slot exactly as a running one does, so Liveness `available` (§4.3) and `availability` (§6.4) both subtract it.
- **Expiry:** the provider MUST sweep at least as often as the Expiry sweep floor §7.2 fixes, and end every lease with `expires_at <= now`. There is no grace period (ADR 0003).
- **Eviction:** a provider MAY evict a lease for abuse, policy or maintenance. It MUST publish an Eviction Notice.
- **Eviction Notice** (kind `4433`, regular): published to the Relay Set, with content `{ "workload_id": "…", "reason": "<code>", "message": "…" }` and tags `["x", "<workload_id>"]` and `["L", "toon.network"]` (the label every TOON Network event carries, §4). `reason` is one of `abuse` (the workload abused this provider or something reachable from it), `policy` (it broke a policy the provider states outside this protocol), `maintenance` (the provider needs the capacity back) or `other`; `message` says what happened in words; with `other` it is all a reader has to go on, so it SHOULD not be empty. A reader MUST NOT refuse a notice for a `reason` it does not know: a later version may add one.
- **Persistence:** the provider MUST persist running leases and reservations across its own restarts, each with the Continuation Token it holds now — the one a rotation installed, if there was one (§6.1.1, §6.8). A restart that forgot the token would leave a paid workload running that nobody could read, extend or stop.

### 6.8 Rotation (free)

A tenant may replace the Continuation Token a provider holds for a lease — because it believes the token has leaked, or to cut off every Workload Gateway it delegated reading to — without respawning. This is the only way a token, or any Gateway Grant derived from it, stops working before the lease ends (ADR 0018).

**Request body:** `{ "request": <Lease Request, op=rotate> }`. Content:

```json
{ "workload_id": "…", "next": "<32 bytes, hex>" }
```

— those two keys and no other. `next` is the token the lease holds from now on, as 64 lowercase hex characters. The request MUST present the lease's **current** token.

**Effect.** The provider replaces the stored token with `next` and **MUST persist the lease before it answers**, so a crash straight after a rotation cannot bring the old token back. From that moment the old token is `not_tenant` on every route, and every Gateway Grant derived from it is `bad_grant`, because a provider recomputes a grant from whatever token it stores (§6.5.1). The provider keeps no second value, there is **no grace period**, and nothing is published. Nothing else about the lease changes: its role, state, `expires_at`, `access`, `template` and Standby Set are what they were.

A rotation is a revocation, so the provider MAY say `rotated: true` only once `next` is on disk. **If the persist fails, the provider MUST restore the token it found in memory and answer `unavailable`** (§5) instead of `rotated: true`: nothing changed, the old token still works — in memory and on disk, before the failed persist and after a restart alike — and the tenant retries with the same `next` once saving works again.

**Response:** `{ "workload_id", "rotated": true }`. It carries no token, old or new.

**Validation**, in order, refusing with the first failing code:

1. §6.1.2 steps 1 to 3: the shape, the `op` and `provider` (`invalid_request`), then the window and replay (`stale_request`).
2. The content is exactly `{ workload_id, next }`, and `next` is 64 lowercase hex characters — else `invalid_request`. `gateway_expires_at` is a field this content does not name (§6.5.1), so a Workload Gateway that asserts its grant here is refused on the shape.
3. `workload_id` names a lease this provider holds — else `unknown_workload`.
4. §6.1.2 step 4: `continuation` is the lease's own token, compared in constant time — else `not_tenant`. **Step 4 does not branch on this route**, exactly as on `terminate` (§6.6): a Gateway Grant presented without `gateway_expires_at` is a value that is not the lease's token, and only the lease's own token may rotate it, so a gateway can never rotate a lease out from under its tenant.
5. The lease has not ended, however it ended, an `expires_at` already past included — else `expired` (§6.3). The tenant learns the lease is gone rather than that its token is wrong.
6. `next` is not the token the lease already holds — else `invalid_request`: a no-op must never look like a success. It is weighed only after step 4, so the answer says nothing to a request that does not already hold that token.
7. The lease is persisted with `next` in place — else `unavailable`. Unlike steps 1 to 6, this is not about the request: every input has already been proven good, and only the write can still fail.

A lease that is `provisioning`, `running`, `stopped` or `reserved` can be rotated (§6.7). Like the other free routes, `rotate` SHOULD be rate-limited (§5): every rotation it accepts is a write.

**Where `next` comes from.** The provider cannot tell how `next` was made and does not check. A tenant SHOULD mint a **fresh root secret** for every rotation and derive `next = continuation(provider)` from it with §6.1.1's formula, so the rotation retires the old root secret as well: if that is what leaked, it now derives nothing that works. A tenant's tooling records the new root secret against the lease.

**A Standby Set is rotated member by member.** One rotate request per member, each naming only that member and presenting only that member's token, exactly as every other request (§6.1, §7). Tokens are per member already, so a set rotated at some members and not yet at others is a valid state that breaks no invariant, and a member the tenant cannot reach right now does not block the others. A rotation at one member changes nothing at any other. The tenant keeps both root secrets until every member has confirmed.

**A lost answer.** A rotate is not retried to find out whether it worked: the same request again is `stale_request`, and a new one presenting the old token after the first took effect is `not_tenant`. A tenant that did not see the answer sends `status` presenting `next`: acceptance means the rotation took effect, and `not_tenant` means it did not and the old token still holds. `unavailable` is not a lost answer — the request WAS answered, and refused — so a tenant that sees it retries directly with a fresh request presenting the same token and naming the same `next`, rather than asking `status`.

**Workload Gateways.** After a rotation, every rotated member refuses a grant of the old token `bad_grant`. A tenant that wants to keep its gateway derives grants from the new tokens and hands them over again (§12.1), and the ordinary admission round replaces what the gateway holds; rotating and changing gateways are separate choices.

---

## 7. Warm Standby

- **Standby Set:** every lease in a Standby Set is spawned with the same `workload_id` and the same `standby_set` list. Index 0 is the primary. A provider's role comes from its position in the list.
- **One spawn content, one request per member:** the tenant sends the same spawn **content** to every member, in a request of its own for each — naming only that member in `provider`, presenting only that member's Continuation Token, and carrying the `op` its route serves (§6.1). Nothing in the content singles out a member, so a provider's role is its position together with the route the request was paid on (§6.2 step 3): the primary's spawn is bought on `.spawn` at `price`, each standby's on `.standby` at `standby_price`.
- **A token per member:** because `continuation(provider)` derives under the member's own key (§6.1.1), every member of the set holds a different token. One member therefore cannot read, extend or terminate another member's lease, which one shared secret would have let it do.
- **A reservation is a lease:** a Warm Standby's lease is `Reserved` from the spawn (§6.7). It holds its `workload_id` and its capacity slot, is persisted across the provider's restarts, expires on the sweep if nothing pays it, and is released by a Termination — all without the provider ever starting anything.
- **Membership changes:** changing membership means new spawns under a new `workload_id`.

### 7.1 Takeover (ADR 0010)

A standby watches the primary's Liveness on the **primary's** Relay Set, read from the primary's Provider Profile.

1. **Trigger:** the primary's Liveness is expired or absent on a strict majority of that Relay Set (one of one, two of three), continuously for the Takeover trigger §7.2 fixes. A relay the standby cannot read holds no Liveness it can see, and counts as absent — and so does a relay the standby **MUST NOT dial** (§8.4): a Profile is a published event, so the relays it lists are the primary's own choice, and one that points inside the standby's network is refused there and counted as silence here. The primary's other relays are still read. A majority that is live again inside the cadence, even once, restarts the count.
2. **Announce:** the standby publishes a Takeover event to the primary's Relay Set.
   - Kind `30433` (addressable), `d = <workload_id>`. Addressable, so a standby leaves one claim per workload rather than a history, and step 3 reads a set of claimants.
   - Content: `{ "workload_id": "…", "primary": "<pubkey>" }`, where `primary` is the hex pubkey at `standby_set[0]`.
   - Signed by the **standby** that claims the workload, never by the primary.
3. **Settle:** the Settle window §7.2 fixes, after its **own** announcement — the cadence being the primary's, as its Profile states it — the standby queries kind `30433` events for `d = <workload_id>` from **pubkeys in `standby_set`**, on the primary's Relay Set, where every claim was published. Events from any other signer are ignored, and so are claims whose `primary` is not the primary this round is against: a claim naming an earlier primary belongs to an earlier race, already settled. The standby's own claim counts whether or not a relay returns it. The winner has the earliest `created_at`; a tie goes to the lower index in `standby_set`. Nothing starts before the window has elapsed, however early the other claims are visible.
4. **If it won:** the standby starts the workload from the image exactly as a spawn would, and the lease becomes Running; `status` reports `running`, `access` and `takeover.winner` (§6.5). Winning buys no time: from then on the lease needs a `.extend` (full price) before its current `expires_at`, or the sweep ends it with `expiry`. `.standby.extend` is refused `not_standby` (§6.3).
5. **If it lost:** the standby stays Reserved — still paid on `.standby.extend`, still refused `not_running` on `.extend` — reports `takeover.winner`, and watches the winner as its new primary: the winner's Profile, the winner's Relay Set, a fresh count of silence. It forgets its own claim, so that if the winner goes silent too it announces again, naming the winner as `primary`, and the set survives a second failure.

**Primary self-stop:** a primary that cannot publish Liveness to a strict majority of its own Relay Set for the Primary self-stop §7.2 fixes MUST stop its workload, so that a partitioned primary does not keep running beside a Takeover.

- **Counting:** each publication of Liveness (§4.3) reports which relays of the Relay Set took it; a cadence counts against the primary unless a strict majority took it. A publication that could not be attempted at all counts the same way: no relay took it. One publication that reached a majority, anywhere inside the five, restarts the count. A provider with no Relay Set has no majority to lose and is not bound by the rule.
- **Which leases:** every lease it holds as the primary of a Standby Set. A standalone lease (§6.2) is never stopped by this rule: no standby is waiting to take it over.
- **Stopping is not ending:** the lease stays paid until `expires_at` and stays a lease — `status` answers `stopped` (§6.7) with no `access`, `.extend` still adds an interval at the running price, and the expiry sweep still ends it. The tenant is charged nothing extra for the stop.
- **Restarting:** on regaining a majority, the primary MUST query kind `30433` for `d = <workload_id>` from pubkeys in the lease's `standby_set`, on its own Relay Set. Only if none exists may it start the workload again. If one exists, the workload stays stopped for the rest of the lease: the set has moved on, and the provider SHOULD record that so no later reading starts a second copy beside the new primary's.
- **After a restart of the provider:** a provider that comes back holding a primary lease with a `standby_set` MUST make the same query before it treats that lease's workload as live, and stop the workload if a Takeover exists. A provider whose process was down is the partition this rule is about, and it counted no cadences while it was.

**No state moves on Takeover.** The standby starts from the image, and data replication is the workload's own job.

### 7.2 Timing constants

Every timing value in this protocol is fixed here, in one normative table, in units of the primary's own `liveness_cadence_s` (**c**) or in seconds. §4.3, §6.1, §6.7 and §7.1 apply these values; this is where they are set, and where a second implementation reads all of them from one place rather than five sections.

| Constant | Value | Chosen by |
|---|---|---|
| Liveness cadence *c* | `liveness_cadence_s` | provider, in its Profile |
| Liveness expiry | 5*c* after `created_at` | protocol |
| Takeover trigger | expired on a strict majority for 1*c* | protocol |
| Settle window | 2*c* from the standby's own announcement | protocol |
| Primary self-stop | 5 consecutive cadences without a majority | protocol |
| Request window | `expiration` ≤ now + 300 s | protocol |
| Expiry sweep | at least every 30 s | protocol (a floor, not a period) |

Only `liveness_cadence_s` is a provider's to choose, in its Profile (§4.1). Every other row is fixed by the protocol, so two members of a Standby Set run by different operators agree on when a Takeover happens without agreeing on anything else. The values are unchanged from earlier milestones (§11, item 3): this section makes them normative and does not re-tune any of them. **Changing any one of them is an ADR.**

**The invariant.** self-stop (5*c*) ≤ liveness expiry + trigger (6*c*) < Takeover start (6*c* + 2*c* = 8*c*). A primary that has failed to reach a majority of its own Relay Set for 5*c* has already stopped its workload (self-stop) before any standby's Takeover can start: a standby's own trigger cannot fire before the primary's Liveness has been silent for one cadence beyond its expiry (6*c*), and the settle window it then waits out runs a further 2*c*, to 8*c*. So in the idealised case — clocks and relay reads landing exactly on the cadences they are due — a stopped primary is never running beside the standby that takes over. **ADR 0010's "may briefly run two copies" is amended to say so:** it survives only for clock skew and relay lag that carries the primary or a standby's view of it past a cadence boundary the other has not yet reached, never as the ordinary case.

**The outage window.** From self-stop (5*c*) to Takeover start (8*c*) is about 3*c* in the idealised case, during which the workload runs nowhere: the primary has stopped it and the standby has not yet started it. A Workload Gateway resolving in this gap hears every member answer about the lease with nothing running, so it answers `503 no_running_member` (§12.3, §12.4) — not `member_unreachable`: every member is reachable and answered, and none of them is the target yet. §12.7's "What a tenant sees" states the same figure for a tenant.

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

- **Blob list:** `blobs` MUST list every blob reachable from `digest`: the index, the manifests, the configs and the layers. This is the publisher's obligation, and a publishing tool MUST refuse to sign an incomplete entry; a provider does not refuse an entry for omitting a blob, it resolves that blob through the rest of §8.4's chain and fails only when nothing serves it.
- **Tag:** `["x", "<digest hex>"]` — the hex ALONE, with no `sha256:` prefix, so an `#x` filter is over the same string whatever wrote it.
- **Source:** `type` is `"toon-store"` or `"oci"` and nothing else in v1; a reader MUST refuse a source type it does not know rather than skip the blob.
- **Moving a tag:** re-publishing the same `d` points the tag at a new image.

### 8.2 Blob Record: kind `30435` (addressable)

Signed by whoever uploaded the parts, with `d = "sha256:<hex>"`.

Content is JSON, in ONE of two shapes. Today's, inline:

```json
{ "digest": "sha256:…", "size": 31457280, "part_size": 102400,
  "parts": [ { "txid": "…", "sha256": "…", "size": 102400 } ] }
```

Or, for a blob whose part list does not fit one TOON store data item (about 700 parts at 100 KiB, roughly 70 MB — Milestone 7, #73), paged:

```json
{ "digest": "sha256:…", "size": 78643200, "part_size": 102400,
  "pages": [ { "txid": "…", "sha256": "…", "parts": 700 }, { "txid": "…", "sha256": "…", "parts": 68 } ] }
```

- **Tag:** `["x", "<hex>"]` — as in §8.1, the hex with no `sha256:` prefix. `d` keeps the prefix; the tag does not.
- **One of `parts` or `pages`, never both, never neither.** A record carrying both, or neither, is invalid: no reader trusts either field of it, and §8.4's chain treats the whole record as a source that failed, moving on to the next one exactly as it does for a record whose parts fail their own checks.
- **`parts` (inline):** each is stored as one TOON store upload (`kind:5094`), and `parts` is ORDERED: a reader concatenates them as they appear and checks the result against `digest`. A part's `sha256` is bare hex, with no `sha256:` prefix — a part is not content-addressed the way a blob is.
- **`pages` (large blob, §11 item 2):** an ORDERED array of `{ "txid", "sha256", "parts" }`. Each page is ONE TOON store upload of its own, whose bytes are a JSON array of part objects — in exactly `parts`' own shape, `{ "txid", "sha256", "size" }` — covering that slice of the ordered part list. `sha256` is the bare hex digest of the PAGE's own bytes (the JSON array itself, not any part it lists); `parts` is how many part objects that array holds. A reader fetches each page and checks its `sha256` — and that parsing it really finds `parts` part objects — BEFORE trusting a single part from it, then concatenates the pages' part lists in page order into the same ordered list `parts` would have been. Every rule below then applies unchanged: `part_size`, the parts' sizes summing to `size`, each part's own check, and the whole blob's digest. There is no new event kind and no change to an Image Registry entry: `blob_record_txid` still names the Blob Record itself, whichever shape its content takes, and a provider MUST read both.
- **`part_size`:** the size every part but the last has. The last part is the remainder, so the parts' sizes MUST sum to `size` — true of the ordered part list either shape yields.
- **Where it lives:** the Blob Record is published to relays, and the same signed event JSON is also uploaded once to the TOON store. That upload's transaction id is the `blob_record_txid` used in Image Registry entries (ADR 0006). A page's upload is separate from both: it is not signed, and nothing about it is addressable — a reader has it only by the txid the record's own content names.

### 8.3 Template: kind `30436` (addressable)

Signed by the publisher, with `d = <template name>`.

- **Content:** `{ "version": n, "image": { "digest", "registry_entry"? }, "ports": [ { "container_port", "protocol" } ], "data_path"?, "env_fixed": {…}, "env_tenant": ["NAME", …], "min_resources"?: { "cpu_millicores", "memory_mb", "storage_gb", "gpu"? } }`
- **Shapes it borrows:** `image` is §6.2's registry-entry or digest-alone form (never the upstream one — a Template names an image by content address); `ports` is a spawn's `ports` (§6.2); `min_resources` is a Listing's `resources` (§4.2), read as a floor for choosing a Listing rather than as a rule on any provider.
- **No capabilities:** a Template grants nothing (ADR 0004).
- **Not actions:** a Template describes a spawn only. Reusable CI actions are out of scope for TOON Network and belong to rig, outside the `toon.network` label (ADR 0014).
- **Who expands it:** in v1 the **tenant** expands a Template into a spawn. The provider never reads Templates, and `template` in a spawn is informational (§11, item 5).

### 8.4 Resolving and fetching an image (provider)

For each blob the provider needs, it tries these sources in order, and stops at the first that yields bytes matching the digest:
1. **Local cache.**
2. **The spawn's `registry_entry`**, if present and if the entry lists that blob: its `source`. A blob the entry omits is not an error; the chain continues.
   - For `toon-store`, fetch the Blob Record by `blob_record_txid`, then its parts.
   - For `oci`, pull by digest from that registry.
3. **Blob Records on its Relay Set:** those found by `#x = <hex>`.

A fetch MUST:
- for a PAGED Blob Record (§8.2, §11 item 2), first read each page from the configurable gateway pattern and check its `sha256` and its `parts` count, before trusting a single part it names; a page that cannot be fetched, or fails either check, fails the record exactly as a bad part does;
- read each part from that same pattern, e.g. `{gateway}/raw/{txid}`;
- check each part's `sha256` and size;
- concatenate the parts in order — a paged record's, page by page, part list by part list, exactly as an inline record's;
- check the whole blob's digest.

A reader MUST NOT trust a declared size — a Blob Record's `size`, a part's or a page's — before it is verified, and MAY bound what it reads: how much it reserves for a blob before fetching a single part, and how much of any one read it accepts, so that neither a record's own numbers nor a source's behaviour can force it past its means (Milestone 7, #79). Before fetching a single page, a reader also MUST check a paged record's page count and each page's `parts` against the part count `size` and `part_size` already imply (§8.2) — the same check an inline record's `parts` length gets — so a record cannot force an unbounded number of page reads merely by listing more pages than its own `size` could ever hold parts for.

A blob that fails verification is discarded, and the next source is tried — a Blob Record carrying both `parts` and `pages`, or neither (§8.2), is discarded the same way, without either field being trusted. A blob that no source can serve fails the spawn with `refused_image`, or `no_capacity` if the disk is full. Verified blobs SHOULD be cached across leases. `availability` (§6.4) answers for a paged Blob Record exactly as it does for an inline one: asking stays free and accurate either way.

**A provider MUST NOT fetch an image from an address that is not publicly routable** (ADR 0022). A tenant's `image.reference` names the registry the provider dials, and an entry's `oci` source names another, so every outbound host of a fetch — the registry, the token endpoint a `401`'s `WWW-Authenticate` realm names, and every redirect — is checked against the address it resolves to, not against its name: loopback, link-local (including the `169.254.169.254` a cloud instance's metadata service answers on), private, unique-local, multicast and unspecified addresses are refused, in v4 and v6. The check MUST be made on the address that is then dialled, so that a name resolved twice cannot pass the check with one answer and be connected with another. A realm MUST also be `https`. Redirects MUST be capped. A refused source fails **that source**, and the chain above continues; when nothing is left the spawn is `refused_image`, and the message names **the source that was refused, never the address it resolved to** — what a name resolves to inside a provider's network is not something a tenant may learn by asking. `availability` (§6.4) refuses identically and for free, which is the point: the free route is the cheapest place to abuse this. An operator who runs a registry inside their own network MAY exempt named hosts or CIDRs by configuration; the exemption is the operator's own, it is empty by default, and it is not reachable by any tenant.

**The same rule covers the `relay` hint** a spawn's `registry_entry` carries (§6.2, ADR 0022). It is a URL the tenant chooses and the provider dials as a websocket to read the entry, so it is the same exposure over a different transport and it is equally free on `availability`. A relay hint MUST be `ws` or `wss`, and it MUST be refused **before the connection is attempted** unless the address it reaches is publicly routable, by the same reckoning as above. Where a provider's websocket client resolves the name itself — so that resolving once and dialling what was checked is not available — the provider MUST resolve the name before dialling and refuse unless **every** address it answers with passes, and MUST refuse a name that does not resolve at all rather than dial it. The refusal names **the hint as the tenant wrote it, never the address it resolved to**; it fails that source, the chain above continues, and a spawn left with no source is `refused_image`, which `availability` reports identically. A provider's **own** Relay Set (§4) is operator configuration and is unaffected: a hint at a relay the provider already publishes to is dialled, wherever that relay is. A Hidden Provider (§10) reaches every relay through `anon`, which resolves each name, so it checks address literals only — the same trade its image fetches make.

**The same rule covers the relays another provider's Profile lists** (§4.1, §7.1, ADR 0022). A Warm Standby reads its primary's Profile and dials the `relays` it names — to read that primary's Liveness, to announce a Takeover and to settle one — and a Provider Profile is a published event that anybody can sign, so those URLs are chosen by a **peer** exactly as freely as a hint is chosen by a tenant, and they are dialled on a schedule for as long as the reservation lasts rather than only when somebody asks. A relay a peer names MUST be judged by the paragraph above, in full: `ws` or `wss`, refused before the connection is attempted unless the address it reaches is publicly routable, every address a name answers with passing, a name that does not resolve refused rather than dialled, the provider's own Relay Set unaffected, and a Hidden Provider checking literals only. A refused relay MUST fail **that relay** and not the Profile: the provider still reads the peer's other relays, and the refused one counts as **absent** wherever §7.1 counts silence, exactly as a relay that cannot be reached does. Refusing the whole Profile instead would let any peer make itself impossible to take over by naming one relay nobody may dial — it would never be watched, never be found silent, and would hold a tenant's workload to the end of the lease — and it is the standby's own reading that is protected here, not the peer's standing in the set.

A provider that does not implement this resolution at all answers `refused_image` for both Image Registry forms of §6.2's `image`, with a message saying so — never `invalid_request`, which would send a tenant to fix a request that is already correct. Whether the refusal is that or exhaustion of the chain above, it MUST come before capacity is counted and before anything is created, so `availability` (§6.4) reports it for free. The `{ reference, digest }` form consults none of this: the provider pulls `reference@digest` from the named registry and verifies the digest there.

---

## 9. Workload rules

- **v1 workloads are OCI containers** (ADR 0001 scope; Paygress Docker backend).
- **Access:** SSH uses only the tenant's `ssh_public_key`. Ports are exposed as `host:host_port`.
- **Hostnames and TLS:** outside the provider protocol. A provider never owns a domain, runs ACME or terminates TLS, and never holds a tenant's certificate key. A stable HTTPS name for a workload is the job of a **Workload Gateway**, a separate TOON app keyed by `workload_id` (§12; ADR 0013, *Accepted*). A tenant that grants no gateway terminates HTTPS inside its own workload, which needs nothing of this protocol and remains the floor.
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

A Hidden Provider's Listings each carry `["l", "hidden:true", "toon.network"]` (§4.2), so a tenant can filter for or against hidden compute by tag alone; a tenant that wants a hidden lease reaches the connector through a `socks5h://` proxy, and its access details name a per-lease `.anyone` host in place of an IP (§6.2).

A lease's address is created before its workload starts and answers on the same `ssh_port` and `host_port`s the access details give, so a tenant dials it exactly as it would an IP. It is destroyed when the lease ends, however it ends (§6.7), and a provider that restarts MUST re-establish each live lease's address rather than publish a new one: a tenant was given that host at its spawn. A lease that kept nothing to re-establish its address from SHOULD be given a fresh one rather than left unreachable, and a lease whose address a provider can no longer account for MUST answer `status` (§6.5) with no `access` rather than name a host nothing answers on; either way `status` is where a tenant reads whichever address is current. A `Stopped` primary (§7.1) keeps its address — stopping is not ending — and a Warm Standby's reservation has none until a Takeover starts its workload.

`hidden` is a **self-assertion**: nothing in this protocol, and nobody outside the provider, verifies that the conditions above hold. A provider's own startup gate is the only check, and it checks configuration, not behaviour. The flag hides where a provider is, not that it was paid: payments still reveal who paid whom on a public chain (ADR 0008).

A Hidden Provider's workload MAY be given a public name by a Workload Gateway (§12.8). That reveals the **workload** — that it exists, and its traffic pattern, to the gateway and to whoever reaches the name — and not the provider: the gateway is an ordinary client of the per-lease `.anyone` address, and learns nothing about where the provider is that the tenant's own client would not. It is the tenant's choice to make, by delegating `status` to a gateway (§6.5); nothing a provider does or publishes makes it, and a provider stays hidden whether or not its tenants make it.

---

## 11. Open items

1. **Label vocabulary. Closed, 2026-09-22 (Milestone 7, #72).** §4.4 fixed `isolation`, `arch`, and the `docker` and `nesting` capabilities; it now also fixes `gpu:<vendor>-<model>` and how a capability graduates from `x-`. The GPU grammar is `[a-z0-9]+(-[a-z0-9]+)*`, `<vendor>` is `nvidia`, `amd`, `intel` or `apple` and grows by amendment, and `<model>` is an open set within the grammar, e.g. `nvidia-rtx-4090`, `nvidia-a100-80gb`. A Listing's `resources.gpu` MUST equal its `gpu:` label or it is not purchasable, a tenant MUST ignore a label that breaks the grammar, and `resources.gpu` names one device — multi-GPU is out of scope. A capability becomes specified only by an ADR plus a §4.4 entry, after which a provider publishes the bare name; `x-<name>` and `<name>` stay distinct forever, so a graduation never changes what an old Listing grants.
2. **Large Blob Records. Closed, 2026-09-22 (Milestone 7, #73).** A Blob Record's content now carries **either** `parts` (unchanged) **or** `pages` — never both, never neither. `pages` is an ordered `{ "txid", "sha256", "parts" }` array; each page is one further TOON store upload of its own, a JSON array of part objects in `parts`' own shape, and `sha256` is the bare hex of the page's own bytes. A reader fetches and digest-checks every page, and its `parts` count, before trusting a single part from it, then concatenates the pages' part lists in page order into the same ordered list `parts` would have been — after which `part_size`, the size sum, every per-part check and the whole-blob digest (§8.4) apply unchanged. No new event kind and no change to an Image Registry entry. A record with both forms, with neither, or with a page that cannot be fetched or fails its digest, fails that source and §8.4's chain moves on; `availability` (§6.4) answers a paged blob exactly as an inline one. The publisher tool switches to `pages` on its own once the inline record would not fit one store data item (about 700 parts, ~70 MB); the switch point is the tool's own choice and is not normative, and small blobs keep inline `parts`.
3. **Timing constants. Closed, 2026-09-22 (Milestone 7, #71).** They were first guesses; they are normative now. **§7.2** states one table — the request window, the sweep floor, the takeover trigger, the settle window and the primary self-stop, all as multiples of the provider-chosen `liveness_cadence_s` where §7.1 and §6.7 already had them — the invariant that keeps a partitioned primary from running beside the standby that takes over, and the outage window (about 3*c*) a Workload Gateway spends answering `no_running_member` (§12.3, §12.7). The values themselves are unchanged; changing one is its own ADR. ADR 0010 is amended to state the invariant and where "may briefly run two copies" still applies.
4. **Runtime route writes. Closed, 2026-09-22 (Milestone 7, #71), out of scope.** The connector has none for terminated routes, so every listing change still restarts it (ADR 0009). A runtime write is the connector's mechanism to build, not this protocol's, so TOON Network stops tracking a change it cannot make; the connector repository owns it if it is ever built.
5. **Template expansion. Closed, 2026-09-22 (Milestone 7, #71).** The tenant expands a Template into a spawn; a provider never reads one, and `template` in a spawn stays informational (§8.3). The earlier walkthrough that described a provider reading a Template does not describe v1.
6. **Hostnames and TLS. Closed, 2026-09-17 (Milestone 5, #46).** They stay out of the provider protocol and belong to a **Workload Gateway** keyed by `workload_id`, which **§12** now specifies in full — what a gateway is, how it is told what to serve, the canonical hostname it derives, its error page, resolution across a Standby Set, what a forwarded request carries, a readable name, how it follows the workload through a Takeover, and a workload on a Hidden Provider. The authority it needed is a **delegation of `status`** (§6.5). ADR 0013 is *Accepted*. Milestone 6 (#56) changes how that delegation is carried — a **Gateway Grant** derived from the lease's Continuation Token and handed to the gateway directly (§6.5.1), rather than an event the tenant signs and publishes — without reopening the decision. What a gateway is told besides the grant, chiefly which of a spawn's `ports` is the HTTP one, travels with it in the **Gateway Handover** that milestone's later tickets specify.
7. **Later rounds.** Reputation receipts, auditor labels, streaming state to standbys, Lading as a blob source, more tokens, and KVM workloads.

---

## 12. Workload Gateway

A **Workload Gateway** fronts a workload at a stable hostname, resolving its `workload_id` to whichever provider is currently running it (ADR 0013). It exists because the stable identifier in this protocol is the workload id and not the provider: a Standby Set shares one workload id across several providers, and a Takeover moves the workload to a different provider, with a different host and a different assigned port, with no tenant online to help (§7.1, ADR 0010). A name owned by a provider names something that can move out from under it.

A gateway is an ordinary TOON app, reached through its own connector. **Nothing in §4–§10 changes for it.** It is not a party to a lease: it holds none, buys none, extends none and ends none, it pays for nothing, and it calls no paid route (§5). It signs nothing and publishes nothing, so it needs no key of its own at all. Its whole authority over a workload is a **Gateway Grant** (§6.5.1), and the whole of what that authority buys is reading `status` (§6.5).

A tenant may run its own gateway or use somebody else's. A gateway that terminates TLS **reads the traffic it fronts**; that is the cost of the name, and it is one party the tenant chooses rather than every provider the tenant happened to buy standby capacity from.

### 12.1 Being handed a workload

A gateway learns what to serve in **one sealed packet**. A tenant seals a **Gateway Handover** to the gateway's connector, exactly as it seals a Lease Request to a provider's (§6.1.2, ADR 0011): the connector unseals the envelope and forwards plain HTTP, and the gateway reads the body as plaintext JSON. The body is `{ "handover": … }` — that key and no other:

```json
{
  "handover": {
    "workload_id": "…",
    "standby_set": [ { "provider": "<pubkey, hex>", "grant": "<32 bytes, hex>" }, … ],
    "http_port":   <container port>,
    "expires_at":  <unix seconds>,
    "name":        "<one DNS label, optional>"
  }
}
```

- **`standby_set`** is the lease's Standby Set in its own order, **primary first** (§7), and every member carries the Gateway Grant derived **for its own key** (§6.5.1). One value per member is not redundancy: `gateway_sub` derives from `continuation(provider)`, which derives under that member's key, so a single value would admit the gateway at exactly one member while §12.4 asks all of them. They share the one `expires_at`, which is what makes rotating them a single act.
- **`http_port`** is which of the spawn's container ports is the HTTP one (§12.4 step 5). The tenant chose it and a provider reads it never, so nowhere but the handover can carry it.
- **`expires_at`** is the moment those grants were derived for, and the moment the workload stops being served at (§12.3, §12.7).
- **`name`** is a readable hostname to serve the workload at besides its canonical one (§12.6).
- A field this specification does not name MUST be refused, never dropped (ADR 0004).

Nothing here is signed and nothing is published, so **there is nothing to find on a relay and nothing to verify**. A gateway reads a relay on a workload's account for exactly two things, both of them downstream of a handover it has already accepted: the Provider Profiles of the members that handover names (§12.4) and the Takeovers that move the workload between them (§12.7).

**Anyone can seal a handover.** The envelope is unauthenticated by design, so that a receiver can fabricate one "from" anybody (ADR 0011; connector ADR 0018). That is not a weakness to be patched here; it is the premise of what follows.

#### Admission

Milestone 5 said that a grant handed over by a request MUST NOT put a workload on a hostname, because publishing was what a tenant did to choose a gateway and being sent something was not. Nothing is published now, so that rule has nothing left to protect. It is **replaced**, not deleted, and the replacement is empirical:

> A handover MUST NOT put a workload on a hostname until **one round of `status` to the members it names has been accepted by at least one of them**. A gateway MUST make that round **immediately**, and MUST make **at most one**. A handover no member accepts MUST be refused, logged and **dropped**: it is not retried, not queued and not remembered.

**Not remembered** is meant literally, and it is where an implementation is most likely to go wrong. A round has to look up the members it is about before it can ask them — their Provider Profiles, off the relays — and a handover names whoever its sender liked. So whatever a gateway holds in order to make the round MUST be let go of when the round refuses it, or one sealed packet would grow what the process watches, for free and for the life of the process. What a gateway holds after a refused handover is exactly what it held before it.

Being sent something is proof here precisely because **only the holder of the lease's Continuation Token can derive a grant a provider will accept** (§6.5.1). A gateway is not weighing who sent the packet — it cannot, and it does not need to. It is asking the only parties that can answer whether the grant is real.

The round is §12.4's round and nothing else: each member is sent `status` presenting the grant the handover carries for it, all of them at once, bounded by whatever a gateway bounds a tenant's first request by. A member that answers **about the lease** has accepted the grant, whatever it says about the workload — `reserved`, `stopped` and an ending are acceptances, because a member that read the lease to answer them read it with this grant. A refusal (`bad_grant`, `unknown_workload`) and silence are not acceptances, exactly as §12.4 step 4 keeps them apart. **One acceptance is enough**, because a grant a member took is a grant its tenant derived.

Before that round and without asking anybody, a gateway MUST refuse a handover whose `expires_at` has passed: it MUST NOT carry an expired grant to a provider (§12.7), and such a handover could put the workload nowhere in any case.

**What a gateway answers a handover.** A handover it admitted is answered `{ "workload_id", "hostname", "expires_at" }`: the hostname is the canonical one of §12.2, which the tenant can derive itself and is told so that nothing has to be assembled from two places. A handover it refused is answered the error shape of §5 — exactly the two keys `error` and `message`:

| Code | Means |
|---|---|
| `invalid_handover` | It is not a handover: a field this specification does not name, or one of them malformed. Nothing was asked. |
| `grant_expired` | Its `expires_at` has passed, so no member would take the grant. Nothing was asked. |
| `rate_limited` | This gateway will not ask one of the members named just now (below). Nothing was asked. |
| `not_admitted` | The round was made and no member accepted the grant. The handover was dropped. |
| `no_proxy` | A member it names is at an `.anyone` address this gateway has no anon client to reach (§12.8). Nothing was dialled. |
| `admission_failed` | This gateway could not carry out a round at all. Nothing was decided about the grant. |

`not_admitted`, `no_proxy` and `admission_failed` MUST NOT be collapsed into one another, for the reason §12.3 keeps `no_proxy` apart from every other reason: the first is a fact about the grant, the second and third about this gateway, and a tenant acts on them differently — only the first is a reason to go and derive another grant. A reader MUST NOT refuse a code it does not know. A gateway MUST NOT put a grant, whole or in part, into any of those answers or into anything it logs: the grant is a secret on the same terms as the Continuation Token it derives from (§6.1.1).

**The amplification ratio, and why the rate limit is normative.** Anyone can seal a handover naming any provider, so one sealed packet the sender paid to deliver buys one free `status` to each member it names — a ratio of **about one to one** for an ordinary lease. A gateway is therefore a small reflector unless it bounds that, and so:

- it MUST rate-limit admission **per member named**, so that a burst of unsolicited handovers cannot make it exceed that rate against any one provider, however the burst is spread across workloads or senders;
- it MUST bound how many members it will ask from one handover, so that the ratio cannot be raised by naming a thousand providers in one packet;
- a handover it will not ask about MUST be refused with **nothing sent to anybody**.

The rate is a gateway's own to choose. What is not optional is that there is one, and that it is counted per member rather than per handover.

**A gateway cannot allowlist tenants.** There is no tenant identity to put on a list: nothing a tenant produces is signed, nothing is published, and the envelope authenticates nobody. **This is a consequence of the design and not an oversight** — it is the same property that keeps a provider from proving who asked it to run anything (ADR 0016) — and a gateway that wants to serve only certain workloads must decide that some other way, out of band. What a gateway *can* bound is the work one packet buys, which is what the rules above bound.

#### What a handover changes once it is admitted

A gateway holds at most **one** grant per workload, and a later handover **admission accepted** replaces the one held. Nothing is weighed to decide which of two is current — there is no `created_at` to compare and no signature to weigh — because getting past admission is already the proof that its sender may replace what is held. Renewal, rotation of the grant's moment and a change of Standby Set are therefore all the same act, and all take effect with no restart and no operator action:

- a handover with a further `expires_at` renews (§6.5.1's rotation of the grant, from the gateway's side);
- a handover whose grants derive from tokens the tenant has rotated (§6.8) restores serving a workload whose members now refuse the grant held, and replaces it;
- a handover naming a different Standby Set moves the workload's members;
- a grant that reaches its `expires_at` stops being served (§12.3), and starts again by itself when its tenant hands over one derived for a later moment.

`name` is the one field a defect does not cost the grant: an absent or unusable `name` MUST leave the workload served at its canonical hostname (§12.2), because that is the name a tenant can always derive. A gateway logs the defect and drops the name. What a usable one is served at is §12.6.

A handover that is not the shape above puts no workload anywhere, and one malformed packet MUST NOT stop the gateway serving the workloads it holds.

### 12.2 The canonical hostname

Every workload a gateway holds a grant for is served at

```
<canonical label>.<gateway domain>
```

**always**, whatever else it may also be served at. The canonical label is the **lowercase, unpadded base32 (RFC 4648) encoding of the 32-byte `workload_id`**: 52 characters, where the 64 hex characters of the same id would not fit DNS's 63-character label. Padding is omitted — `=` is not a legal label character and the length of a workload id is fixed — and the alphabet (`a`–`z`, `2`–`7`) is one a DNS label allows and DNS's own case-insensitivity does not disturb.

```
workload_id  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
label        vkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkva
served at    https://vkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkvkva.<gateway domain>/
```

The label is **derived, never assigned**: a tenant computes it from the workload id it chose, two gateways handed the same workload serve the same label, and a Takeover changes nothing about the name. A gateway matches the `Host` of a request case-insensitively, ignoring a port and a trailing dot, and only as **one** label under its own domain: a deeper name, the bare domain, an address and a name under another domain are all hostnames it holds no grant for.

**TLS is terminated at the gateway**, for the gateway's own domain, with the gateway's own certificate. A workload is therefore reachable over HTTPS while holding no certificate itself, and no provider ever owns a domain, runs ACME or holds a tenant's certificate key (§9, ADR 0013). A gateway MAY additionally offer a plain-HTTP listener; that is a deployment choice and not part of this protocol.

### 12.3 The gateway error page

Until a workload resolves, and whenever it cannot, a request is answered **`503` with a body naming the reason**, never with silence or a dropped connection. A tenant whose URL stopped working must be able to tell a stopped workload from an expired grant from a broken gateway, and none of those is visible from a closed connection.

The body is the error shape of §5 — exactly the two keys `error` and `message` — where `error` is one of the reasons below and `message` says what happened in words. A gateway MAY answer a browser a readable page instead, carrying the same reason.

| Reason | Means |
|---|---|
| `no_grant` | This hostname names no workload this gateway holds a grant for. |
| `grant_expired` | The grant's `expires_at` has passed. Handing over one derived for a later moment renews it (§6.5.1, §12.1). |
| `not_resolved` | A grant is held, but where the workload runs is not yet known. |
| `no_running_member` | Every member of the Standby Set answered, and none of them is running the workload (§12.4). |
| `member_unreachable` | A member that would answer for the workload told this gateway nothing: its connector could not be reached, refused the request, or answered something that is not a `status` at all, or the address it gave will not answer (§12.4). |
| `no_proxy` | The workload is on a Hidden Provider — its connector or its lease is at an `.anyone` address — and this gateway has no anon client to reach one through. Nothing was tried (§12.8). |

`no_running_member` and `member_unreachable` are not the same answer and MUST NOT be collapsed: the first says nothing is running the workload, which is a fact about the lease, and the second says this gateway cannot see what may well be running, which is a fact about the gateway's reach. A tenant acts on them differently.

A reader MUST NOT refuse a reason it does not know: later rounds add reasons, exactly as the Eviction Notice's `reason` does (§6.7).

A request to a hostname the gateway holds no grant for is answered by the **gateway itself** and MUST reach no provider and no workload: nothing is dialled, no `status` is sent, and no relay is read on its account. A gateway is not a probe, and an unknown hostname must not become one. The one thing that does make a gateway send a `status` about a workload it holds nothing for is an admission round, and §12.1 bounds that.

These reasons are what a gateway says at a **hostname**. What it says to a tenant that sealed it a handover or a withdrawal is a separate, smaller vocabulary, in the same shape (§12.1, §12.7).

### 12.4 Resolving a workload across its Standby Set

**Resolution follows the handover and nothing else.** The handover names the Standby Set; nothing a provider says, and nothing a request carries, adds a member to it or removes one. For each workload a gateway holds a grant for:

1. **Each member's Provider Profile** (§4.1) gives the three facts that reach that member — `connector_url`, the only place a gateway may ask it anything; `ilp_address`, the prefix of the routes its connector terminates (§5); and `connector_seal_key`, the key a request to it is sealed to (§3, ADR 0011) — and its Relay Set. A gateway looks on the relays it is configured with, and SHOULD then also watch the relays a Profile itself names: a provider publishes its Profile to its **own** Relay Set (§4), which a gateway need not be configured with, and a member whose Profile cannot be found is a member that cannot be reached.
2. **Every member is sent `status`** (§6.5) — all of them, and at once. Not the primary first with the others only on failure: a Takeover moves a workload with no tenant online to say so (§7.1), so the member the handover lists first is exactly the member that may no longer have it. Each request is an ordinary Lease Request (§6.1) that **nobody signs**, naming that one member in `provider`, with `op=status`, presenting **that member's own Gateway Grant** as its `continuation` and the handover's `expires_at` as its content's `gateway_expires_at` (§6.5.1). `status` is free (§5): a gateway attaches no payment, holds no lease and calls no paid route, here or anywhere.
3. **The running member is the one answering `state: "running"` with `access`.** A member answering `reserved`, `stopped` or an ending (§6.7) is simply **not the target**; that is not an error, and a Standby Set is expected to answer mostly `reserved`. Where more than one member answers `running` — a Takeover settled at two places for an instant — the member earliest in `standby_set` is taken, so two gateways holding the same grant resolve the same way.
4. **A refusal is not an answer about the lease.** `bad_grant` says this gateway may not read the lease; `unknown_workload` says this member never held it (§5). Neither says the workload is not running here, so a refusal MUST be counted with a member that could not be reached and MUST NOT be counted as a member that answered — a gateway that told a tenant "no member is running it" on the strength of a `bad_grant` would be stating a fact about the lease that it never learned.

   **And neither is an answer that is not a `status` at all.** A `status` answer carries `state` (§6.5) or it carries `error` (§5). Anything else — an HTTP error from a hop in front of the provider app, a body that is not JSON, an empty body — says nothing whatever about the lease and MUST be counted the same way, for a stronger reason than a refusal: the lease was never asked about. A gateway SHOULD say in its refusal what it asked, where, and what came back, because that is the difference between an operator looking at the lease and an operator looking at the hop that swallowed the request.
5. **The target is `access.host`, and the `host_port` of the entry in `access.ports` whose `container_port` equals the handover's `http_port`.** It is **not** the first port listed and **not** `ssh_port`. A workload commonly exposes several ports and the host ports are the provider's to choose; the handover carries `http_port` precisely so that a gateway has to guess nothing (§12.1). A member answering `running` with no entry for that container port is not a target either.

A resolution in which every member answered about the lease and none was running is `no_running_member`; one in which a member told this gateway nothing — it was unreachable, or it refused — is `member_unreachable` (§12.3). A gateway SHOULD log which member said what, because a Standby Set answering `reserved` everywhere and a Standby Set that will tell this gateway nothing look identical from outside.

**Carriage is not fixed here, but it is not invented either.** What a member must RECEIVE is the request above, in the packet body §6.1.2 defines; how it gets there is §5's question and its connector's, exactly as for any other client of a free route. A gateway that seals the request through a member's connector and a gateway that reaches a member's free `status` route by some other arrangement send the same bytes and are answered the same. Nothing in this section adds a carriage requirement, and nothing in it excuses a gateway from the one `provider`, the `op`, the window, the grant or the moment that grant names.

**The carriage the directory describes is the connector's, and it is the only one a gateway may assume.** A Profile names `connector_url`, `ilp_address` and `connector_seal_key` (§4.1): together those say "seal this to that key, address it `<ilp_address>.status`, and post it there". They say nothing about any other URL, and a gateway MUST NOT derive one from `connector_url` — in particular it MUST NOT reach a member at a path beside it. `connector_url` is a connector's client edge; what a provider serves *behind* that edge is a single listener carrying `status` **and** every paid `<listing>.v<n>.spawn` route (§5), so a deployment that exposed it directly would be publishing a paid route with the payment skipped, and a provider is right to refuse that. A gateway that reaches a member some other way is doing so on an arrangement the directory does not carry, and MUST NOT expect a member it has never been told about to honour it. ADR 0023.

A gateway MAY keep the target it resolved and forward to it without asking again. When it MUST ask again — a Takeover, a cadence, a grant that ran out — is §12.7.

### 12.5 What a forwarded request carries

Forwarding is an ordinary HTTP/1.1 reverse proxy, with three things fixed by this section because an application behind a gateway depends on them:

- **`Host` is preserved.** The workload is reached at an address the gateway resolved, but what it sees is the name **the tenant used**. An application that builds absolute URLs, sets a cookie domain or picks a virtual host from `Host` would otherwise answer with the workload's private address.
- **`X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` are set**, so the application can tell that it is behind a gateway and act on it. `-For` is the address the request came from, appended to any chain already present; `-Proto` is the scheme **the tenant used** — `https` wherever the gateway terminated TLS (§12.2), whatever the gateway's own hop to the workload is; `-Host` repeats the `Host` above, which is the header a framework is configured to trust when it has been told `Host` may have been rewritten.
- **Hop-by-hop headers are not forwarded** in either direction (RFC 9110 §7.6.1). They describe one connection, and a forwarded request is two.

**WebSocket upgrades are passed through.** The handshake is replayed to the workload and the two connections are then joined, so an application that holds a connection open works behind a gateway. An upgrade to a hostname that does not resolve is refused with the same reason an ordinary request would have been given (§12.3), written as an HTTP response on the socket rather than dropped.

A gateway MUST NOT require anything of the workload: no header the application has to read, no path prefix, no agent inside it. A workload that works behind no gateway works behind one.

### 12.6 A readable name

Beside the canonical hostname, which a workload always has (§12.2), a handover MAY carry a `name` (§12.1), and a gateway MAY serve the workload at `<name>.<gateway domain>` as well.

A name is **first come, first served**, and served only when

- it is a single DNS label, and
- no grant **still in force** on this gateway already holds it.

A `name` that fails either is **logged and ignored, and costs the grant nothing else** — the workload keeps its canonical hostname, which is the name a tenant can always derive and can never lose to somebody else's grant. So both workloads in a collision stay reachable, and a readable name is never ambiguous: it is either one workload's or nobody's. For the same reason the canonical hostname wins whenever a `name` happens to spell one.

An expired grant keeps its name until another grant claims it — so a tenant whose readable URL stopped working is told the **grant** expired (§12.3), rather than that the hostname means nothing here. A workload **withdrawn** by its tenant is the other way about: it gives its name up **at once**, along with everything else that was being served for it (§12.7).

Because a name is a convenience and the canonical hostname is not, a gateway MAY refuse names by its own policy, and two gateways handed the same workloads MAY disagree about who has which name. Nothing in this protocol depends on a readable name.

### 12.7 Following the workload

§12.4 finds where a workload is running once. This is what keeps that answer true, because nothing tells a gateway that it stopped being true: a Takeover moves the workload with no tenant online (§7.1, ADR 0010), and a primary's self-stop, an expiry and an eviction (§6.7) announce nothing to a gateway at all. A gateway follows the **workload**, not the provider it first found it on.

**The Takeover watch.** For each workload it holds a grant for, a gateway watches

```json
{ "kinds": [30433], "#d": ["<workload_id>"] }
```

on the **primary's Relay Set** — the `relays` of the Provider Profile of `standby_set[0]` — because that is where §7.1 has a standby publish its claim, and it need not be a relay the gateway is configured with. A gateway whose primary names no Relay Set has nowhere else to look and MAY watch its own relays instead. A relay is trusted for nothing here either: the event's `id` and `sig` MUST verify, and a claim signed by a key the handover's `standby_set` does not name MUST be ignored, exactly as §7.1 ignores it — otherwise anyone could publish one and hold up a gateway's re-asks.

**The settle window.** A Takeover event does not mean the workload has moved. It means a standby announced that it intends to take it, and §7.1 gives that standby **2 × `liveness_cadence_s`** — the **primary's** cadence, as the primary's Profile states it — from its **own announcement** before it starts anything. So a gateway MUST NOT re-resolve before `created_at + 2 × liveness_cadence_s` of the claim it saw, counted from the event's `created_at` and **not** from when the gateway happened to receive it: a relay that was slow, or a gateway that was restarted, does not move the deadline, and a claim whose window has already passed is one to act on now. Re-resolving earlier costs a round of `status` to every member and can only learn that nothing is running — the primary has stopped and the standby has not started — which is exactly the moment the last known target must keep serving.

Where several members claim the same workload, the **earliest** claim decides the deadline, because §7.1 settles the race on the earliest `created_at` and the winner is therefore the member that starts first. A second claimant, and a second round, may bring a gateway's deadline **forward** and MUST NOT push it out; a claim from a race the gateway has already acted on MUST NOT open a window again, however often a relay replays it. Otherwise a standby announcing late would hold a stale target past the winner's start.

A primary whose Profile states no `liveness_cadence_s` is a defective Profile (§4.1 requires one). A gateway SHOULD assume a cadence rather than stop following the workload: the defect is its provider's and the cost would be the tenant's.

**The per-cadence re-ask.** Independently of any event, a gateway MUST re-ask at least once every `liveness_cadence_s` while it holds a target, so that a self-stop, an expiry or an eviction stops being forwarded to within a cadence rather than lingering until someone notices. While a settle window is running this re-ask waits for it, for the reason above — and no longer than that window, which is why a later claim may not extend one. A gateway that holds no target for a workload need not poll for one: a request resolves it (§12.4).

**The last known target keeps serving.** While a re-resolution is in flight, requests continue to be forwarded to the member last seen running. Only a **finished** resolution changes the target or withdraws it. A slow relay, a slow connector or a member taking its time therefore never takes a healthy workload offline **while it is being waited for**; what they cost is the freshness of the answer, not the service. A resolution that finished withdraws the target both when every member answered and none was running and when no member told the gateway anything at all, and the tenant is told which of §12.3's two reasons it was: §12.4 keeps those apart on purpose, and neither is silence.

**A grant that ran out.** When `now > expires_at`, the workload stops being served and is answered `grant_expired` (§12.3). A gateway MUST NOT carry an expired grant to a provider, which would refuse it `bad_grant` (§6.5.1) and rightly. No timer, restart or operator action is involved on either side: expiry is a comparison made when a request arrives, and a tenant that hands over a grant derived for a later moment is served again by that same act (§12.1).

**A tenant that withdraws a workload.** A tenant that wants serving to stop before `expires_at` sends a **Gateway Withdrawal**, sealed to the gateway's connector over the channel a handover came in on (§12.1): the connector unseals the envelope and forwards plain HTTP, and the gateway reads the body as plaintext JSON. Both messages go to the one route that connector terminates, so what says which of them this is, is the body's one key. The body is `{ "withdrawal": … }` — that key and no other:

```json
{
  "withdrawal": {
    "workload_id": "…",
    "expires_at":  <unix seconds>,
    "standby_set": [ { "provider": "<pubkey, hex>", "grant": "<32 bytes, hex>" }, … ]
  }
}
```

- **`standby_set`** is spelled exactly as a handover spells it (§12.1) — the lease's Standby Set in its own order, primary first, every member carrying the Gateway Grant derived **for its own key** (§6.5.1) — because it is the same fact, and a gateway that can read one message has learned to read the other.
- **`expires_at`** is the moment those grants were derived for, so it says **which grant** this withdrawal bears. It is not a deadline, and a gateway MUST NOT compare it with the clock: withdrawing a grant whose moment has already passed is an ordinary withdrawal, and worth making, because an expired grant is still holding the workload's readable name (§12.6).
- A field this specification does not name MUST be refused, never dropped (ADR 0004). A withdrawal carries no `http_port` and no `name`: nothing is left to serve, so there is nothing to serve it on.

> A withdrawal MUST NOT stop a workload being served unless it **bears the grant that workload is being served under** — the value this gateway holds for a member of that workload's Standby Set. The grant borne and the grant held MUST be compared in **constant time**, because the grant is a secret on the same terms as the token it derives from (§6.1.1). A withdrawal bearing anything else MUST be ignored and logged, and the workload MUST go on being served. A gateway MUST ask no provider and read no relay in order to answer one.

**Why the grant stands in for a signature.** Nothing a tenant produces is signed, so a gateway can no more ask who sent a withdrawal than it can ask who sent a handover — and the rule this section has to keep is that **a stranger must never be able to take any workload off any gateway**. The grant keeps it. Only the holder of the lease's Continuation Token can derive one (§6.5.1), and the only other party holding this one is the gateway being withdrawn, whose withdrawing itself costs nobody anything. So bearing the grant is proof of the one thing that matters here, exactly as being accepted by a member is proof at admission (§12.1). **One member's grant is enough**, and it is all a tenant can be asked for: every value in a set derives from the one root secret, so producing one of them is producing all of them.

A withdrawal buys no work anywhere else — nobody is asked, nothing is dialled — so there is nothing here to rate-limit as §12.1 rate-limits admission, and a withdrawal for a workload a gateway holds nothing for reaches nobody at all.

**What a withdrawal ends, and it ends at once.** The three things a grant naming another gateway used to cause, all together and with no round anywhere:

- the workload **stops being forwarded**, and its canonical hostname is answered `no_grant` (§12.3) by the gateway itself;
- the workload **stops being followed**: the Takeover watch above is closed, the per-cadence re-ask stops, and the last known target is forgotten;
- its **readable name is given up**, free for the next grant that asks for it (§12.6).

**A withdrawal ends *serving*, not *reading*.** The withdrawn gateway keeps a **working grant** until its `expires_at` or until the tenant rotates the lease's tokens, whichever comes first: it could still present that grant for `status` and be answered, and the provider is neither told nor has anything to be told. A withdrawal is not a revocation. Ending the reading as well means rotating the lease's own Continuation Token at every member on `<addr>.rotate` (§6.8), which ends every grant derived from the old tokens at once: each member then refuses the grant this gateway holds `bad_grant`, which §12.4 counts as a member that told it nothing. A tenant that rotates and wants to keep a gateway hands it grants of the new tokens (§12.1). A gateway MUST NOT answer, log or otherwise present a withdrawal as a revoked delegation.

**What a gateway answers a withdrawal.** One it acted on is answered `{ "workload_id", "hostname", "withdrawn": true }`, where the hostname is the canonical one (§12.2) that is no longer served here. One it did not is answered the error shape of §5 — exactly the two keys `error` and `message`:

| Code | Means |
|---|---|
| `invalid_withdrawal` | It is not a withdrawal: a field this specification does not name, or one of them malformed. Nothing was withdrawn. |
| `not_withdrawn` | This gateway is not serving that workload under the grant borne — a wrong grant, a grant it has since replaced, or a workload it holds nothing for. Nothing changed and nobody was asked. |
| `withdrawal_failed` | This gateway could not carry out a withdrawal at all. Nothing was decided about the workload, which may still be served here. |

A body a gateway could not read as either message — malformed JSON, or too large to be one — is answered `invalid_handover` (§12.1), because which of the two it was meant to be is not yet known. `not_withdrawn` covers all three of its cases, because the tenant's next step is the same for each: derive the grant the gateway holds now and send it again. It MUST NOT be collapsed with `withdrawal_failed`, for the reason §12.1 keeps `not_admitted` and `admission_failed` apart: the first is a fact about the grant borne and the second about this gateway, and a tenant told the wrong one derives a value that was never the problem. A gateway MAY log which it was; what it MUST NOT do is put a grant, whole or in part, into either answer or into anything it logs, exactly as at admission (§12.1, §6.1.1).

**What a tenant sees.** Three timings follow from this section, and a tenant should be told them rather than left to measure them. Between a primary's self-stop and a Takeover's start — about `3 × liveness_cadence_s`, §7.2's outage window — the workload runs nowhere: every member answers about the lease and none of them is running it, so a gateway resolving in that gap answers `no_running_member` (§12.3), not `member_unreachable`. After a Takeover, a URL moves roughly one settle window after the claim was published — `2 × liveness_cadence_s` from its `created_at`, plus whatever a gateway's own polling granularity adds — and it keeps answering from the old member throughout, until the member running it can be found. After a self-stop, an expiry or an eviction, a URL stops being served within one `liveness_cadence_s`. None of the three depends on the tenant being online. A withdrawal is the one thing in this section with no timing at all: it has taken effect by the time the gateway answers it.

### 12.8 A workload on a Hidden Provider

A Hidden Provider publishes no host: its connector is reachable only at an `.anyone` address, and every lease it runs is reachable only at a per-lease `.anyone` address (§10, ADR 0008). A gateway fronts such a workload exactly as it fronts any other, and the provider stays hidden, because **the gateway is an ordinary client of the per-lease address**: it dials an `.anyone` host through an anon client — a `socks5h://` proxy to a running `anon` daemon, as a tenant of a hidden lease does (§10) — and nothing else in §12.1, §12.4 or §12.5 changes. The handover, the grant, the `status` request, which member is the running one, the target port and the forwarded headers are all the same. An admission round (§12.1) goes the same way as any other round: a gateway with no proxy configured refuses a handover naming a member at an `.anyone` connector rather than dialling one, and refuses it before anything is tried.

**Both legs go the same way.** A Standby Set member whose Profile gives a `connector_url` at an `.anyone` host is sent `status` (§12.4) through the proxy; a running member whose `access.host` is an `.anyone` name is forwarded to (§12.5) through the same proxy. **Any other host is dialled directly.** A Standby Set that mixes a public member with a hidden one therefore resolves and forwards with no configuration beyond the proxy: each member is reached the way its own address calls for, and nothing in the handover says which members are hidden.

An `.anyone` name MUST NOT be resolved or dialled directly, under any circumstances. It has no meaning to a system resolver, and handing one to the resolver would put a hidden service into a plaintext DNS query — the exact fact hiding withholds. So the name goes to the proxy **as a name** (`socks5h`, under which the proxy resolves it; not `socks5`, under which the gateway would), and **a gateway with no proxy configured MUST refuse a workload that needs one**, with the reason `no_proxy` (§12.3), before anything is tried. `no_proxy` is not `member_unreachable` and MUST NOT be collapsed into it: the first is a fact about the gateway's configuration and the second about its reach, and an operator acts on them differently. A relay a Profile names at an `.anyone` host (§12.4) is likewise never dialled directly: a gateway that does not reach relays through its anon client does not watch that relay, and SHOULD log that it did not.

**What fronting a hidden workload discloses.** A gateway reads every request it fronts, hidden or not (§12); that is the cost of the name, and the tenant chooses who pays it. Fronting a Hidden Provider's workload reveals **the workload's existence and its traffic pattern, and not the provider's location**: the gateway is one more client of the per-lease `.anyone` address, and learns nothing about where the provider is that the tenant's own client would not (ADR 0008). The provider stays hidden; the tenant's workload stops being, and that is the tenant's choice to make, by handing the workload to a gateway (§10).

---

## 13. A relay's paid write edge

A provider publishes its Profile, its Listings and its Liveness to every relay in its Relay Set (§4), and on this network a relay write is a paid packet. So a provider that cannot find out where a relay's writes are paid for cannot publish at all, and this section says how it finds out: **a relay names its own edge, in its own words, at its own URL.** It is the same statement a Provider Profile makes about a provider, made by a relay about itself, and ADR 0024 records why it is the same three fields.

### 13.1 The relay information document

A TOON relay MUST serve a **NIP-11 relay information document** at the HTTP form of its own relay URL, answered to a `GET` whose `Accept` header names `application/nostr+json`, with that media type on the response. A relay MUST answer the request from any origin, because a client reading it in a browser has no other way to. What a relay answers a request that does **not** ask for the document by that media type is not specified here, and a relay MAY go on answering such a request exactly as it did before it served one.

The document's TOON fields are one object under the key `toon`. Content is JSON:

| Field | Type | Meaning |
|---|---|---|
| `ilp_address` | string | The ILP address a write to this relay is addressed to, e.g. `g.toon.relay` |
| `connector_url` | string | The terminating connector's self-description URL, e.g. `https://c.relay.example/ilp`. A location hint only. |
| `connector_seal_key` | hex | That connector's sealing public key (§3) |
| `carriage` | string? | The carriage that route pins: `http` or `btp`. Absent — never `both`, never `null` — when the route pins none |
| `price` | int | µUSDC per write (§2). `0` is a value and means this relay charges nothing |
| `settlement` | object[] | `{ "chain": "solana" \| "evm:<chainId>", "token": "<address or mint>", "decimals": 6 }` |

`ilp_address`, `connector_url`, `connector_seal_key`, `price` and `settlement` are normative and a relay that serves the document MUST carry all five. `carriage` is normative when present and its absence is a statement of its own — see §13.3. A field this section does not name MUST be ignored, never read as one that is.

The first three are spelled exactly as a Provider Profile spells them (§4.1) because they are the same three facts and one parser reads both: together they say "seal this to that key, address it `<ilp_address>`, and post it there". A client MUST NOT derive any other URL from `connector_url`, by the same reckoning as §12.4.

Everything NIP-11 already has words for stays in NIP-11's own words, and MUST agree with the `toon` object:

- `limitation.payment_required` is true exactly when `price` is greater than `0`.
- `fees.publication` carries `[{ "amount": <price>, "unit": "uusdc" }]` when `price` is greater than `0`, and is absent otherwise.
- `limitation.restricted_writes` is true on every TOON relay, whatever it charges: no write is accepted on the websocket, and a free relay is still a restricted one (§13.4).

A client that has never heard of this network therefore still learns from the document that the relay is paid and what a write costs.

### 13.2 The document is derived, not written

A relay MUST derive the `toon` object from the self-description its terminating connector serves for itself, and MUST NOT hold its own copy of any field in it. A relay speaks no ILP and enforces no price; a second copy of the enforcer's facts is a copy that drifts, and what it drifts into is a relay advertising a price nobody charges or a key nobody holds.

Two rules follow, and both are about refusing rather than guessing:

- A relay MUST NOT name an `ilp_address` its connector does not say it terminates. A relay that cannot confirm its address MUST serve the document with **no `toon` object at all** rather than one it could not check.
- `connector_url` is the endpoint the connector **advertises for itself**, never the address the relay happens to reach it at. Those differ on every deployment where the connector sits behind a proxy or on a private network, and it is the advertised one a client can dial.

The one thing a relay cannot read is which of its connector's routes arrives at its own write surface: a connector publishes its routes' prefixes and prices and never their handler. That single fact is the relay's own configuration, and it is the only part of the edge that is.

A client MAY check the document against the connector's own self-description at `connector_url`, and a client that does so MUST refuse to proceed if the two report different sealing keys, exactly as a tenant does with a Provider Profile (§3, ADR 0011). What the two pins are worth is not the same, and ADR 0024 says so plainly: a Profile is signed by the provider's Nostr key, and a relay's document is signed by nothing.

### 13.3 Carriage

`carriage` is the carriage the relay's write route pins — which transport a packet buying a write must ride. A relay MUST take it from what its connector says it enforces, and MUST omit it when its connector says nothing. An absent `carriage` means **the route pins no carriage that the relay could learn of**, and a client reading a document without one SHOULD dial whichever endpoint the connector's self-description offers and treat a refusal naming a required transport as the answer it would have read here.

A relay MUST NOT publish `both`, or any other value meaning "either is fine", as a carriage. A carriage that is not a pin is silence, and a client MUST read it as such.

### 13.4 A relay that charges nothing

A relay whose write route is priced `0` serves the document unchanged: `price` is `0`, `limitation.payment_required` is false, and `fees` is absent. It still names `ilp_address`, `connector_url` and `connector_seal_key`, because a free write is still a packet to an address and a client still needs all three to send one.

A relay that publishes no edge at all — one with no payment gate in front of it, or one that could not check its address (§13.2) — serves the document with no `toon` object, `limitation.payment_required` false and `limitation.restricted_writes` true. That is a relay saying it takes no write on the websocket and cannot say where one is taken instead, which is a true and useful thing to say.

### 13.5 The refusal names the edge

A relay refuses a write that arrives on its websocket with a NIP-01 `OK` message whose machine-readable prefix is `restricted:`. That message MUST name `ilp_address` and `connector_url`, and SHOULD name the price and the carriage, so that a client can find the edge **from the refusal alone** without first reading the document. It MUST NOT carry `connector_seal_key`: a key is too long to belong in a message a client may be logging a line at a time, and the document is one request away.

A relay MUST render the refusal and the document from one value. Two renderings of one fact are how a relay comes to refuse a write towards one address while advertising another.

---

## Appendix A. Sandbox profile (development)

v1 is developed against `infra/sandbox`, then pointed at production URLs.

| Thing | Sandbox value |
|---|---|
| Hub connector client edge | `http://localhost:3200` |
| Relay (reads) | `ws://localhost:7100` |
| Relay write routes | `g.toon.relay` (1 µUSDC); `g.toon.relay.ephemeral` is not used |
| Relay information document | `curl -H 'Accept: application/nostr+json' http://localhost:7100/` (§13): the sandbox relay reads its edge from the connector terminating `g.toon.relay` and names it there |
| TOON store | `g.toon.store`, `kind:5094`; free tier ≤ 107,520 bytes per data item, so `part_size` ≤ 102,400 |
| Gateway pattern | `http://localhost:3000/raw/{txid}` |
| Settlement | Solana mock USDC (the hub's client leg) and anvil mock USDC; a provider connector copies `conf/connector-store.toml` |
| Provider connector | Level 2 shape (README §5); tenants may pay it directly or through the hub |
| Hidden Provider | the sandbox `hs` profile |
| Workload Gateway | the sandbox `gateway` profile (§12): domain `gw.localhost`, so a workload is at `http://<canonical label>.gw.localhost:3280/` and `https://…:3443/` (a self-signed wildcard certificate, `conf/workload-gateway-tls/`); no key of its own; its own connector at `http://localhost:3260` terminating one free route, `g.toon.workload-gateway.handover`, forwarded to the gateway's `GATEWAY_HANDOVER_PORT` (8081, published on no host port) at `/handover`; `GATEWAY_ADMIT_PER_MINUTE` left at the default 6; relays read on `ws://relay:7100` (the sandbox relay by its compose name; `ws://localhost:7100` from the host) for Provider Profiles and Takeovers only |
| Gateway Handover (tenant side) | `node scripts/handover.mjs <lease.json>` in `infra/sandbox`, the handover tool (`provider/tools/grant/seal.mjs`) with the sandbox's values: sealed to the gateway connector's key derived from `keys/toon/workload-gateway-connector/signer.key`, paid **directly** to that connector at `http://localhost:3260` from mnemonic account index 4 (its own Solana channel; the hub does not peer with it), the root secret and the Standby Set read from the lease file `scripts/spawn.mjs` writes to `.toon-client/spawn-<id>.json`, Standby Set members by compose name (`provider`, `provider2`, `provider-hs`), `--expires-in 1h` by default. Nothing is published |
| Gateway Withdrawal (tenant side) | `node scripts/handover.mjs --withdraw <lease.json>`: the same route and key, bearing the grant of the moment the lease file recorded at handover |
| Rotation (tenant side) | `node scripts/rotate.mjs <lease.json>` in `infra/sandbox`: the handover tool's `rotate` (`provider/tools/grant/seal.mjs rotate`) over every member the lease file names, each reached at its `ilp_address` and sealed to the `connector_seal_key` its `conf/provider*.toml` pins; paid through the hub at `http://localhost:3200` from mnemonic account index 4 on its own channel store (`.toon-client/rotate-channels.json`). The new root secret is written into the lease file, beside the old one until every member has confirmed (§6.8). `provider-hs` is refused: its connector is reached over `anon`. The provider connectors terminate `<addr>.rotate` at 0 and the hub forwards the two clearnet providers' at 100 |
| Root secret | minted by `scripts/spawn.mjs`, one per lease, written as `root_secret` into `.toon-client/spawn-<id>.json` (mode 0600) and nowhere else; the sandbox tenant's Nostr key is used for nothing on this path |
| `.anyone` through the gateway | `socks5h://anon-client:9050`, the `hs` profile's buyer-side proxy, with the hidden provider's `status` dialled at its app on the compose network; a hand recipe on `make up-hs`, not a smoke |

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

Golden fixtures for every tenant-facing surface Milestone 1 implements live in [`fixtures/`](fixtures/README.md): a Lease Request per `op` with its packet body (§6.1), request and response bodies per route (§5, §6), a refusal per §5 error code in validation order, every one of them, one event per directory kind (§4, §6.7), and the routes a Listing generates (§5). They are generated by the provider's wire tests (`toon-provider`, `tests/wire_fixtures.rs`), verified byte-for-byte by its CI, and copied here with `make fixtures TOON_SPEC_DIR=…`, so the copy is exactly what the provider accepts and emits. Signatures use all-zero BIP-340 auxiliary randomness so they are reproducible; the keys are test-only, and the tenant's "key" is a root secret rather than a key pair, since a tenant signs nothing (§6.1). `fixtures/check.mjs` verifies the copy with no dependencies, and this repository's CI runs it on every push and pull request: it re-derives every `id`, re-signs every published event from the test keys and requires the same `sig`, checks every Lease Request against §6.1's shape and recomputes its Continuation Token with Node's own HKDF, rebuilds every packet body, and checks every error body against §5. Where the draft and the provider once disagreed, the fixtures' README says how each disagreement was settled; the spec text is now the normative side, and the only things the fixtures record that the spec does not fix are the ones the README lists as deliberately the provider's own (the HTTP status of a refusal, §5). Milestone 2 adds one fixture per §8 event — an Image Registry entry with both source types, a Blob Record with three parts, and a Template — each signed by a publisher test key of its own, plus one spawn per form of §6.2's `image` and the availability answer for an image no source can serve. Milestone 3 adds the Warm Standby wire shapes: a Takeover event (§7.1), a Listing that prices standbys and the four paid routes it generates (§4.2, §5), and an availability request carrying `role` (§6.4); then the Standby Set roles themselves — one spawn content answered `role: "primary"` with access at index 0 and `role: "standby"` with none at index 1, and a `status` for each, the standby's in the `reserved` state (§6.2, §6.5, §6.7); then paying a reservation — `.standby.extend` adding an interval, and the `not_standby` and `not_running` refusals (§6.3); then the Takeover settled both ways, driven through the provider's real watchdog over its fake Directory — the `status` of a standby that won, `running` with `access` and `takeover.winner`, and of one that lost, still `reserved` and naming the winner (§6.5, §7.1); and finally the primary's self-stop — the `status` of a primary that five Liveness cadences in a row failed to reach a majority of its own Relay Set, `stopped` with no `access` and everything else about the lease unchanged (§6.7, §7.1). Milestone 4 adds the Hidden Provider's two directory shapes: a Profile with `hidden: true` and no `host` key, its `connector_url` at an `.anyone` host, and a Listing carrying `["l", "hidden:true", "toon.network"]` (§4.1, §4.2, §10); then its leases — the `spawn.ok` and `status.running` of that same provider, whose `access.host` is the lease's own `.anyone` address in place of an IP, on the same `ssh_port` and `host_port`s, with no IP anywhere in either answer (§6.2, §6.5, §10). Milestone 5 added the Gateway Grant and the reading it delegates. Milestone 6 (#56) changes the request itself: every `lease_request.*` and every `request_body` is now a plain JSON object of §6.1's six keys, signed by nobody and presenting a Continuation Token, with a fourth op — `standby`, the request a member of a Standby Set is sent — and `continuation.vector.json` states the derivation against a fixed root secret and two provider keys, so a second implementation checks its own HKDF before it sends anything; `error.bad_signature` is gone with the signature it refused. It then replaces the published Gateway Grant with a derived one (§6.5.1): `gateway_sub.vector.json` states that second derivation against a fixed token and a fixed moment, plus the same token one second later — which is why rotation is re-derivation — and `status.delegated.json` is a Workload Gateway's `status`, presenting the grant as its `continuation` and naming its moment in `gateway_expires_at`, answered byte for byte what `status.running` answers the tenant. `error.bad_grant.json` returns with a producer: a well-formed, unexpired grant of the *other* tenant's token, which delegates nothing here. `check.mjs` recomputes both derivations with Node's own HKDF and compares the two answers itself, and `gateway_grant.json` — the published event — is gone. Milestone 7 (#69) adds **rotation** (§6.8, #70): `lease_request.rotate` and `rotate.ok`, whose `next` is the token a fresh root secret (`constants.rotated_tenant`) derives here; every refusal the route can give, in the order §6.8 weighs them, as `error.<code>.<which>` — a gateway's grant asserted on `rotate`, a malformed `next`, an unknown workload, another tenant's token, an ended lease, a `next` equal to the current token, and the replay of `rotate.ok` itself; and what the lease answers afterwards — `status.rotated`, the new token, byte for byte `status.running`, `error.not_tenant.rotated`, the replaced token, and `error.bad_grant.rotated`, the very grant `status.delegated` was admitted with. `check.mjs` recomputes `next` with Node's own HKDF and requires that no token the fixtures know, nor any grant of one, appears in any answer. It also adds the paged Blob Record (§8.2, §11 item 2, #73): `registry.blob_record.paged.json` is the SAME application layer as `registry.blob_record.json`, published a second time with `pages` instead of `parts`, its `page_bytes` field carrying each page's own bytes so `check.mjs` can check its `sha256` and its `parts` count without a network; `spawn_image.digest_only.paged.json` is a spawn that resolves the same image through it, over a provider whose Relay Set holds no inline record for that blob at all; and `registry.blob_record.both_forms.json` is the record §8.2's one-of rule refuses — both `parts` and `pages` present at once.

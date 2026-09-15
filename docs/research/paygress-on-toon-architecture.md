# Compute marketplace on TOON: Paygress as the base

Research date: **2026-09-15**. Design-oriented research. The premise: **no chain of our own and no network token**.
- **Settlement:** TOON payment channels.
- **Marketplace control plane:** a TOON relay plus NIPs.
- **Artifacts:** Lading.
- **Starting codebase:** **[Paygress](https://github.com/DhananjayPurohit/Paygress)**, an Apache-2.0 Rust compute marketplace that already runs on Nostr without a chain. It replaces the earlier plan of forking Akash's provider code.

This builds on [`akash-toon-integration.md`](./akash-toon-integration.md), which covers Akash's chain, escrow, licenses and AEP-79. Those findings are not repeated here. Akash is now a **source of later features** (§6), not the base.

**Revision note.** An earlier draft of this file used Akash's provider as the base and TOON's mesh-compute and factory job-market specs as templates.
- The owner redirected to Paygress as the base.
- Those TOON specs are deliberately out of scope for this design.

Everything is from primary sources pinned below. Anything I could not trace to a source is marked **UNVERIFIED**. Kind numbers written as `K_*` are **placeholders, not allocations** (§7, question 1).

| Source | Pin |
|---|---|
| `DhananjayPurohit/Paygress` | [`c92b8704`](https://github.com/DhananjayPurohit/Paygress/tree/c92b870485cacbb3c526982c89630298f5cedfb4) (2026-08-22), Apache-2.0, crate `paygress-cli` v0.1.9 |
| TOON `connector` | [`586598c4`](https://github.com/toon-protocol/connector/tree/586598c4448e9531a25849b72664544eda008ac2) (2026-09-14), MIT |
| TOON `relay` | [`f6a3354e`](https://github.com/toon-protocol/relay/tree/f6a3354ef8b832cc91933cd8688a12b17d49c657) (2026-09-04); no license detected by GitHub |
| TOON `toon-meta` | [`d0d79ffb`](https://github.com/toon-protocol/toon-meta/tree/d0d79ffbe48c143162a1db7456d769c3058e4dca) (2026-08-28), MIT |
| TOON `toon-client` | [`e493f331`](https://github.com/toon-protocol/toon-client/tree/e493f33187a43cc956778f5211ff4b8afb533d2a) (2026-09-07) |
| `nostr-protocol/nips` | [`a2494f4f`](https://github.com/nostr-protocol/nips/tree/a2494f4f81d46684e5814a9bf35e2b1df978f955) (2026-09-09) |
| `drew-dot-com/lading` | [`931f083d`](https://github.com/drew-dot-com/lading/tree/931f083d2372c1bec41d72a7bb8fa6c4be585b9d) (v0.18.0, 2026-09-15), MIT |
| `hzrd149/blossom` (BUDs) | [`b5bd2801`](https://github.com/hzrd149/blossom/tree/b5bd2801d1763aa635fc8fea7a76597e0eb18990) |
| `opencontainers/distribution-spec` | [`97274622`](https://github.com/opencontainers/distribution-spec/tree/97274622c11112caa21efb8c52acca3c6b8fa7f1) |
| Akash `provider`, `chain-sdk` | same pins as the earlier doc: provider `b7036c6d`, chain-sdk `ace99a2a` |

`PG` below abbreviates `https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4`.

---

## TL;DR

1. **Paygress is already most of the product.** It is a chain-free compute marketplace: "Providers advertise on Nostr, consumers discover and pay - all anonymous, all instant" ([README](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/README.md)).
   - **Offers and liveness:** providers publish offers (`38383`), heartbeats (`38384` history plus `20384` ephemeral), lease revocations (`38385`) and standby promotions (`38386`).
   - **Leases:** a consumer sends an encrypted spawn request carrying a Cashu token. The provider redeems it and sets `lease = value ÷ rate`. It provisions a container or VM on LXD, Proxmox, Docker or KVM, and destroys the workload at expiry.
   - **Already built:** top-ups, a client-side **streaming lease keepalive** (small prepaid intervals), warm-standby failover across providers, Blossom checkpoints, LUKS volumes, six-plus templates, an MCP server, and CI for Nostr-hosted repos.
   - **Written but not yet fed by anything:** co-signed reputation receipts and Bitcoin fidelity-bond stake proofs.
2. **Porting it onto TOON is mostly a payment and transport swap.**
   - **Payment:** Cashu is behind two small traits. Provider side is `MintRedeemer::redeem(token) -> msats` ([`src/cashu.rs` L77-79](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/cashu.rs#L77-L79)); consumer side is `TokenSource::mint_token` ([`src/client/keepalive.rs` L18-21](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/client/keepalive.rs#L18-L21)).
   - **Transport:** the cleanest seam is Paygress's **HTTP mode**. The provider already runs as a plain HTTP app behind a payment-terminating proxy (`ngx_l402`), and a TOON connector is exactly that kind of proxy.
     - The connector replaces nginx.
     - `X-TOON-Payer` and `X-TOON-Amount` replace `Authorization: Cashu <token>`.
     - The connector's sealed payloads (ADR 0018) replace NIP-17 DMs for spawn and top-up requests and their responses.
     - The provider does not need a TOON client library at all.
3. **What must change.**
   - **Event kinds:** `38383` is already assigned to NIP-69 P2P orders in the NIPs registry, so allocate our own.
   - **Heartbeats:** the addressable history heartbeat would cost a paid relay write every minute. Use the TOON relay's free ephemeral lane for liveness.
   - **Payment proof:** reputation receipts cite a Cashu mint signature as proof of payment. They need a TOON channel claim instead.
   - **Drop:** the mint whitelist, the Cashu wallet and the Lightning sweep. The connector's `redeem-latest` replaces them.
   - **Variable lease amounts:** they collide with TOON's fixed per-route prices. Paygress has the same issue with `l402_amount_msat_default`; this is the main open design question.
4. **What Paygress lacks compared with Akash.**
   - posted prices instead of a reverse auction;
   - one container or VM per lease, not multi-service SDL;
   - no Kubernetes (removed in [#76](https://github.com/DhananjayPurohit/Paygress/pull/76));
   - no provider audit or attestation layer;
   - no registry story beyond the Docker daemon's default pull.

   These are later additions. Akash's Apache-2.0 Kubernetes cluster code could sit behind Paygress's `ComputeBackend` trait (§6).
5. **Lading.** Keep the earlier conclusion: a durable, signed **archive** for images, not the hot pull path. It is a better fit for **encrypted Blossom checkpoints**, because Paygress already speaks Blossom (`kind:24242` auth). Permanence and cost are the caveats (§5).
6. **MVP (§8).**
   1. Fork Paygress.
   2. Run the provider in HTTP mode behind a TOON connector on devnet.
   3. Implement TOON payment in the HTTP handlers and the keepalive.
   4. Move offers and liveness to the TOON relay under new kinds.
   5. Pull images by digest through a provider-local cache seeded from Lading.

   The first slice ends when a lease on a Base Sepolia channel spawns, tops up, lapses and is destroyed.

---

## 1. Paygress: what it is (from source)

### 1.1 Facts

- **Project:**
  - Rust, Apache-2.0 ([Cargo.toml](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/Cargo.toml)), crate `paygress-cli` v0.1.9.
  - Repo created 2025-09-03; last push 2026-08-22 (`gh repo view`).
  - Two authors in the recent history (Dhananjay Purohit and Ritik Jain).
  - About 16.6k lines under `src/`, with an integration test suite under `tests/`.
- **Dependencies:** `cdk`/`cdk-sqlite` 0.17.3 (Cashu), `nostr-sdk` 0.43 with `nip04`/`nip44`/`nip59`, `axum` for HTTP, and `rmcp` for MCP.
- **Tagline:** "Pay-per-use compute with Lightning + Nostr. No accounts, no signups." (README).

### 1.2 Component inventory

| Component | What it does | Source | Relevance to TOON |
|---|---|---|---|
| **Event kinds** | `38383` offer, addressable with `d = paygress:offer:v1:<npub>`. `38384` heartbeat, addressable and bucketed per minute "so heartbeats accumulate as queryable history". `20384` ephemeral heartbeat. `38385` lease revocation. `38386` standby promotion. Live window 300 s. | [`src/nostr/kinds.rs` L4-32](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/nostr/kinds.rs#L4-L32) | Control-plane skeleton. Renumber (§3.2). |
| **Offer schema** | `ProviderOfferContent`: `hostname`, `location`, `capabilities`, `specs: Vec<PodSpec>` (tier id, cpu millicores, memory, `rate_msats_per_sec`), `whitelisted_mints`, `uptime_percent`, `total_jobs_completed`, `api_endpoint`, `isolation_level`, optional `stake_proof`. | [`src/nostr/wire.rs` L26-35, L275-298](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/nostr/wire.rs#L275-L298) | Swap mints and msats for channel chains, token and `ilp`/connector URL. Keep the rest. |
| **Requests** | `EncryptedSpawnPodRequest` has `cashu_token`, `pod_spec_id`, `pod_image`, SSH credentials, `template_slug`/`template_env` (vetted registry), `replication`, `workload_id` and `volume_encryption`. Also `EncryptedTopUpPodRequest` and `StatusRequestContent`. | [`wire.rs` L87-196, L372-388](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/nostr/wire.rs#L87-L196) | Keep the bodies; drop `cashu_token`. |
| **DM transport** | The provider subscribes to NIP-04 `kind:4` and NIP-17 `kind:1059` addressed to it, plus `38385` revocations. | [`src/nostr/subscriber/mod.rs` L124-142](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/nostr/subscriber/mod.rs#L124-L142) | Replace with sealed paid packets (§3.1). NIP-04 is `unrecommended`. |
| **HTTP mode** | An axum app behind `ngx_l402`. `/health` and `/offers` are free; `/pods/spawn` and `/pods/topup` are paywalled. nginx redeems the token and forwards `Authorization: Cashu <token>`, and the handler "MUST NOT contact the mint again", decoding face value only. nginx sets a fixed `l402_amount_msat_default 6000` per location. | [`src/provider_http.rs` L1-7, L56-59, L84-109](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/provider_http.rs#L1-L109); [`nginx/conf.d/paygress-l402.conf` L35-52](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/nginx/conf.d/paygress-l402.conf#L35-L52) | **The porting seam.** The TOON connector plays nginx's role (§3.1). |
| **Payment interface** | `MintRedeemer::redeem`, `validate_and_redeem` (mint whitelist checked "before any network call"), `redeem_or_respond`. Cashu is referenced from about 7 files outside `cashu.rs`. | [`src/cashu.rs` L77-96](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/cashu.rs#L77-L96); [`src/provider/handlers/mod.rs` L124-146](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/provider/handlers/mod.rs#L124-L146) | Replace with a payment-context extractor. |
| **Lease accounting** | Spawn: `duration_secs = payment_msats / spec.rate_msats_per_sec`, with a minimum duration check. Top-up: `extension_secs = payment_msats / rate`, then `expires_at += extension_secs`. | [`handlers/spawn.rs` L99-148](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/provider/handlers/spawn.rs#L99-L148); [`handlers/topup.rs` L110-148](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/provider/handlers/topup.rs#L110-L148) | Keep as-is; feed it the TOON amount. |
| **Expiry and cleanup** | Every 30 s, reap workloads with `expires_at <= now`: stop, then delete unconditionally, then untrack. | [`src/provider/cleanup.rs` L10-60](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/provider/cleanup.rs#L10-L60) | Keep. This is the "stop on non-payment" rule TOON lacked. |
| **Streaming keepalive** | "buy the lease in small pre-paid intervals, auto-renewed before each lapses ... Max loss on any failure is one interval, and failover is just 'stop paying npub A, start paying B'." Uses `renewal_amount_msats = interval × rate`, `should_renew`, `decide_tick`, and a budget stop. | [`src/client/keepalive.rs` L1-110](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/client/keepalive.rs#L1-L110) | **This is the prepaid-tick model**, already implemented. Swap `TokenSource` for a TOON packet sender. |
| **Compute backends** | `ComputeBackend` trait: `find_available_id`, `create_container`, `start`, `stop`, `delete`, `get_node_status`, `get_container_ip`, `get_container_status`. Implementations: LXD, Proxmox, Docker and KVM. `ContainerConfig` carries image, cpu, memory, storage, SSH, ports, env, `data_path` and a LUKS key. | [`src/compute.rs` L59-110](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/compute.rs#L59-L110); `src/{lxd,proxmox,docker,kvm}.rs` | Keep. Akash's k8s code could become a fifth backend (§6). |
| **Isolation tiers** | `shared-kernel` (LXD, Proxmox, Docker) and `dedicated-host` (KVM). `attested-research-tier` is not implemented. The CLI verifies the offer **before** spending. | README "Isolation tiers"; [`wire.rs` L231](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/nostr/wire.rs#L231); [`src/discovery.rs` L377-397](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/discovery.rs#L377-L397) | Keep. |
| **Capabilities** | Exact, case-insensitive capability matching (`lxc`, `vm`, `docker`, `nesting`), checked by the consumer before paying. | [`src/capabilities.rs` L1-30](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/capabilities.rs#L1-L30) | Keep; a lighter stand-in for Akash placement attributes. |
| **Durable workloads** | `ReplicationMode::{None, Checkpointed, WarmStandby}`, a single-writer invariant, and heartbeat quorum across M-of-N relays (`QuorumConfig { m, n, t1_secs, t2_secs, stale_secs }`). A standby promotes only after seeing the primary's revocation. | [`src/durable_workload.rs` L1-6, L13-24, L84-96](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/durable_workload.rs#L1-L96); `src/provider/standby.rs`, `orchestrator.rs` | Keep. Payment implication: the consumer pays N providers (§3.3). |
| **Blossom client** | BUD-01/02/04/06 subset (`PUT /upload`, `GET`, `DELETE`, `HEAD /upload`) with `kind:24242` auth. Callers encrypt through `blossom_crypto`, "so the server only ever sees ciphertext". Used for warm-standby checkpoints (`state_uri`). | [`src/blossom.rs` L1-40](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/blossom.rs#L1-L40); [`wire.rs` L324-327](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/nostr/wire.rs#L324-L327) | Point it at Lading or any Blossom server (§5). |
| **Templates** | A vetted registry (`NostrRelay`, `InferenceEndpoint`, `HeadlessBrowser`, `BitcoinNode`, `AgentSandbox`, `OpenClaw`, `CiCoordinator`). Only keys in `consumer_env` are honoured. | [`src/templates.rs` L1-30](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/templates.rs#L1-L30); [`wire.rs` L96-111](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/nostr/wire.rs#L96-L111); `templates/*/docker-compose.yml` | Keep. The TOON relay itself could become a template. |
| **Reputation** | "Pure scoring math over signed completion receipts". A receipt is co-signed by consumer and provider and bound to a `PaymentProof { mint_url, swap_response_signature }`. Sybil weighting: minimum consumer history of 30 days, and at most 20% of a consumer's receipts to one counterparty. | [`src/reputation.rs` L1-60, L90](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/reputation.rs#L1-L60) | Keep the math; swap the proof (§3.4). **Not wired:** there is no receipt kind in `kinds.rs`, and the snapshot binary builds `receipts: Vec::new()` ([`src/bin/paygress_snapshot.rs` L114](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/bin/paygress_snapshot.rs#L114)). |
| **Stake** | JoinMarket-style fidelity bond: a CLTV-timelocked Bitcoin UTXO plus a signature binding it to the provider npub. "there is no on-chain slashing". Verified against two Esplora endpoints. | [`src/stake.rs` L1-80, L121](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/stake.rs#L1-L80) | Pattern only; Bitcoin-specific (§7, question 6). |
| **Observatory** | Aggregates the marketplace's Nostr footprint into a JSON snapshot for a static dashboard. | [`src/observatory/mod.rs`](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/observatory/mod.rs); `dashboard/` | Keep. |
| **Consumer tooling** | CLI (`list`, `spawn`, `topup`, `status`, `batch`, `deploy`, `exec`), an MCP server with six tools, `ci up`/`ci deploy` (ngit-ci plus act), and a WireGuard tunnel for providers behind NAT. | README; `src/cli/commands/` | Keep; replace wallet commands. |

### 1.3 Gaps compared with Akash

| Akash has | Paygress | Consequence |
|---|---|---|
| Reverse auction (order, bid, lease) | Posted price per tier; the consumer picks | Simpler. Bid equivocation and one-lease-per-order problems disappear (§3.5). Price discovery is weaker. |
| SDL: multi-service, multi-group, placement attributes | One container or VM per lease, templates, capability strings | Multi-service apps need several leases or a future SDL layer. |
| Kubernetes provider with inventory, hostname and IP operators | LXD, Proxmox, Docker, KVM on one host; k8s removed in #76 | Easier to run; no cluster scale-out. |
| Auditor-signed attributes (x/audit) | Self-asserted `location`, `capabilities`, `uptime_percent`, `total_jobs_completed` | Add auditor labels (§4). |
| Registry-agnostic image pulls through k8s | `docker run <image>` on the Docker backend ([`src/docker.rs` L81-138](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/docker.rs#L81-L138)) | Needs a digest-pinned pull path (§5). |
| Lease shell, logs and status over an mTLS or JWT gateway | SSH credentials in the access details, plus an HTTP exec endpoint in the sandbox template | Fine for an MVP. |

---

## 2. What TOON already provides, and what is missing

### 2.1 Inventory

| Capability | What exists | Status | Source |
|---|---|---|---|
| **Payment proxy (connector)** | A paid reverse proxy: "it terminates payments the way nginx terminates SSL". Two roles only, connector and app. One Rust binary, one TOML file. | Live on devnet | [toon-meta context.md L5-24](https://github.com/toon-protocol/toon-meta/blob/d0d79ffbe48c143162a1db7456d769c3058e4dca/context/context.md#L5-L24); [architecture.md](https://github.com/toon-protocol/toon-meta/blob/d0d79ffbe48c143162a1db7456d769c3058e4dca/context/architecture.md) |
| **Payment channels** | "A two-party agreement, anchored on a chain ... touching the chain only to open, top up, and close". At most one live per pair per token. Claims are cumulative signed state. | Live: Base Sepolia `TokenNetworkRegistry` and Solana devnet program | [connector CONTEXT.md L311-395](https://github.com/toon-protocol/connector/blob/586598c4448e9531a25849b72664544eda008ac2/CONTEXT.md#L311-L395); [README L233-273](https://github.com/toon-protocol/connector/blob/586598c4448e9531a25849b72664544eda008ac2/README.md#L233-L273) |
| **EVM channel contract** | `TokenNetwork`: open with a 1 h minimum settlement timeout, `setTotalDeposit`, `claimFromChannel` (EIP-712 balance proof), close, settle, `forceCloseExpiredChannel`, and an immutable `token`, `maxChannelDeposit` and `maxChannelLifetime`. **The owner can `pause()` and, while paused, `emergencyWithdraw` the whole token balance.** | Base Sepolia | [TokenNetwork.sol L26-35, L478-500](https://github.com/toon-protocol/connector/blob/586598c4448e9531a25849b72664544eda008ac2/packages/contracts/src/TokenNetwork.sol#L478-L500) |
| **Sealed payloads** | "Every packet's `data` is a gift wrap", sealed to the terminating connector's identity key in both directions. | Live | [ADR 0018 L27-33](https://github.com/toon-protocol/connector/blob/586598c4448e9531a25849b72664544eda008ac2/docs/adr/0018-a-payload-is-sealed-to-the-terminating-connector.md#L27-L33) |
| **Paid request to app** | The app gets plain HTTP plus `X-TOON-Payer` (`evm:0x…` / `solana:…`), `X-TOON-Amount` and `X-TOON-Chain`. "Absence means 'this hop did not take the payment' — never 'unpaid'." | Live | [relay README L194-209](https://github.com/toon-protocol/relay/blob/f6a3354ef8b832cc91933cd8688a12b17d49c657/README.md#L194-L209); [connector CONTEXT.md L24-30](https://github.com/toon-protocol/connector/blob/586598c4448e9531a25849b72664544eda008ac2/CONTEXT.md#L24-L30) |
| **Client destinations** | A packet addressed to a live BTP client session. The connector never derives the fulfilment, so the client can receive arbitrary amounts with a hashlock. | Built | [ADR 0032](https://github.com/toon-protocol/connector/blob/586598c4448e9531a25849b72664544eda008ac2/docs/adr/0032-a-client-destination-is-never-a-route-termination.md) |
| **Pricing model** | A route price is `base + per_kib × ceil(len/1024)`, a schedule over payload length. "Pricing granularity is handler granularity." | Live | [connector CONTEXT.md L406-428](https://github.com/toon-protocol/connector/blob/586598c4448e9531a25849b72664544eda008ac2/CONTEXT.md#L406-L428) |
| **Relay** | A Nostr relay "you get paid to write to". Reads are free NIP-01. Writes come only through the connector (`g.toon.relay`, 1 µUSDC). A free `g.toon.relay.ephemeral` lane accepts ephemeral kinds only, rate-limited and never stored. NIP-09 and NIP-40 supported. **No NIP-42 AUTH or NIP-11.** | Live | [README](https://github.com/toon-protocol/relay/blob/f6a3354ef8b832cc91933cd8688a12b17d49c657/README.md); [ConnectionHandler.ts L78-157](https://github.com/toon-protocol/relay/blob/f6a3354ef8b832cc91933cd8688a12b17d49c657/packages/relay/src/websocket/ConnectionHandler.ts#L78-L157); [write-ephemeral-handler.ts](https://github.com/toon-protocol/relay/blob/f6a3354ef8b832cc91933cd8688a12b17d49c657/packages/relay/src/launcher/handlers/write-ephemeral-handler.ts#L1-L30) |
| **Discovery** | "A connector's URL resolves to its self-description" (addresses, sealing key, routes, prices, chains). | Live | [architecture.md L69](https://github.com/toon-protocol/toon-meta/blob/d0d79ffbe48c143162a1db7456d769c3058e4dca/context/architecture.md#L69) |
| **Identity** | A Nostr key is the user identity. The settlement key derives on NIP-06 `m/44'/1237'/0'/0/0`. A connector has a separate signer. "a claim, never an identity, authorises" (ADR 0052). | Live | [decisions.md](https://github.com/toon-protocol/toon-meta/blob/d0d79ffbe48c143162a1db7456d769c3058e4dca/context/decisions.md) |
| **Token stance** | The contract is token-parameterized; fleet policy is "USDC is the sole user-facing token". | Policy | [decisions.md L39](https://github.com/toon-protocol/toon-meta/blob/d0d79ffbe48c143162a1db7456d769c3058e4dca/context/decisions.md#L39) |
| **TEE stance** | "Trust degrades; money doesn't. Attestation state changes never trigger payment-channel closure." | Decision | [decisions.md L48](https://github.com/toon-protocol/toon-meta/blob/d0d79ffbe48c143162a1db7456d769c3058e4dca/context/decisions.md#L48) |

### 2.2 Gaps, and which ones Paygress closes

| Gap | Closed by Paygress? |
|---|---|
| **Lease primitive** (recurring payment keyed to a running resource, stop on non-payment) | **Yes.** `expires_at`, top-up, cleanup loop and keepalive (§1.2). |
| **Provider offers, liveness, capacity** | **Yes**, under renumbered kinds. |
| **Failover and durability** | **Yes.** Warm standby and checkpoints. |
| **Reputation math** | **Partly.** The math exists; receipt publication and a TOON payment proof do not. |
| **Variable-amount payment to an app** (a lease-specific rate against fixed route prices) | **No.** Same shape as `ngx_l402`'s fixed per-location amount (§3.1). |
| **Relay auth and metadata privacy** (NIP-42, NIP-11) | **No.** Less pressing if requests travel as sealed packets instead of relay DMs. |
| **OCI image path** | **No** (§5). |
| **Auditor attestations** | **No** (§4). |
| **Rust TOON client** (only if the provider or CLI must originate packets) | **UNVERIFIED** whether one exists. The connector is a Rust workspace; `toon-client` is TypeScript. |

---

## 3. Porting Paygress onto TOON

### 3.1 Transport and payment: HTTP mode behind a TOON connector

Paygress already separates payment termination from the provider in HTTP mode: `ngx_l402` redeems, then forwards to the axum app ([`provider_http.rs` L1-7](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/provider_http.rs#L1-L7)). A TOON connector has the same role ("terminates payments the way nginx terminates SSL"). The port:

```
consumer ──sealed paid packet──▶ provider's TOON connector ──HTTP + X-TOON-*──▶ paygress provider (axum)
          ◀──sealed response────                            ◀──JSON access details──
```

| Paygress (HTTP mode) | TOON port |
|---|---|
| nginx location `/pods/spawn`, `/pods/topup` with `l402 on` | Connector routes, for example `g.<provider>.compute.spawn` and `.topup`, forwarding to `http://paygress:8080/pods/...` |
| `Authorization: Cashu <token>` → `extract_token_value` → msats | `X-TOON-Amount` (plus `X-TOON-Chain`) → base units → `duration = amount / rate` |
| Consumer npub from the DM sender | `X-TOON-Payer` (channel key). Bind it to the consumer's Nostr pubkey with a signed Nostr event in the body (**open**, §7 question 4). |
| Access details (SSH password) returned in a NIP-17 DM | The HTTP response, sealed back to the consumer by the connector (ADR 0018). No relay DM needed. |
| `/offers`, `/health` free | Free connector self-description, or free unpaid routes. **UNVERIFIED** whether the connector supports zero-priced routes. |
| Lightning sweep from the shared CDK wallet | The connector operator's `POST /channels/:id/redeem-latest` |
| Mint whitelist | The connector's accepted chains and tokens |

**Variable amounts (the main open question).**
- **The constraint:** a route price is a fixed schedule over payload length, but a spawn should buy `interval × rate` for a consumer-chosen interval and a tier-specific rate. `ngx_l402` has the same constraint (`l402_amount_msat_default 6000`), and Paygress sidesteps it by reading the token's face value.
- **Options:**
  - **(a) One route per tier and interval.** For example `…spawn.basic.10m` priced at `rate × 600`, and top-up in fixed tick units. Simplest, and it matches the keepalive's fixed-interval model.
  - **(b) Unit-priced route, N packets per purchase.** Costs more hop fees and latency.
  - **(c) Client destination.** The provider daemon holds a BTP session and receives arbitrary amounts. The provider then needs a TOON client in Rust.
  - **(d) Overpayment accepted and surfaced in `X-TOON-Amount`.** **UNVERIFIED:** docs describe it as "the route's price".
- **Recommendation for the MVP:** (a).

The Nostr DM path (NIP-17 plus a token) can stay as a fallback for consumers without a TOON channel, or be removed. NIP-04 support should be removed either way.

### 3.2 Event kinds and the relay

| Paygress kind | Issue on TOON | Port |
|---|---|---|
| `38383` offer | Collides with NIP-69 "Peer-to-peer Order events" in the [NIPs README kind table](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/README.md) | `K_OFFER`, addressable. One paid write per offer change. |
| `38384` heartbeat history (per-minute `d` bucket) | A **paid write every 60 s per provider**: about 1,440 µUSDC per day at the devnet price, and the relay stores it | Drop, or publish hourly rollups. Uptime history could come from an external monitor instead (NIP-66 pattern, §4). |
| `20384` ephemeral heartbeat | Fits the free `g.toon.relay.ephemeral` lane | `K_LIVENESS`. Check the lane's rate limit against a 60 s cadence (**UNVERIFIED** limit value). |
| `38385` lease revocation | Needed for single-writer failover | `K_REVOCATION`, addressable, paid |
| `38386` standby promotion | Same | `K_PROMOTION`, addressable, paid |

**Relay quorum.** Paygress's failover watches heartbeats across M-of-N relays. If the ephemeral lane is TOON-only, run N TOON relays, or also publish liveness to non-TOON relays (NIP-65).

### 3.3 Lease payments over TOON channels

- **The model is already coded.**
  - The keepalive renews `interval × rate` before each interval lapses.
  - The provider extends `expires_at`.
  - The cleanup loop destroys the workload at expiry.
  - "Max loss on any failure is one interval" ([keepalive.rs L1-5](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/client/keepalive.rs#L1-L5)).
- **The TOON change:** `TokenSource::mint_token` becomes "send a paid packet to the top-up route". Claims are cumulative, so a lost claim "costs nothing" ([connector CONTEXT.md L320-325](https://github.com/toon-protocol/connector/blob/586598c4448e9531a25849b72664544eda008ac2/CONTEXT.md#L320-L325)).
- **Exposure:**
  - The provider bills in advance, so its exposure is zero beyond cleanup lag (≤ 30 s).
  - The consumer risks one interval.
  - There is no refund, as with Cashu today.
- **Warm standby:**
  - The consumer pays the primary and every standby.
  - Standbys reserve slots with `expires_at` ([`handlers/spawn.rs` L434-500](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/provider/handlers/spawn.rs#L434-L500)).
  - With channels, that means one channel per provider pair: N channel opens.
  - **Open:** whether standbys are paid a reservation rate.
- **Channel lifecycle:**
  - Each consumer-provider pair needs an open channel, which costs on-chain gas and needs a deposit bounded by `maxChannelDeposit`/`maxChannelLifetime`.
  - Paygress's per-spawn anonymity (a throwaway key plus a bearer token) weakens, because a channel links repeat purchases to one payer key.
  - Paying through a connector hop instead of a direct channel restores some unlinkability, at the cost of hop fees. **UNVERIFIED:** privacy properties of multi-hop TOON routing.

### 3.4 Reputation and stake

- **Receipts:**
  - Replace `PaymentProof { mint_url, swap_response_signature }` with a TOON channel claim reference, such as the chain, channel id, cumulative amount and signature. A claim is verifiable against the `TokenNetwork` contract's EIP-712 domain without trusting a mint.
  - Allocate `K_RECEIPT` and publish co-signed receipts, which Paygress never wired up.
  - Keep `score_provider` and `SybilHeuristics`.
- **Scores:** publish computed scores as NIP-85 trusted assertions (`30382`) so any tenant can choose a scorer.
- **Stake:** Paygress's bond is a Bitcoin CLTV UTXO. TOON equivalents (all **open**):
  - a long-lived, over-deposited channel as a visible bond, which isn't really locked because the owner can close it;
  - a USDC timelock contract on Base or Solana;
  - no stake at all, relying on receipts and auditors.

  Paygress's own framing, "posted a Bitcoin bond", not "more reliable", should carry over.

### 3.5 Trust properties compared with Akash

| Property on Akash | Paygress on TOON | Notes |
|---|---|---|
| Final on-chain record that a lease exists | None. Evidence is the channel claims plus the sealed response and any co-signed receipt. | Same as Paygress today. |
| One lease per order; bid equivocation | **Not applicable**: posted prices, no bids | Weaker price discovery. |
| Bid deposit as spam cost | Paid relay writes for offers; the consumer pays before anything is provisioned | The provider's spam risk is low because payment comes first. |
| Escrow refunds | None; prepaid intervals are sunk | Keep intervals short. |
| Auditor-signed attributes | None yet | §4 |
| Service-quality disputes | Akash has none either; the consumer stops paying | Parity |
| Custody of lease funds | Channel deposit in `TokenNetwork`, whose owner holds `pause` plus `emergencyWithdraw` | Must be resolved before mainnet (§7). |

---

## 4. NIPs for the Paygress-on-TOON control plane

Statuses are read from each file's header at the pinned commit.

| NIP | Header status | Role | Fit | Notes |
|---|---|---|---|---|
| [01](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/01.md#L97-L99) | `draft` `mandatory` | Offer, revocation and promotion storage | **Core** | Addressable `30000-39999` (latest per `(kind, pubkey, d)`); ephemeral `20000-29999` for liveness. |
| [40](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/40.md#L9) | `draft` `optional` | Offer TTL | Good | Enforced by the TOON relay; advisory only. |
| [89](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/89.md#L9) | `draft` `optional` | Alternative offer envelope; `31989` curated provider lists | Optional | A `31990` handler with `k` tags could advertise the compute kinds so generic clients find providers. Paygress's own offer schema is richer. |
| [90](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/90.md#L7-L9) DVM | **`unrecommended`**: "prefer use-case-specific microstandards" | — | Skip | Paygress is already a use-case-specific microstandard; spawn and top-up don't need job request and result kinds. |
| [99](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/99.md#L9-L49) | `draft` `optional` | Human-browsable rate cards | Optional | `30402` with `price [amount, currency, frequency]`. |
| [69](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/69.md#L17-L71) | `draft` `optional` | — | **Conflict** | Owns kind `38383`, which Paygress uses for offers. |
| [05](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/05.md#L11) | `final` `optional` | Provider domain identity | Good | Binds the provider npub to the `hostname` in its offer. |
| [32](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/32.md#L9) | `draft` `optional` | Auditor attributes (`region`, `gpu`, verified `isolation_level`) | **Good** | `kind:1985`, `L` namespace. Turns self-asserted offer fields into audited ones. |
| [58](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/58.md#L12-L19) | `draft` `optional` | Auditor tiers | Good | `30009` definition, `8` award. |
| [85](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/85.md#L13-L20) | `draft` `optional` | Published reputation scores | Good | `30382`; users list trusted scorers with `10040`. |
| [56](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/56.md#L9-L33) | `optional` | Abuse reports | Good | `kind:1984`. |
| [66](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/66.md#L13-L63) | `draft` `optional` | Third-party uptime monitoring | Pattern | Replaces the paid `38384` history with monitor observations. |
| [65](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/65.md#L9-L20) | `draft` `optional` | Multi-relay quorum set | Good | `kind:10002`; feeds Paygress's M-of-N relay set. |
| [98](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/98.md#L15-L56) | `draft` `optional` | Free authenticated calls (status, exec) outside the paid path | Good | `kind:27235`; same pattern as Paygress's Blossom `24242`. |
| [44](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/44.md#L87) / [59](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/59.md#L18-L41) / [17](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/17.md#L63-L83) | `optional` | Fallback DM path | Fallback | Paygress uses these today. Relays SHOULD gate `1059` reads with NIP-42 (17.md L81), which the TOON relay lacks. |
| [04](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/04.md) | `unrecommended` | — | Remove | Paygress still subscribes to `kind:4`. |
| [B7](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/B7.md#L7-L30) Blossom | `draft` `optional` | Checkpoints, images | **Good** | Paygress already speaks it; Lading serves it. |
| [60](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/60.md#L20-L22) / [61](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/61.md#L9-L20) Cashu | `draft` `optional` | What TOON replaces | Contrast | Paygress's current payment rail. A mint-custodied bearer token versus a chain-backed channel claim. |

---

## 5. Lading as the object store

### 5.1 What it is (from source)

- **Description:** "Archive broker for agents on TOON. One channel, several storage networks (Arweave, Walrus, Filecoin), every leg answers with the network's own receipt or buys nothing, and a signed bill of lading named on ArNS" ([package.json](https://github.com/drew-dot-com/lading/blob/931f083d2372c1bec41d72a7bb8fa6c4be585b9d/package.json)).
- **Project:** MIT; v0.18.0; one author; first commit 2026-09-06.
- **Storage:** a `put` pays TOON routes per leg (Arweave `kind:5094`; Walrus, Filecoin and IPFS `kind:5320`), then signs a **`kind:30320` bill of lading with `d = sha256`** ([src/kinds.ts](https://github.com/drew-dot-com/lading/blob/931f083d2372c1bec41d72a7bb8fa6c4be585b9d/src/kinds.ts); [README L119-139](https://github.com/drew-dot-com/lading/blob/931f083d2372c1bec41d72a7bb8fa6c4be585b9d/README.md#L119-L139)). Objects are addressed by sha256, and puts are idempotent by hash.
- **Limits:**
  - One ILP packet is capped at 2 MiB, so larger objects go as 1 MiB parts, each "its own paid job on each network" (README L254-262).
  - The gate body cap is 3 MiB ([gate.ts L82](https://github.com/drew-dot-com/lading/blob/931f083d2372c1bec41d72a7bb8fa6c4be585b9d/src/gate.ts#L82)).
  - "50 MB is about 50 payments, 6 USDC and an hour" (README L192).
- **Blossom at the gate:**
  - Endpoints: `HEAD/PUT /upload`, `PUT /mirror`, `GET/HEAD /<sha256>`, and `DELETE` → 403 "an archive is permanent".
  - Upload auth is `kind:24242`, paid through prepaid credit per pubkey.
  - A GET is unauthenticated, fetches from the first answering leg, verifies the sha256 and returns **the whole buffer**. Range requests are "Not built yet" ([docs/blossom.md](https://github.com/drew-dot-com/lading/blob/931f083d2372c1bec41d72a7bb8fa6c4be585b9d/docs/blossom.md); [blossom.ts L331-431](https://github.com/drew-dot-com/lading/blob/931f083d2372c1bec41d72a7bb8fa6c4be585b9d/src/blossom.ts#L331-L431)).
  - **UNVERIFIED:** whether a GET reassembles parts-uploaded objects.
- **Privacy:** "Arweave, Walrus, Filecoin and IPFS data are public. Encrypt client-side if it matters." (README L535.)

### 5.2 Checkpoints: a natural fit

- **Why it fits:** Paygress warm-standby and `Checkpointed` modes already write **client-side-encrypted** blobs to a Blossom server with `kind:24242` auth, and hand the standby a `state_uri` ([blossom.rs L1-10](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/blossom.rs#L1-L10); [wire.rs L324-327](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/nostr/wire.rs#L324-L327)). Lading's gate speaks the same protocol, so pointing Paygress's Blossom client at Lading should need little or no code. **UNVERIFIED:** not tested end to end.
- **Caveats:**
  - **Permanence:** every checkpoint is stored forever and can't be deleted, and Paygress's client issues `DELETE`. It is ciphertext, but it is permanent ciphertext; key compromise later exposes all of history.
  - **Cost and latency:** frequent checkpoints of large volumes at archive prices may be uneconomic.
  - **Recommendation:** use Lading for **infrequent, durable** checkpoints, and an ordinary deletable Blossom server for frequent ones.

### 5.3 Images: archive, not hot path

- **Current behaviour:** Paygress's Docker backend passes `config.image` to `docker run` ([docker.rs L81-138](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/src/docker.rs#L81-L138)), so the Docker daemon pulls from a registry. Consumer-supplied images are constrained by the vetted template registry when `template_slug` is set.
- **Why Lading can't be the registry:**
  - Docker needs the OCI Distribution API (`GET /v2/<name>/manifests/<ref>`, `GET /v2/<name>/blobs/<digest>`; [distribution-spec L845-863](https://github.com/opencontainers/distribution-spec/blob/97274622c11112caa21efb8c52acca3c6b8fa7f1/spec.md#L845-L863)). Lading has no `/v2/` API.
  - OCI blob digests are `sha256:<hex>` of the bytes, as are Lading's keys, so a read-only shim can map one to the other.
- **Why it's still a poor primary pull source:** whole-object buffering, no Range, archive latency, and per-MiB multi-network pricing for multi-GB images.
- **Recommendation:**
  1. Push images to Lading once, as a provenance-signed archive (the `kind:30320` doubles as supply-chain evidence).
  2. Run a **provider-local pull-through OCI cache** that fetches blobs by digest from Lading, IPFS or any Blossom server and verifies them.
  3. Spawn requests and templates reference images **by digest** (`<cache>/<name>@sha256:…`).
  4. Store tags as a signed addressable event `K_IMAGE_TAG`.
- **UNVERIFIED:** which registry (CNCF Distribution, zot) takes a custom blob source cheaply; how LXD and KVM backends consume OCI images.

---

## 6. What to borrow from Akash later

All Apache-2.0 (see the earlier doc). None of it is needed for the MVP.

| Feature | Akash source | How it fits Paygress |
|---|---|---|
| Kubernetes execution, inventory, hostname ingress, MetalLB IPs | [provider `cluster/kube`](https://github.com/akash-network/provider/tree/b7036c6de7e6b9fe852b7e32fb10d5a3efd04d4f/cluster/kube), [`operator/`](https://github.com/akash-network/provider/tree/b7036c6de7e6b9fe852b7e32fb10d5a3efd04d4f/operator) | A fifth `ComputeBackend`. It is Go, so it would run as a sidecar service the Rust provider calls. It is shaped around Akash `LeaseID`/`GroupSpec` types, so it needs adaptation. |
| Multi-service deployments (SDL) | [chain-sdk `go/sdl`](https://github.com/akash-network/chain-sdk/tree/ace99a2a5274ff46f0b18219dfc5084402c9a2f2/go/sdl) | A richer spawn body. Pricing moves from `denom` to channel token per interval. |
| Reverse auction and pricing strategies | [bidengine `pricing.go` L89-253](https://github.com/akash-network/provider/blob/b7036c6de7e6b9fe852b7e32fb10d5a3efd04d4f/bidengine/pricing.go#L89-L253) | An optional RFQ mode alongside posted prices: an order event, addressable bids with `d = order id`, and payment of the first interval as acceptance. |
| Manifest hashing for integrity | [manifest/v2beta3 `Version()` L50-67](https://github.com/akash-network/chain-sdk/blob/ace99a2a5274ff46f0b18219dfc5084402c9a2f2/go/manifest/v2beta3/manifest.go#L50-L67) | Put a spec hash in receipts so both sides sign what was bought. |
| TEE attestation endpoint | [gateway router L165-167](https://github.com/akash-network/provider/blob/b7036c6de7e6b9fe852b7e32fb10d5a3efd04d4f/gateway/rest/router.go#L165-L167) | Implements Paygress's unbuilt `attested-research-tier`. |

---

## 7. Open design questions

1. **Kind allocation.** Replace `38383`-`38386` and `20384`. Check the NIPs README table and TOON's existing kinds (`5094`-`5098`, Lading `5320`/`30320`) first. Decide whether to keep a Paygress-compatible wire format so upstream clients interoperate, or fork the schema.
2. **Variable amounts** (§3.1): route-per-interval (recommended for the MVP), N unit packets, client destination, or overpayment semantics (**UNVERIFIED**).
3. **Interval, fees and channel economics.** How the keepalive interval relates to per-packet hop fees. How many consumer-provider channels are practical, given one channel per pair, gas to open, and deposit caps.
4. **Payer to consumer binding.** `X-TOON-Payer` is a channel key, not a Nostr pubkey. Does the spawn body carry a signed Nostr event, and must the settlement key derive from the Nostr seed (NIP-06 path)?
5. **Privacy.** Paygress's "throwaway key plus bearer token" anonymity versus channels that link purchases. Is multi-hop routing enough?
6. **Stake without Bitcoin:** a USDC timelock contract, a visible channel deposit, or none.
7. **Receipt schema:** how a TOON claim becomes a verifiable `PaymentProof`, and where receipts are published.
8. **Auditor model:** NIP-32 labels versus NIP-58 badges, and whether TOON runs a default auditor.
9. **Heartbeat history:** paid rollups, external NIP-66-style monitors, or drop uptime from offers.
10. **Warm-standby billing:** do standbys charge a reservation rate, and how does failover move the payment stream?
11. **Upstream relationship.** Fork versus contribute a payment backend upstream. Paygress already has two payment paths (DM and HTTP), so a third, TOON, could plausibly live upstream. **UNVERIFIED:** maintainer appetite.
12. **Rust TOON tooling:** does the CLI need to originate TOON packets from Rust (FFI into the connector crates, a TS sidecar, or a new crate)? **UNVERIFIED** what exists.
13. **Checkpoint permanence** on Lading (§5.2).
14. **Channel contract trust:** the `TokenNetwork` owner's `pause` plus `emergencyWithdraw` ([TokenNetwork.sol L478-500](https://github.com/toon-protocol/connector/blob/586598c4448e9531a25849b72664544eda008ac2/packages/contracts/src/TokenNetwork.sol#L478-L500)) makes the owner a custodian of all lease collateral.
15. **Licensing:** Paygress is Apache-2.0 (a fork must keep NOTICE and attribution), while relay, toon-client and store have no license detected by GitHub.
16. **Name:** "Akash" isn't ours to use (earlier doc). Whether to keep the Paygress name depends on the fork versus upstream decision.

---

## 8. Suggested phased MVP

| Phase | Scope | Reused | New | Exit test |
|---|---|---|---|---|
| **P0: spec** | Kinds, route naming per tier and interval, spawn and top-up bodies with the payer binding, and a receipt schema. Resolve questions 1, 2 and 4. | Paygress `wire.rs` types | Spec doc (and ADRs in `docs/adr/`) | A fresh implementer can build every event and request from the doc. |
| **P1: paid spawn behind a connector** | Fork Paygress. Run the provider in HTTP mode behind a devnet TOON connector. Replace `payment_token`/`extract_token_value` with an `X-TOON-*` extractor. | `provider_http.rs`, handlers, backends, cleanup | Payment extractor; connector route config | A Docker-backend container spawns from a paid packet; access details return sealed. |
| **P2: keepalive and expiry** | A `TokenSource` replacement that pays the top-up route each interval. Stop paying and the cleanup loop destroys the workload. | `client/keepalive.rs`, `cleanup.rs` | TOON top-up sender (question 12) | Stop paying and the workload is gone within interval + 30 s; claims redeem on Base Sepolia. |
| **P3: offers and liveness on the TOON relay** | `K_OFFER` (paid), `K_LIVENESS` (ephemeral lane). Drop the per-minute history kind. The CLI lists providers from the TOON relay. | `discovery.rs`, `subscriber/publish.rs` | New kinds; offer fields for chain, token and connector URL | `list --online-only` shows a devnet provider. |
| **P4: images via Lading** | Push an image to Lading; the provider-local OCI cache pulls by digest; templates pinned by digest. | Lading (as-is) | Cache or shim; `K_IMAGE_TAG` | Template spawns with no external registry. |
| **P5: reputation and identity** | Co-signed receipts with TOON claim proofs, NIP-85 scores, NIP-05 provider domains, NIP-32 auditor labels. | `reputation.rs`, `observatory/` | Receipt kind, claim proof, scorer publisher | Dashboard ranks providers from published receipts. |
| **P6: durability** | Warm standby and checkpoints with TOON payments to N providers; checkpoints to Blossom or Lading. | `durable_workload.rs`, `standby.rs`, `blossom.rs` | Multi-provider payment stream | Kill the primary; a standby promotes and the payment stream follows. |

**Smallest end to end slice (P1 + P2, one provider, devnet):**

1. A Paygress provider (Docker backend) runs behind a TOON connector.
2. The consumer pays the `basic.10m` spawn route over a Base Sepolia channel.
3. The container starts, and the SSH details come back in the sealed response.
4. The keepalive pays the top-up route every 10 minutes.
5. The consumer stops paying, and the container is destroyed.

---

## Sources

**Paygress** @ [`c92b8704`](https://github.com/DhananjayPurohit/Paygress/tree/c92b870485cacbb3c526982c89630298f5cedfb4) (Apache-2.0)
- [README.md](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/README.md), [Cargo.toml](https://github.com/DhananjayPurohit/Paygress/blob/c92b870485cacbb3c526982c89630298f5cedfb4/Cargo.toml)
- `src/nostr/kinds.rs`, `src/nostr/wire.rs`, `src/nostr/subscriber/mod.rs`, `src/provider_http.rs`, `src/cashu.rs`, `src/provider/handlers/{mod,spawn,topup}.rs`, `src/provider/cleanup.rs`, `src/client/keepalive.rs`, `src/compute.rs`, `src/docker.rs`, `src/capabilities.rs`, `src/discovery.rs`, `src/durable_workload.rs`, `src/blossom.rs`, `src/templates.rs`, `src/reputation.rs`, `src/stake.rs`, `src/observatory/`, `src/bin/paygress_snapshot.rs`, `nginx/conf.d/paygress-l402.conf` (linked inline)
- PR [#76](https://github.com/DhananjayPurohit/Paygress/pull/76) (Kubernetes removed)

**TOON** (pinned commits above)
- connector: [CONTEXT.md](https://github.com/toon-protocol/connector/blob/586598c4448e9531a25849b72664544eda008ac2/CONTEXT.md), [README.md](https://github.com/toon-protocol/connector/blob/586598c4448e9531a25849b72664544eda008ac2/README.md), [ADR 0018](https://github.com/toon-protocol/connector/blob/586598c4448e9531a25849b72664544eda008ac2/docs/adr/0018-a-payload-is-sealed-to-the-terminating-connector.md), [ADR 0032](https://github.com/toon-protocol/connector/blob/586598c4448e9531a25849b72664544eda008ac2/docs/adr/0032-a-client-destination-is-never-a-route-termination.md), [TokenNetwork.sol](https://github.com/toon-protocol/connector/blob/586598c4448e9531a25849b72664544eda008ac2/packages/contracts/src/TokenNetwork.sol)
- relay: [README.md](https://github.com/toon-protocol/relay/blob/f6a3354ef8b832cc91933cd8688a12b17d49c657/README.md), [ConnectionHandler.ts](https://github.com/toon-protocol/relay/blob/f6a3354ef8b832cc91933cd8688a12b17d49c657/packages/relay/src/websocket/ConnectionHandler.ts), [write-ephemeral-handler.ts](https://github.com/toon-protocol/relay/blob/f6a3354ef8b832cc91933cd8688a12b17d49c657/packages/relay/src/launcher/handlers/write-ephemeral-handler.ts)
- toon-meta: [context/context.md](https://github.com/toon-protocol/toon-meta/blob/d0d79ffbe48c143162a1db7456d769c3058e4dca/context/context.md), [context/architecture.md](https://github.com/toon-protocol/toon-meta/blob/d0d79ffbe48c143162a1db7456d769c3058e4dca/context/architecture.md), [context/decisions.md](https://github.com/toon-protocol/toon-meta/blob/d0d79ffbe48c143162a1db7456d769c3058e4dca/context/decisions.md)

**Nostr** (NIPs @ [a2494f4f](https://github.com/nostr-protocol/nips/tree/a2494f4f81d46684e5814a9bf35e2b1df978f955))
- 01, 04, 05, 17, 32, 40, 44, 56, 58, 59, 60, 61, 65, 66, 69, 85, 89, 90, 98, 99, B7 (linked inline); kind table in [README.md](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/README.md)
- Blossom BUDs: https://github.com/hzrd149/blossom/tree/b5bd2801d1763aa635fc8fea7a76597e0eb18990/buds

**Lading** @ [931f083d](https://github.com/drew-dot-com/lading/tree/931f083d2372c1bec41d72a7bb8fa6c4be585b9d)
- README.md, docs/blossom.md, src/kinds.ts, src/blossom.ts, src/gate.ts, package.json

**OCI**
- Distribution spec endpoints: https://github.com/opencontainers/distribution-spec/blob/97274622c11112caa21efb8c52acca3c6b8fa7f1/spec.md#L845-L863

**Akash** (pins as in [akash-toon-integration.md](./akash-toon-integration.md))
- provider: cluster/kube, operator/, bidengine/pricing.go, gateway/rest/router.go
- chain-sdk: go/sdl, go/manifest/v2beta3

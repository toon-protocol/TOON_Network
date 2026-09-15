# Akash x TOON: smart contracts, payments, integration options, open source status

Research date: **2026-09-15**. Sources are primary: Akash source code at pinned tags or commits, AEPs, Akash's own docs (from the `akash-network/website` repo), live mainnet state read through the public LCD `https://api.akashnet.net` (chain `akashnet-2`, block ~28,638,347 on 2026-09-15), and upstream CosmWasm (`wasmd`) source. Anything I could not trace to a primary source is marked **UNVERIFIED**.

Pinned references used below:

| Repo | Ref |
|---|---|
| `akash-network/node` | tag [`v2.1.1`](https://github.com/akash-network/node/releases/tag/v2.1.1) (latest stable, 2026-07-24, commit `0dbfd230`); tag `v2.0.1` for the v2.0.0 upgrade handler; `main` @ `9962f09` (2026-09-14) checked for drift (same `wasmd v0.61.7`) |
| `akash-network/chain-sdk` (`pkg.akt.dev/go`, successor of akash-api) | commit [`ace99a2a`](https://github.com/akash-network/chain-sdk/tree/ace99a2a5274ff46f0b18219dfc5084402c9a2f2) |
| `akash-network/provider` | commit [`b7036c6d`](https://github.com/akash-network/provider/tree/b7036c6de7e6b9fe852b7e32fb10d5a3efd04d4f) (2026-09-11) |
| `akash-network/console` | commit [`111de5af`](https://github.com/akash-network/console/tree/111de5afe5bc5bcf68d083df5f2c6741af1c6a84) |
| `akash-network/AEP` | commit [`76fe9ba9`](https://github.com/akash-network/AEP/tree/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d) (2026-09-08) |
| `akash-network/website` (source of akash.network/docs) | commit [`ead749cb`](https://github.com/akash-network/website/tree/ead749cb2f59a48fd6ff2e747bcc3f208133e6cf) |
| `CosmWasm/wasmd` | tag [`v0.61.7`](https://github.com/CosmWasm/wasmd/tree/v0.61.7) |
| TOON `connector` (local sibling repo) | commit `586598c4` |

---

## TL;DR

1. **Chain and contracts.** Akash runs its own Cosmos SDK app chain (`akashnet-2`: Cosmos SDK v0.53 and CometBFT v0.38, both Akash forks). **CosmWasm (`x/wasm`, wasmd v0.61.7) has been on mainnet since the v2.0.0 upgrade (2026-03-23).** It is **permissioned**, though. Code upload is `Nobody`, so only a governance proposal can store code. A custom message filter stops contracts from sending any native Akash message (deployment, escrow, market) or IBC message, and ACT cannot be sent to contracts at all. There is no EVM. Its only production use so far is the Pyth/Wormhole price oracle. A bigger point: **AEP-79 lays out a plan to move Akash off Cosmos entirely, rebuilt as Solana programs or as EVM contracts on an existing L2 (Base, Arbitrum One or Robinhood Chain are named).** The target chain is still open ("Gate 0") and no on-chain governance vote has happened yet.
2. **Payments.** Tenants fund a per-deployment escrow account (`x/escrow`) in **ACT (`uact`)**. ACT is a non-transferable, USD-pegged compute credit you get by burning AKT through the BME module. AKT is accepted only as a top-up fallback. The old axlUSDC (IBC) payment path was converted to ACT in the v2.0.0 upgrade. Leases accrue a price per block. Settlement is lazy: it happens when someone touches the account, usually the provider's periodic `MsgWithdrawLease`, and the provider is paid in ACT. **Third parties can pay.** Any account can `MsgAccountDeposit` into anyone's escrow, and the `DepositAuthorization` authz grant (plus feegrant for gas) lets a funder pay deposits for a deployment another address owns. Akash Console's managed-wallet or credit-card product is built on exactly that.
3. **Integration.** (a) A TOON channel contract on Akash is **technically possible only through a governance vote, and even then it could not hold ACT or fund escrow atomically**. Not recommended. (b) A CosmWasm chain over IBC (Osmosis, Neutron and so on) **cannot drive Akash deployments trustlessly**. Akash only has IBC `transfer`: no ICA host and no IBC hooks. So it ends up needing an off-chain relayer anyway. (c) **Recommended: an off-chain broker running as a TOON App behind a TOON connector.** Users pay over existing TOON channels (USDC on Base or Solana). The broker holds AKT, mints ACT, and funds deployments either custodially or through `DepositAuthorization` grants / `MsgAccountDeposit` top-ups. Users trust the broker for at most one top-up interval. (d) Console's managed wallet (derived custodial wallets, a funding master wallet, deposit grants, fee grants, AKT to ACT minting) is working Apache-2.0 prior art for (c). Build the broker behind a chain-adapter seam, because AEP-79 could move Akash onto Base or Solana, where TOON's channels already live.
4. **Open source.** Every core repo is **Apache-2.0**: node, provider, console (all apps), console-air, chain-sdk, akt CLI, AEPs, and the cosmos-sdk/cometbft forks. I found no closed or source-available core component; some minor repos have no license file. You can legally fork and rebuild it. "Akash on TOON" would mean keeping the provider daemon, SDL/manifest, and Kubernetes operators, and replacing the chain-coupled layer. That layer is `pkg.akt.dev/go` types, the bid engine's chain event feed, lease and escrow queries/transactions, and cert auth. AEP-79 already specifies that seam (`pkg/chain`) for Akash's own migration and estimates **142–200 person-months** for the full program. Streaming escrow maps well onto payment channels, but the order book and lease agreement still need a shared, neutral venue. You would also start with **zero providers**, the supply side is the real moat, and Apache-2.0 §6 grants no right to the "Akash" name.

---

## 1. What chain Akash runs on, and whether it has smart contracts

### 1.1 Chain stack

- `pkg.akt.dev/node/v2` builds on `github.com/cosmos/cosmos-sdk v0.53.6` and `github.com/cometbft/cometbft v0.38.21`, both replaced by Akash forks (`akash-network/cosmos-sdk v0.53.7-akash.2`, `akash-network/cometbft v0.38.21-akash.1`). IBC is `ibc-go/v10 v10.5.0` ([node `go.mod` L18-25, L63-67 @ v2.1.1](https://github.com/akash-network/node/blob/v2.1.1/go.mod#L18-L67)).
- On 2026-09-15, live mainnet `node_info` reported `network: akashnet-2`, app `akash` version `2.1.0`, CometBFT `0.38.19`. Source: `https://api.akashnet.net/cosmos/base/tendermint/v1beta1/node_info`. The v2.1.1 release appears to be a non-consensus patch on top of the v2.1.0 upgrade. That is **UNVERIFIED**, since I did not diff it.
- Upgrade history: `v2.0.0` was applied at height 26,063,777 ("Mainnet 17", gov proposal 318, which passed with voting ending 2026-03-14). `v2.1.0` was applied at height 27,230,465. Sources: `/cosmos/upgrade/v1beta1/applied_plan/{v2.0.0,v2.1.0}`, `/cosmos/gov/v1/proposals/318`, and [mintscan proposal 318](https://www.mintscan.io/akash/proposals/318).

### 1.2 CosmWasm is enabled (since v2.0.0), but locked down

**Module wiring (code):**

- `go.mod` requires `github.com/CosmWasm/wasmd v0.61.7` and `wasmvm/v3 v3.0.2` ([go.mod L18-19](https://github.com/akash-network/node/blob/v2.1.1/go.mod#L18-L19)).
- `wasm.AppModuleBasic{}` is registered in [app/config.go L64](https://github.com/akash-network/node/blob/v2.1.1/app/config.go#L64). Akash's guard module `awasm` and `wasmtypes.ModuleName` are in [app/app_configure.go L49, L89-90](https://github.com/akash-network/node/blob/v2.1.1/app/app_configure.go#L49-L90).
- The keeper is built in [app/types/app.go L487-532](https://github.com/akash-network/node/blob/v2.1.1/app/types/app.go#L487-L532). It installs `WithMessageHandlerDecorator(app.Keepers.Akash.Wasm.NewMsgFilterDecorator())` (L495-497) and adds the `"akash"` capability (L509-510). A wasm IBC route is added (L534-549).
- The stores `wasm` and `awasm` were added by the v2.0.0 upgrade `StoreLoader` ([upgrades/software/v2.0.0/upgrade.go L53-65 @ v2.0.1](https://github.com/akash-network/node/blob/v2.0.1/upgrades/software/v2.0.0/upgrade.go#L53-L65)).
- The design AEP is [AEP-78 "Enable CosmWasm Smart Contracts on Akash Network"](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-78/README.md), status **Final**, completed 2026-03-23. Its motivation mentions "creating programmable payment channels" and "Micropayment channels for real-time resource usage billing" ([L20, L47](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-78/README.md#L20-L47)). The shipped code is far more restrictive than that text (next bullets).

**Who can deploy contracts: not arbitrary users.**

- The v2.0.0 upgrade sets `params.CodeUploadAccess = AccessConfig{Permission: AccessTypeNobody}` with the comment "RESTRICTED TO GOVERNANCE ONLY", and `InstantiateDefaultPermission = AccessTypeEverybody` ([upgrade.go L101-115 @ v2.0.1](https://github.com/akash-network/node/blob/v2.0.1/upgrades/software/v2.0.0/upgrade.go#L101-L115)).
- In wasmd, the default authorization policy only allows `CanCreateCode` if `chainConfigs.Upload.Allowed(actor)`. The governance policy bypasses that check ([wasmd keeper/authz_policy.go L13-16, L58 @ v0.61.7](https://github.com/CosmWasm/wasmd/blob/v0.61.7/x/wasm/keeper/authz_policy.go#L13-L58)). Net effect: **only a gov proposal carrying `MsgStoreCode` can upload code.**
- Live params, 2026-09-15 (`/cosmwasm/wasm/v1/codes/params`): `{"code_upload_access":{"permission":"Nobody"},"instantiate_default_permission":"Everybody"}`.
- Live codes (`/cosmwasm/wasm/v1/code`): **5 code IDs**. All were created by `akash10d07y265gmmuvt4z0w9aw880jnsr700jhe7z0f`, which is the `gov` module account (`/cosmos/auth/v1beta1/module_accounts/gov`). All 5 have instantiate permission `Nobody`.
- The governance path works in practice. Proposals 335/336 (`MsgStoreCode`, pyth-vaa and pyth-pro), 337/338 (`MsgInstantiateContract`) and 340 (`MsgExecuteContract`) all passed in July to September 2026 as **expedited** proposals (`/cosmos/gov/v1/proposals`). Expedited voting is 1 day with a 2,000 AKT deposit. Normal voting is 7 days with 1,000 AKT (`/cosmos/gov/v1/params/voting`). Whether governance would accept third-party contract code is a political question. **UNVERIFIED / no precedent found**: every stored code so far is Akash's own oracle code.
- Akash's docs agree: "Contract code (StoreCode) can only be uploaded via governance proposal" ([application-layer docs L642-648](https://github.com/akash-network/website/blob/ead749cb2f59a48fd6ff2e747bcc3f208133e6cf/src/content/Docs/node-operators/architecture/application-layer/index.md#L642-L648)).

**What a contract could do if it were deployed** ([x/wasm/keeper/msg_filter.go @ v2.1.1](https://github.com/akash-network/node/blob/v2.1.1/x/wasm/keeper/msg_filter.go#L64-L180)):

- Bank `Send` is **allowed** unless the recipient is on the `BlockedAddresses` param. Bank `Burn` is denied.
- Staking, Distribution, Gov, IBC, IBC2 and Custom messages are **all denied** (L71-116).
- `Any` (protobuf) messages are denied **except exactly `/akash.oracle.v2.MsgAddPriceEntry`** (L169-180). A contract therefore **cannot send `MsgCreateDeployment`, `MsgAccountDeposit`, `MsgCreateLease` or anything else** in Akash's marketplace.
- Wasm-to-wasm calls are allowed (L123-126).
- Queries: the Akash custom querier's handlers are commented out and return `UnsupportedRequest` ([bindings/custom_querier.go L25-31](https://github.com/akash-network/node/blob/v2.1.1/x/wasm/bindings/custom_querier.go#L25-L31)). The stargate query whitelist is empty ([bindings/query_whitelist.go](https://github.com/akash-network/node/blob/v2.1.1/x/wasm/bindings/query_whitelist.go)). AEP-79's architecture survey says the same ([01-current-architecture.md L436-458](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/01-current-architecture.md#L436-L458)).
- **ACT cannot enter a contract.** The v2.0.0 upgrade calls `SetSendEnabled(uact, false)` ([upgrade.go L99 @ v2.0.1](https://github.com/akash-network/node/blob/v2.0.1/upgrades/software/v2.0.0/upgrade.go#L99)); live `/cosmos/bank/v1beta1/send_enabled?denoms=uact` returns `enabled:false`. wasmd's `BankCoinTransferrer.TransferCoins`, which moves funds attached to instantiate or execute calls, checks `IsSendEnabledCoins` first ([wasmd keeper.go L1505-1515](https://github.com/CosmWasm/wasmd/blob/v0.61.7/x/wasm/keeper/keeper.go#L1505-L1515)). A contract on Akash could hold AKT or IBC denoms, but not ACT.
- Side note: `wasmConfig.ContractDebugMode = true` is hard-coded next to a comment that says "MUST be false in production" ([app/app.go L157-163](https://github.com/akash-network/node/blob/v2.1.1/app/app.go#L157-L163)). AEP-79 lists it as a known defect.

**EVM:** there is no EVM module in the node's `go.mod` or app wiring (checked at v2.1.1 and main). AEP-78 considered an "EVM Compatibility Layer" and rejected it ([AEP-78 L180-182](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-78/README.md#L180-L182)).

### 1.3 Roadmap: Akash plans to leave Cosmos for Solana or an EVM L2 (AEP-79)

This matters more than anything else in this document for TOON.

- [AEP-79 "Akash on Shared Security"](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/README.md) started in December 2025 as an RFP for shared security. It is marked `status: Final`, `estimated-completion: 2026-12-31` (L5-L10). On 2026-08-12 ([commit cfbb79c](https://github.com/akash-network/AEP/commit/cfbb79c52e)) it gained a "Chain Migration Program" document set that **supersedes the RFP where they conflict**.
- That doc set ([doc/README.md L1-32](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/README.md#L1-L32)) is titled "Akash Network: Chain Migration Program (Cosmos SDK → Solana / Ethereum)", version 0.9, a draft for review dated 2026-08-10. Its status line reads "**Target selection open; decided at Gate 0**". The two paths are:
  - **Path A:** the marketplace rebuilt as Solana programs.
  - **Path B:** EVM contracts on an existing L2. "candidates include Base, Arbitrum One, and Robinhood Chain." An Arbitrum Orbit rollup is a non-default variant.
- The executive summary ([00-executive-summary.md](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/00-executive-summary.md)) says:
  - Akash maintains "an entire CosmWasm subsystem whose only production job is importing Pyth prices" (L50-52).
  - The plan is "Rebuild, don't port bytes", with a dual snapshot and no bridge, a 90-day wind-down, ACT kept non-transferable, and the BME engine turned into a contract or program (L97-121).
  - The estimate is 142–200 person-months (L145).
  - "Nothing here is a governance decision" ([doc/README.md L87-89](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/README.md#L87-L89)).
- On-chain status: the latest proposals (IDs 329-340, through 2026-09-05) contain **no migration signal proposal**. Source: `/cosmos/gov/v1/proposals?pagination.reverse=true`.
- **UNVERIFIED:** the Gate 0 decision, the timeline, and whether the community will approve it. None of these are recorded on a primary source yet.

**What this means for TOON:** building a TOON contract on `akashnet-2` targets a chain its core developers plan to retire. If Path B lands on Base, Akash's escrow and marketplace contracts would sit next to TOON's `TokenNetwork` on the same chain. If Path A lands, they would sit next to TOON's Solana program. Either way, on-chain composability becomes realistic later.

---

## 2. How Akash payments work today (post-BME)

### 2.1 Objects and flow

A tenant's `MsgCreateDeployment` creates groups and orders and opens an **escrow account** funded by the deposit. Providers bid with `MsgCreateBid`, which carries their own deposit/collateral. The tenant accepts with `MsgCreateLease`, which creates an escrow **payment** at the bid's rate. The provider withdraws with `MsgWithdrawLease`. See the handler ([x/deployment/handler/server.go L40-134](https://github.com/akash-network/node/blob/v2.1.1/x/deployment/handler/server.go#L40-L134)) and [x/market/handler/server.go L194-207](https://github.com/akash-network/node/blob/v2.1.1/x/market/handler/server.go#L194-L207). SDL never goes on chain. Only the manifest hash does, and the manifest itself goes tenant to provider directly ([AEP-79 01 §6.1](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/01-current-architecture.md#L913-L922)).

### 2.2 Denoms: ACT via BME; AKT as a fallback; USDC retired

- `CreateDeployment` rejects `uakt` deposits ("AKT deposits are only allowed via AccountDeposit") and requires group prices in `uact` ([server.go L59-62, L93-95](https://github.com/akash-network/node/blob/v2.1.1/x/deployment/handler/server.go#L59-L95)).
- Live params (2026-09-15):
  - deployment `min_deposits` = 500000 uact / 500000 uakt
  - market `bid_min_deposits` = the same
  - BME `mint_spread_bps: 25`, `settle_spread_bps: 0`, `min_mint: 10000000 uact`, circuit breaker warn 9500 / halt 9000
  - Sources: `/akash/deployment/v1beta4/params`, `/akash/market/v1beta5/params`, `/akash/bme/v1/params`
- **BME (`x/bme`)** only allows the swap routes `uakt→uact` and `uact→uakt` ([x/bme/keeper/keeper.go L786-792](https://github.com/akash-network/node/blob/v2.1.1/x/bme/keeper/keeper.go#L786-L792)). The rate comes from the oracle, and ACT is priced at $1 (comment L391-397). Requests are queued and executed in EndBlocker epochs. The collateral-ratio circuit breaker blocks new mints.
- **`MsgMintACT` requires `owner == to`**: "if minted coin is ACT, 'to' must be same as signer" ([chain-sdk proto msgs.proto L107-113](https://github.com/akash-network/chain-sdk/blob/ace99a2a5274ff46f0b18219dfc5084402c9a2f2/proto/node/akash/bme/v1/msgs.proto#L107-L113); enforced in [go/node/bme/v1/msgs.go L135-137](https://github.com/akash-network/chain-sdk/blob/ace99a2a5274ff46f0b18219dfc5084402c9a2f2/go/node/bme/v1/msgs.go#L135-L137)). Together with `SendEnabled(uact)=false`, **ACT cannot be minted to, or sent to, someone else**. AEP-76 calls it "non-transferable ... soulbound to the funding account" ([AEP-76 L50, L81](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-76/README.md#L50-L81)).
- **USDC:** gov proposal 318's text (the v2.0.0 upgrade) says existing `axlUSDC` (`ibc/170C6776…`) prices and escrow were converted 1:1 to ACT during the upgrade, and `uakt` objects were migrated at the oracle price (`/cosmos/gov/v1/proposals/318`, section "Migrate existing deployments to use ACT"). Given the `uact`-only price check above, **IBC USDC is no longer a payment denom**. Its earlier introduction is in [AEP-23 "Multi Currency Support with Stable Payments"](https://github.com/akash-network/AEP/tree/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-23), Final.
- Docs framing: "Escrow is funded in **ACT** (uact). Providers are paid in **ACT** per block from your escrow. When the circuit breaker is active ... you can top up escrow with **AKT**" ([deployments docs L196-197, L354-358](https://github.com/akash-network/website/blob/ead749cb2f59a48fd6ff2e747bcc3f208133e6cf/src/content/Docs/learn/core-concepts/deployments/index.md#L196-L358)). "you get ACT by burning AKT or via credit card in Console" ([what-is-akash L113](https://github.com/akash-network/website/blob/ead749cb2f59a48fd6ff2e747bcc3f208133e6cf/src/content/Docs/getting-started/what-is-akash/index.md#L113)).
- Gas fees are still paid in AKT, per the same docs page, L94.

### 2.3 How providers get paid: a per-block rate, settled lazily

- "Per block" describes the **rate**, not a per-block transfer. The escrow `EndBlocker` does nothing ([x/escrow/keeper/abci.go L7-10](https://github.com/akash-network/node/blob/v2.1.1/x/escrow/keeper/abci.go#L7-L10)). On each interaction, `accountSettle` computes `heightDelta = height − SettledAt` and moves `rate × heightDelta` from the account's funds to each payment's balance ([keeper.go L535-604](https://github.com/akash-network/node/blob/v2.1.1/x/escrow/keeper/keeper.go#L535-L604), [L1282-1333](https://github.com/akash-network/node/blob/v2.1.1/x/escrow/keeper/keeper.go#L1282-L1333)).
- `paymentWithdraw` bank-sends the truncated balance from the escrow module to the provider ([L1187-1209](https://github.com/akash-network/node/blob/v2.1.1/x/escrow/keeper/keeper.go#L1187-L1209)). AEP-79 notes there is no take-rate deduction on this path ([01 §4.1.5](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/01-current-architecture.md#L585-L596)).
- Settlement happens only on close, on a deposit into an overdrawn account, on payment create/withdraw/close, and through an uncalled keeper API ([AEP-79 01 §4.1.2 L528-541](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/01-current-architecture.md#L526-L541)).
- The provider daemon schedules `MsgWithdrawLease` on a `WithdrawalPeriod`, 24h by default ([provider config.go L41](https://github.com/akash-network/provider/blob/b7036c6de7e6b9fe852b7e32fb10d5a3efd04d4f/config.go#L41); [balance_checker.go L206-210](https://github.com/akash-network/provider/blob/b7036c6de7e6b9fe852b7e32fb10d5a3efd04d4f/balance_checker.go#L206-L210)).
- If ACT is overdrawn while BME is halted and the account holds AKT, `settleFromAktFallback` pays the provider in `uakt` at the oracle price ([keeper.go L609-687](https://github.com/akash-network/node/blob/v2.1.1/x/escrow/keeper/keeper.go#L609-L687)).

### 2.4 Can a third party pay on a user's behalf? Yes, in three ways

1. **Direct top-up from any account.** `MsgAccountDeposit.signer` "Does not necessarily needs to be an owner of the deployment" ([chain-sdk escrow/v1/msg.proto L17-47](https://github.com/akash-network/chain-sdk/blob/ace99a2a5274ff46f0b18219dfc5084402c9a2f2/proto/node/akash/escrow/v1/msg.proto#L17-L47)). The funds come from the signer's balance (`SourceBalance`, [keeper.go L208-225](https://github.com/akash-network/node/blob/v2.1.1/x/escrow/keeper/keeper.go#L208-L225)). The depositor is recorded per deposit. On close or overdraw, **leftover funds are refunded to that depositor, not to the deployment owner** ([saveAccount L1022-1104](https://github.com/akash-network/node/blob/v2.1.1/x/escrow/keeper/keeper.go#L1022-L1104)). This is multi-depositor escrow, [AEP-75](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-75/README.md) (Final).
2. **`DepositAuthorization` (authz).** A funder (granter) grants the deployment owner (grantee) `akash.escrow.v1.DepositAuthorization{spend_limits, scopes: deployment|bid}` ([authz.proto L16-60](https://github.com/akash-network/chain-sdk/blob/ace99a2a5274ff46f0b18219dfc5084402c9a2f2/proto/node/akash/escrow/v1/authz.proto#L16-L60)). When the owner uses `Sources: [grant]` in `MsgCreateDeployment` or `MsgAccountDeposit`, the keeper pulls from the **granter's** balance and decrements the grant ([keeper.go L226-322](https://github.com/akash-network/node/blob/v2.1.1/x/escrow/keeper/keeper.go#L226-L322)). Refunds go back to the granter **and the grant's spend limit is restored** ([L1050-1075](https://github.com/akash-network/node/blob/v2.1.1/x/escrow/keeper/keeper.go#L1050-L1075)). The deposit source enum is `balance=1, grant=2` ([deposit.proto L10-19](https://github.com/akash-network/chain-sdk/blob/ace99a2a5274ff46f0b18219dfc5084402c9a2f2/proto/node/akash/base/deposit/v1/deposit.proto#L10-L19)). The grant only moves funds into escrow through the module account, so it works for non-transferable ACT, which a bank send cannot.
3. **Fee grants and generic authz.** `authz` and `feegrant` modules are both wired ([app/config.go L35, L63](https://github.com/akash-network/node/blob/v2.1.1/app/config.go#L35-L63)). Akash's docs recommend "Combine AuthZ + Fee Grants for complete delegation" and list "Allow third-party services to deploy on your behalf" ([authz docs L24, L40](https://github.com/akash-network/website/blob/ead749cb2f59a48fd6ff2e747bcc3f208133e6cf/src/content/Docs/developers/deployment/authz/index.mdx#L24-L40)).

---

## 3. Integration options for "TOON users pay for Akash with TOON"

Context from TOON's own repo. The TOON connector is an Interledger connector. Payment channels are "anchored on a chain", and claims are "signed statement[s] of a payment channel's cumulative state" (`connector/CONTEXT.md` L311-325). An **App** behind a connector "settles nothing, holds no channel" but "IS told who paid, how much and on what chain — `X-TOON-Payer`/`X-TOON-Amount`/`X-TOON-Chain`" (`connector/CONTEXT.md` L24-30). Live settlement runs on Base Sepolia (`TokenNetworkRegistry` `0x0c41…CCa5`, mock USDC) and Solana devnet (program `2aEV…7Rip`, mock USDC mint) (`connector/README.md` L233-273).

### (a) A TOON payment-channel contract on Akash itself: feasible on paper, not recommended

- Uploading requires a governance proposal (§1.2): at least 1,000 AKT deposit and a 7-day vote, or 2,000 AKT and 1 day expedited, plus community approval. There is no precedent for third-party code.
- TOON's contracts are Solidity and a Solana program. CosmWasm needs a **Rust rewrite**, and TOON's EIP-712 / Ed25519 claim verification would have to be re-implemented against CosmWasm crypto APIs.
- The contract **could not hold ACT** (send-disabled, checked by wasmd's transferrer) and **could not call escrow or deployment messages** (Any filter). The best it could do is hold AKT or IBC USDC and pay a payee who then mints ACT and deposits off-chain. That brings back the broker from option (c), plus a governance dependency, a new audit surface, and TOON liquidity split onto a third chain.
- The host chain is slated for retirement under AEP-79 (§1.3).

### (b) A CosmWasm-enabled chain connected via IBC (Osmosis, Neutron, Archway): does not remove trust

- Akash's IBC surface is **`transfer` only**. On 2026-09-15 all 145 channels were on port `transfer` (121 open); for example `channel-9` goes to `osmosis-1` (`/ibc/core/channel/v1/channels`). App wiring registers only the `transfer` and `wasm` IBC routes, and **no interchain-accounts host, packet-forward, or IBC-hooks module** ([app/types/app.go L534-549](https://github.com/akash-network/node/blob/v2.1.1/app/types/app.go#L534-L549); module list [app/config.go L33-64](https://github.com/akash-network/node/blob/v2.1.1/app/config.go#L33-L64)).
- So a contract on Osmosis or Neutron can send AKT to an Akash address, but it **cannot create deployments or deposit into escrow on Akash**. There is no ICA host to execute messages remotely and no hooks to trigger actions when a transfer arrives. ACT cannot move over IBC, since it is send-disabled.
- An off-chain actor on Akash still has to mint ACT and fund escrow. You would add a third chain, a bridge hop from EVM/Solana into Cosmos, and TOON contract ports, and still carry the broker trust assumption from (c). Not recommended.
- Adding ICA host or IBC hooks to Akash would itself need a chain upgrade through governance, against a chain that plans to migrate. **UNVERIFIED:** no AEP proposing this was found in the AEP index (AEPs 1-94 listed).

### (c) Off-chain broker ("TOON to Akash gateway"): recommended

**Shape:** the broker is a TOON **App** behind a TOON connector. Users pay per request or per interval over their existing TOON channels (USDC on Base or Solana). The broker gets `X-TOON-Payer`/`X-TOON-Amount` for each paid call. On the Akash side it:

1. Holds AKT (gas plus mint collateral). It periodically sends `MsgMintACT` to itself, which is the only allowed direction (owner == to).
2. Funds deployments using one of three custody models:

| Model | Mechanism (primary source) | Who owns the deployment key | Refunds on close | Trust |
|---|---|---|---|---|
| **C1 Custodial** | Broker creates and owns deployments (`MsgCreateDeployment` with `Sources:[balance]`) | Broker | To the broker | User trusts the broker to keep the deployment alive and pass the manifest through. Simplest. Same as Console managed wallets. |
| **C2 Grant-funded, user-owned** | Broker grants `DepositAuthorization{spend_limits: uact, scopes:[deployment]}` plus a `feegrant` BasicAllowance to the user's Akash address. The user creates and deploys with `Sources:[grant]` (§2.4.2) | User (needs an Akash key but no AKT or ACT) | To the broker; the grant limit is restored automatically | Broker's exposure is capped by `spend_limits` and expiry. The user can drain the grant into escrow up to the limit, so size grants to what the user has pre-paid over TOON. |
| **C3 Top-up, user-owned** | User creates a deployment with a minimum deposit (own funds or a small grant). The broker sends `MsgAccountDeposit` from its own balance as TOON claims arrive (§2.4.1) | User | Broker's share goes back to the broker (FIFO per depositor) | Closest to pay-as-you-go. Broker's exposure is at most one top-up interval; user's exposure is at most the claim increment. |

**Trust assumptions and risks:**

- User to broker: the user pays in TOON claims before escrow is funded, so the user trusts the broker for at most one prepaid increment. TOON claims are cumulative and small per packet, which fits a streaming lease well.
- Broker to Akash economics: the broker carries AKT price risk and the 25 bps mint spread (`mint_spread_bps`). It also carries **BME circuit-breaker risk**: when the collateral ratio falls below the halt threshold, new ACT mints stop ([keeper.go L794-817](https://github.com/akash-network/node/blob/v2.1.1/x/bme/keeper/keeper.go#L794-L817)). The broker would then need an ACT buffer, or would have to top up with AKT, which the fallback path allows.
- Refunds land with the depositor or granter (the broker). The broker must credit users back off-chain, for example by lowering future charges or with a TOON payment back.
- Provider risk is unchanged. The provider is still paid by Akash escrow, and the broker does not change Akash's provider trust model.
- Regulatory: a broker that takes USDC and resells compute may count as a money transmitter or reseller in some jurisdictions. **UNVERIFIED / not researched.**

**Future-proofing:** put the Akash side behind a small interface (create deployment, deposit, query escrow, close), in the style of AEP-79's proposed `pkg/chain` adapter ([07-offchain-and-clients.md L91-146](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/07-offchain-and-clients.md#L91-L146)). If Akash moves to Base or Solana, the Akash implementation can be swapped for one that talks to the new escrow contract or program. The broker could also become an on-chain composition: AEP-79's Solana design replaces authz with funded, restore-on-refund **allowance PDAs** ([03-solana-architecture.md L484-491](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/03-solana-architecture.md#L484-L491)), a natural target for a TOON channel payee to fund.

### (d) Prior art: Akash Console managed wallets and credit cards

Console's managed platform is option C2/C1 in production, Apache-2.0:

- **Custodial derived wallets.** Per-user addresses are derived from a server-held mnemonic (`DERIVATION_WALLET_MNEMONIC_V2`), and a separate **funding** master wallet exists (`FUNDING_WALLET_MNEMONIC_V2`) ([tx-manager.service.ts L25-33, L77-92](https://github.com/akash-network/console/blob/111de5afe5bc5bcf68d083df5f2c6741af1c6a84/apps/api/src/billing/services/tx-manager/tx-manager.service.ts#L25-L92)).
- **Grants from the funding wallet to user wallets.** `authorizeSpending` issues a `DepositAuthorization` (uact `spendLimits`, `scopes:[deployment]`, 10-year default expiry) and a `feegrant` `BasicAllowance` in uakt ([managed-user-wallet.service.ts L79-101](https://github.com/akash-network/console/blob/111de5afe5bc5bcf68d083df5f2c6741af1c6a84/apps/api/src/billing/services/managed-user-wallet/managed-user-wallet.service.ts#L79-L101); message builders [rpc-message.service.ts L66-125](https://github.com/akash-network/console/blob/111de5afe5bc5bcf68d083df5f2c6741af1c6a84/apps/api/src/billing/services/rpc-message-service/rpc-message.service.ts#L66-L125)).
- **AKT to ACT treasury management.** A cron burns the master wallet's AKT above a reserve into ACT with `MsgMintACT` and polls until it settles ([master-wallet-mint.service.ts L33-80, L141-144](https://github.com/akash-network/console/blob/111de5afe5bc5bcf68d083df5f2c6741af1c6a84/apps/api/src/billing/services/master-wallet-mint/master-wallet-mint.service.ts#L33-L144)).
- Related AEPs:
  - [AEP-31 Credit Card Payments In Console](https://github.com/akash-network/AEP/tree/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-31) (Final)
  - [AEP-63 Console API for Managed Wallet Users](https://github.com/akash-network/AEP/tree/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-63) (Final; REST API for card-paying users)
  - [AEP-74 Auto Credit Reload](https://github.com/akash-network/AEP/tree/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-74) (Final)
  - [AEP-84 Console Split: Managed Platform and Self-Custodial Air](https://github.com/akash-network/AEP/tree/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-84) (Final)
  - [AEP-91 Escrow Abstraction and Auto-Funding](https://github.com/akash-network/AEP/tree/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-91) (Draft; "There are no chain or provider changes")
- A TOON broker is essentially Console's billing layer with "credit card" replaced by "TOON claim". The Console API (AEP-63) could even be a downstream: the broker calls Console's managed API. **UNVERIFIED:** whether Console's terms allow resale or whether its API offers programmatic billing for a reseller. Not checked.

### Recommendation

**Build (c) as a TOON App, starting with C1 (custodial) for speed and moving to C3 or C2 (user-owned deployments) for trust minimization.** Reuse Console's grant and mint patterns. Keep the Akash integration behind an adapter because of AEP-79. Do **not** pursue (a) or (b):

- (a) needs governance and a Rust rewrite, still cannot touch ACT or escrow, and targets a chain slated for retirement.
- (b) adds a chain and a bridge and still needs an off-chain actor, because Akash has no ICA host or hooks.

Revisit an on-chain design once AEP-79's Gate 0 picks Base or Solana.

| Option | Trustless? | Effort | Blockers |
|---|---|---|---|
| (a) CosmWasm on Akash | No (still needs off-chain ACT mint and deposit) | High (governance, Rust port, audit) | Gov upload; Any filter; ACT send-disabled; AEP-79 |
| (b) CosmWasm chain via IBC | No | High (third chain plus bridge) | No ICA host or IBC hooks on Akash |
| (c) Broker App | Bounded trust (one increment) | Low to medium | AKT/BME risk; refund accounting; regulatory (unverified) |
| (d) Console API downstream | Trust in broker and Console | Lowest | Console ToS / API suitability (unverified) |

---

## 4. How open source Akash is, and rebuilding "Akash on TOON"

### 4.1 Licenses (read from the actual LICENSE files)

| Repo | License (file) | Notes |
|---|---|---|
| `node` | Apache-2.0, "Copyright 2018 Overclock Labs, Inc." ([LICENSE @ v2.1.1](https://github.com/akash-network/node/blob/v2.1.1/LICENSE)) | Includes the in-repo CosmWasm contracts (`contracts/pyth`, `pyth_pro`, `pyth_vaa`, `wormhole`) |
| `provider` (provider-services daemon, bid engine, K8s operators) | Apache-2.0 ([LICENSE](https://github.com/akash-network/provider/blob/b7036c6de7e6b9fe852b7e32fb10d5a3efd04d4f/LICENSE)) | |
| `console` (deploy-web, api, indexer, provider-proxy, notifications, tx-signer, ...) | Apache-2.0, "Copyright 2023 Overclock Labs, Inc." ([LICENSE](https://github.com/akash-network/console/blob/111de5afe5bc5bcf68d083df5f2c6741af1c6a84/LICENSE)) | Per-package `package.json` files declare Apache-2.0. `apps/log-collector` declares ISC; `stats-web` and `provider-console` declare none (root LICENSE applies). |
| `chain-sdk` (`pkg.akt.dev/go`, TS `@akashnetwork/chain-sdk`, protos) | Apache-2.0 ([LICENSE](https://github.com/akash-network/chain-sdk/blob/ace99a2a5274ff46f0b18219dfc5084402c9a2f2/LICENSE)) | |
| `console-air`, `akt` (CLI), `AEP`, `helm-charts`, `provider-playbooks`, `hermes`, `contracts` | Apache-2.0 (GitHub license API, `gh repo list akash-network`) | Only `console-air` and `akt` LICENSE bodies were read directly |
| Forks `cosmos-sdk`, `cometbft` | Apache-2.0 (upstream licenses) | `gogoproto` fork: "other" (BSD-style upstream) |
| `website` (hosts the docs) | MIT ("Copyright (c) 2021 Fred K. Schott", Astro template) ([LICENSE](https://github.com/akash-network/website/blob/ead749cb2f59a48fd6ff2e747bcc3f208133e6cf/LICENSE)) | Docs content license is not stated separately (**UNVERIFIED**) |
| No license file | `k8s-trustee`, `github-runner`, `chain-supply`, `provider-chaperone`, `deploy-templates`, `Marketing` | Peripheral, not needed to rebuild the protocol |

- I found **no source-available or closed core component**. The history is public: Akash "open-sourced fully in late 2023" ([AEP-31 text](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-31/README.md)), Cloudmos and Praetor were open-sourced through mergers ([AEP-21](https://github.com/akash-network/AEP/tree/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-21), [AEP-27](https://github.com/akash-network/AEP/tree/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-27)), and there is an "Open Development Model" ([AEP-19](https://github.com/akash-network/AEP/tree/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-19)).
- **UNVERIFIED:** what Overclock runs privately (hosted Console infrastructure, the credit-card billing backend's Stripe config, relayers, and the `internal/` AEP-79 material, which the doc set says is excluded from the public package, [doc/README.md L94-96](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/README.md#L94-L96)).

### 4.2 What is chain-coupled

- **`node`** is entirely chain: modules `deployment`, `market`, `escrow`, `bme`, `oracle`, `provider`, `audit`, `cert`, `epochs`, `wasm` ([x/ @ v2.1.1](https://github.com/akash-network/node/tree/v2.1.1/x)). Forking it means running your own Cosmos L1 and validator set, the "sovereign costs" AEP-79 wants to shed ([00 L45-61](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/00-executive-summary.md#L45-L61)).
- **`pkg.akt.dev/go` (chain-sdk)** is the shared contract for all proto/state types, denoms, and the CLI tree. "Replacing the chain starts with replacing/forking this module" ([AEP-79 01 §6 L896-911](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/01-current-architecture.md#L896-L911)).
- **`provider`** imports `pkg.akt.dev/go v0.4.5`, `pkg.akt.dev/node/v2 v2.1.0`, and the forked cosmos-sdk and cometbft ([provider go.mod L12-13, L55-59, L79-81](https://github.com/akash-network/provider/blob/b7036c6de7e6b9fe852b7e32fb10d5a3efd04d4f/go.mod#L12-L81)). Coupling points:
  - The bid engine reacts to chain events: `EventOrderCreated` ([bidengine/service.go L295](https://github.com/akash-network/provider/blob/b7036c6de7e6b9fe852b7e32fb10d5a3efd04d4f/bidengine/service.go#L295)) and `EventLeaseCreated` ([bidengine/order.go L267](https://github.com/akash-network/provider/blob/b7036c6de7e6b9fe852b7e32fb10d5a3efd04d4f/bidengine/order.go#L267)).
  - It broadcasts `MsgCreateBid` (with a deposit) from `order.go` (L434-440).
  - It withdraws with `MsgWithdrawLease` (`balance_checker.go`) and runs manifest-hash checks against the on-chain deployment.
  - By my own grep: all 6 non-test files in `bidengine/` and 5 of 7 in `manifest/` import chain types or the client. Only 16 of 46 in `cluster/kube` and 7 of 31 in `operator/` do, mostly for ID types like `LeaseID`. **The Kubernetes orchestration is largely chain-agnostic.**
  - AEP-79's own adaptation plan agrees: "the daemon's Kubernetes orchestration, bid pricing, and manifest logic remain untouched; all chain awareness moves behind one Go interface" ([07 L73-74](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/07-offchain-and-clients.md#L70-L74)), and it spells out the `Client`/`QueryClient`/`TxClient` interface (L91-146).
- **`console`** is coupled through the chain-sdk TS client, Cosmos wallets (Keplr/Leap), authz and feegrant, and an indexer that scrapes CometBFT blocks ([AEP-79 07 §1 table](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/07-offchain-and-clients.md#L37-L60)).
- **Chain-independent:** SDL and manifest (only the SHA-256 manifest hash goes on chain, ADR-002, [01 §6.1](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/01-current-architecture.md#L913-L922)), provider Kubernetes operators (hostname, inventory, IP), and helm charts and playbooks.

### 4.3 Swapping the settlement layer for TOON payment channels

**What maps well:**

- Akash escrow is a **one-tenant, many-providers stream at a fixed rate with lazy settlement**. A TOON channel from tenant to provider (or to the provider's connector) with periodic cumulative claims gives the same economics. It also improves on Akash in one way: providers stop serving when claims stop, instead of detecting overdraw lazily, which AEP-79 flags as a weakness ([01 L541](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/01-current-architecture.md#L539-L541)).
- In the provider daemon, `balance_checker.go`'s withdraw loop becomes "verify the latest claim / settle the channel occasionally".
- TOON's connector already terminates payments in front of HTTP apps, and the provider gateway is HTTP.

**What channels do not give you (you still need a shared venue):**

1. **Order book and matching.** Orders, bids and leases need a neutral, ordered, public record so providers can discover demand and a tenant's lease acceptance binds. Options: an EVM contract or Solana program (what AEP-79 builds), or an off-chain order relay. The off-chain relay is less neutral; compare the draft [AEP-45 Offchain Compute Inventory](https://github.com/akash-network/AEP/tree/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-45).
2. **Provider identity and attestations** (`x/provider`, `x/audit`) and **gateway auth** (`x/cert`, being replaced by JWT against on-chain keys in AEP-79).
3. **Deposits and bonds.** Bid deposits deter spam bids.
4. **Manifest hash anchoring**, so the tenant cannot deny what was ordered.

**Effort signal:** AEP-79 estimates **142–200 person-months** for Akash's full migration ([00 L145](https://github.com/akash-network/AEP/blob/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79/doc/00-executive-summary.md#L145)). That covers re-implementing the marketplace plus token migration, state migration, the claims portal, audits, and exchange coordination. A greenfield "TOON compute market" with no token or state migration, TOON channels instead of escrow and BME, and a forked provider daemon behind a `pkg/chain`-style adapter would be much smaller. **UNVERIFIED:** I have no primary source for a smaller number.

Pragmatic path: do not fork the chain. Fork or extend **provider-services** only, if and when you need providers to accept TOON directly. Until then, the broker in §3(c) gets TOON users onto Akash's existing supply.

### 4.4 Trademark and network-effect considerations

- **Trademark:** Apache-2.0 §6: "This License does not grant permission to use the trade names, trademarks, service marks, or product names of the Licensor" ([node LICENSE L138-141](https://github.com/akash-network/node/blob/v2.1.1/LICENSE#L138-L141)). Akash's brand page says its "trademarks, logos, and brand elements should be used without any changes, and their sole purpose is to represent Akash Network" ([akash.network/brand/resources](https://akash.network/brand/resources/)). A fork must be renamed. Saying you are "powered by / compatible with Akash" for the broker falls under descriptive use; get legal review. **UNVERIFIED:** specific USPTO registrations for "Akash" (only a third-party aggregator listing was found, not USPTO itself).
- **Network effects:** Akash's value is its registered, audited provider supply, plus the tenants, liquidity, Console and indexers. A fork starts with none of it. The broker model rents that supply without forking. If AEP-79 lands on Base or Solana, Akash's own new contracts would share a chain with TOON's channels, which argues for integrating rather than forking.

---

## Unverified / open items (collected)

- Gate 0 outcome (Solana vs EVM L2 and which L2), timeline, and governance approval of AEP-79. Not decided on any primary source as of 2026-09-15.
- Whether Akash governance would approve third-party CosmWasm code; no precedent.
- Whether `v2.1.1` changed consensus (live node reports app `2.1.0`).
- Console terms of service and whether the managed API suits a reseller or broker.
- Regulatory status of a USDC-in, compute-out broker.
- Trademark registrations (USPTO) for "Akash".
- Private or ops-only Overclock infrastructure not in public repos.
- Effort estimate for a greenfield TOON compute market (no primary source).

## Sources

**Akash node (`akash-network/node`)**
- go.mod @ v2.1.1: https://github.com/akash-network/node/blob/v2.1.1/go.mod
- app/config.go, app/app_configure.go, app/app.go, app/types/app.go @ v2.1.1: https://github.com/akash-network/node/tree/v2.1.1/app
- x/wasm msg filter and bindings @ v2.1.1: https://github.com/akash-network/node/tree/v2.1.1/x/wasm
- x/escrow keeper @ v2.1.1: https://github.com/akash-network/node/blob/v2.1.1/x/escrow/keeper/keeper.go
- x/deployment handler: https://github.com/akash-network/node/blob/v2.1.1/x/deployment/handler/server.go
- x/market handler: https://github.com/akash-network/node/blob/v2.1.1/x/market/handler/server.go
- x/bme keeper: https://github.com/akash-network/node/blob/v2.1.1/x/bme/keeper/keeper.go
- v2.0.0 upgrade handler @ v2.0.1: https://github.com/akash-network/node/blob/v2.0.1/upgrades/software/v2.0.0/upgrade.go
- v2.1.0 upgrade handler: https://github.com/akash-network/node/blob/v2.1.1/upgrades/software/v2.1.0/upgrade.go
- Releases: https://github.com/akash-network/node/releases
- LICENSE: https://github.com/akash-network/node/blob/v2.1.1/LICENSE

**chain-sdk (`pkg.akt.dev/go`)** @ ace99a2a
- bme msgs.proto / msgs.go; escrow authz.proto, msg.proto; base deposit.proto: https://github.com/akash-network/chain-sdk/tree/ace99a2a5274ff46f0b18219dfc5084402c9a2f2/proto/node/akash

**provider** @ b7036c6d: https://github.com/akash-network/provider/tree/b7036c6de7e6b9fe852b7e32fb10d5a3efd04d4f (go.mod, config.go, balance_checker.go, bidengine/)

**console** @ 111de5af: https://github.com/akash-network/console/tree/111de5afe5bc5bcf68d083df5f2c6741af1c6a84/apps/api/src/billing/services

**AEPs** @ 76fe9ba9: https://github.com/akash-network/AEP/tree/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec
- AEP-19, 21, 23, 27, 31, 45, 63, 74, 75, 76, 78, 84, 91
- AEP-79 plus the doc set (00, 01, 03, 07): https://github.com/akash-network/AEP/tree/76fe9ba9f6064eaf155dcf8a237fb2bbd2c45c6d/spec/aep-79

**Akash docs** (website repo @ ead749cb; rendered at https://akash.network/docs/)
- learn/core-concepts/deployments, getting-started/what-is-akash, developers/deployment/authz, node-operators/architecture/application-layer
- Brand page: https://akash.network/brand/resources/

**Live mainnet (`akashnet-2`), public LCD `https://api.akashnet.net`, queried 2026-09-15**
- `/cosmos/base/tendermint/v1beta1/node_info`, `/cosmos/base/tendermint/v1beta1/blocks/latest`
- `/cosmwasm/wasm/v1/codes/params`, `/cosmwasm/wasm/v1/code`
- `/cosmos/auth/v1beta1/module_accounts/gov`
- `/cosmos/bank/v1beta1/send_enabled?denoms=uact`
- `/akash/deployment/v1beta4/params`, `/akash/market/v1beta5/params`, `/akash/bme/v1/params`, `/akash/oracle/v2/params`
- `/cosmos/gov/v1/proposals` (318, 329-340), `/cosmos/gov/v1/params/voting`
- `/cosmos/upgrade/v1beta1/applied_plan/v2.0.0`, `/cosmos/upgrade/v1beta1/applied_plan/v2.1.0`
- `/ibc/core/channel/v1/channels`
- Explorer: https://www.mintscan.io/akash/proposals/318

**CosmWasm wasmd** @ v0.61.7
- keeper/authz_policy.go: https://github.com/CosmWasm/wasmd/blob/v0.61.7/x/wasm/keeper/authz_policy.go
- keeper/keeper.go (BankCoinTransferrer): https://github.com/CosmWasm/wasmd/blob/v0.61.7/x/wasm/keeper/keeper.go

**TOON (local)**
- `/home/allidoizcode/Work/TOON-Protocol/connector/CONTEXT.md`, `README.md` (commit 586598c4)

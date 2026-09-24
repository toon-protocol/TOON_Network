# A provider's operator surface is a status command on the box

**Status:** Accepted, 2026-09-24. Settled in a design review after the first outside operator asked to run a provider ([#154](https://github.com/toon-protocol/TOON_Network/issues/154)). Nothing in it is built yet; the spec issue that follows breaks it into tickets. The glossary terms are **Provider**, **Provider Directory**, **Liveness**, **Lease** and **Lease Interval**.

A provider operator has four jobs: keep the box **funded**, keep it **listed**, see and collect what it **earned**, and see the **leases** it is running. Today each of those is a different tool or none. The connector's operator dashboard (connector ADR 0066) shows claims and channels. The provider app answers one operator route, `POST /operator/evict`, on a loopback-only port. The directory publisher answers `/health` and `/publish`. Keys come from `openssl rand`. An operator whose publisher channel runs dry drops out of the directory, and nothing tells them.

**The provider gains one read-only status surface, on the box, and one command that reads it.** The running provider answers `GET /operator/status` on the loopback operator port it already has. `toon-provider status` prints it, as JSON with `--json` and as an exit code with `--check`. A full-screen `toon-provider dash` is a view over the same document. Money stays where it is, and nothing spends it on its own.

## What status says

In this order, because the first question an operator has is "am I listed?":

1. **Identity.** The npub, the ILP address, public or hidden, and whether the Profile's `connector_seal_key` matches the connector's live `GET /ilp/identity`.
2. **Directory.** For each relay in the Relay Set, when the Profile, each Listing and the latest Liveness were last accepted, or the refusal if they were not, and when the current Liveness expires. The provider keeps each publication's per-relay report in memory for this. Today it only logs it.
3. **Publisher.** The channel, what was deposited, what is spent, what is left, and the runway at the current Liveness cadence. The publisher gains a `GET /status` that joins the client's two channel files to say so.
4. **Leases.** For each listing, capacity in use out of capacity. For each lease: its id, role, state, expiry, ports and `.anyone` address. Also what it has been **billed**: the listing price times the Lease Intervals it has paid for, a count the lease record starts keeping.
5. **Earnings.** The connector's inbound claims per channel, what is unredeemed and when it was last redeemed, read with the bearer token from the box.
6. **Funding.** The connector's settlement key's SOL balance, the same free read `keys.sh` makes before first boot ([#162](https://github.com/toon-protocol/TOON_Network/issues/162)).

The document is sectioned, so a Workload Gateway can later answer the sections it has (identity, earnings, funding, its certificate) with the same shape.

## Where it runs, and who may read it

**On the box first.** An operator already has a shell there, and every fact is on it. The operator port refuses any bind that is not loopback, and reaching it is what makes a caller the operator. That rule already authorises an eviction, and it now authorises a read. Nothing new is exposed.

**From a laptop, through the operator's own SSH.** `toon-provider dash --ssh root@box` opens the tunnel itself. The status route is not exposed through the connector behind a token: that would be the first exception to "loopback only", and it would buy nothing SSH does not already give.

## Money: shown everywhere, moved only by a person

- **Redeeming** is `toon-provider redeem`. It lists each channel with its unredeemed amount and an estimated gas cost, then redeems the ones the operator picks, or everything over `--all-above <amount>`. It signs the connector's existing `POST /channels/:id/redeem-latest` exactly as `connector send` signs a write. The operator key is read from stdin, held in memory and never written anywhere, on the box or on a laptop. That is connector ADR 0066's rule for the dashboard, applied to a terminal.
- **Topping up the publisher** is `toon-provider topup <amount>`. The publisher calls the client's existing `channel.deposit`. `status` warns when the runway is short.
- **Nothing is automatic.** No redeem on a schedule and no top-up below a threshold. Either would be an unattended process spending the operator's money, and that is its own decision.

## Alerts are an exit code

`toon-provider status --check` exits non-zero when something needs a person: Liveness close to expiry, the runway short, a relay refusing writes, a sealing-key mismatch, or the settlement key low on SOL. `bootstrap.sh` installs a systemd timer that runs it and logs to the journal. Push notifications (email, ntfy, a Nostr DM) are left for later, and would build on `--check` rather than beside it.

## Considered Options

- **Extend the connector's dashboard with provider panels.** Rejected. The connector is app-agnostic by design, and the dashboard is a same-origin page that cannot reach the provider's loopback port anyway (ADR 0066).
- **One operator app that also operates channels.** Rejected for v1. The connector dashboard deliberately *shows* channel lifecycle and leaves the writes as runbook steps. Rebuilding key custody for money in a second place is the riskiest part of any dashboard. Redeem and top-up get guided commands instead, because those are the two writes an earning operator needs.
- **A provider view in the Console.** Deferred. The Console is Linux-only and Omarchy-first, while an operator's box is a server they SSH into. A Console view that reads the same status document can come later, for a provider who is also a Console user.
- **The CLI reads the lease file directly.** Rejected. Only the running process knows the per-relay publish results and Liveness freshness.
- **A shared TUI crate with the Console.** Rejected for now. The two tools have different users and live in different repositories, and a shared crate couples their releases for a few hundred lines of layout. The provider's TUI uses the Console's visual rules (ANSI colours only, ADR 0028) and none of its code. If the gateway needs the same TUI, extract it then.
- **Listings and prices edited from the UI.** Left out. A price change is a new listing version whose routes are regenerated and reviewed through the deploy bundle's render. A UI would go around that review.

## Consequences

- The lease record gains a count of paid Lease Intervals, so billed per lease is a stored fact, not an inference from `expires_at`.
- The provider keeps the latest `PublishReport` per relay per event in memory. It is not persisted, and a restart republishes anyway.
- The publisher's `/status` and `topup` make it a service a person talks to. It still holds no identity and signs no directory event.
- `status` is the one place an operator is told the connector's dashboard exists and what it is for.
- Build order: #162 first, then status, the publisher's `/status` and top-up, `--check` and its timer, redeem, the TUI, and `--ssh`.

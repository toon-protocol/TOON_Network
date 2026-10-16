# The console is retired

**Status:** Accepted, 2026-10-16. Supersedes ADR 0019, ADR 0020, ADR 0021 and ADR 0028.

TOON Compute no longer builds a console. The project is not going in the direction of a local tenant app. `toon-protocol/console` is archived read-only, with its history kept. Its one open ticket, #132 (adding collateral to a channel from the Funds tab), is closed as not planned.

The console was never brought onto the x402-only connector: it was still on `@toon-protocol/client` 3.1.0 when it stopped. Retiring it means it will not be migrated either.

## Consequences

- **Tenants have no app of their own.** The protocol does not depend on one. A tenant is whoever holds a lease's Continuation Token (spec §6.1.1), and `@toon-protocol/client` pays the routes. Tenant tooling lives in the projects that need it; rig is the first.
- **ADR 0019, 0020, 0021 and 0028 describe the console and are superseded.** They remain as a record of what was decided. Nothing in the spec rests on them: the Chain Seed (0020) and the Lease Vault (0021) were console conventions, never wire requirements. A tool that wants the same properties can adopt them again in its own ADR.
- **The glossary's Console section is kept but marked retired**, so the terms read the same in the old ADRs and issues that use them.
- **Other ADRs that mention the console are unchanged.** ADR 0024, 0025, 0027 and 0029 use it as an example or as one of several callers, and each decision stands without it. ADR 0029's "a provider view in the Console" option is now moot rather than deferred.

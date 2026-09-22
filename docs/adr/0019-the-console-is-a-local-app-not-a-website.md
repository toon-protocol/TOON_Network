# The console is a local app, not a website

**Status:** Proposed, 2026-09-22. Decided in the console design session; the glossary terms are **Console**, **Account** and **Signer**.

The TOON Network console is a **local daemon with a web UI**, not a hosted website. A `systemd --user` Node daemon runs `@toon-protocol/client`, holds the account's keys, and serves the UI on `127.0.0.1`. The UI opens as an Omarchy web app (`omarchy-webapp-install`, `omarchy-launch-or-focus-webapp`). The app is Omarchy-first: it takes its colours from the current Omarchy theme and re-themes on the `theme-set` hook, adds entries to the Omarchy menu, sends lease alerts with `omarchy-notification-send`, and ships as an AUR package. Only the landing page and the docs are public.

A hosted console would have had to run the client library in a browser, and three things stand in the way. The library builds for Node and its package root pulls in `node:fs`. Connectors send no CORS headers. And a browser cannot reach a Hidden Provider's `.anyone` address at all. A local daemon avoids all three without changing the protocol. It also keeps the keys on the machine the account controls, which a cloud console never could.

## Considered Options

- **A static single-page app plus a same-origin connector proxy.** Rejected. It needs a browser-clean client and a proxy we operate, and it still cannot reach Hidden Providers. The proxy would also sit on every sealed packet an account sends.
- **A custodial or backend-indexed console.** Rejected. It would hold root secrets or see every account's leases, and the protocol was built so that no one party does.
- **A TUI.** Deferred, not rejected. A TUI is as Omarchy-native as a web app, but funding flows, deposit QR codes and Template forms need a richer surface. A TUI can later drive the same daemon.

## Consequences

- The console runs where Node and a `systemd --user` session run. Omarchy is the first-class target, and other Linux desktops get a plain `.desktop` file.
- Nothing about an account lives on a server we operate. What must follow the account between machines lives on its own relays (ADRs 0020 and 0021).

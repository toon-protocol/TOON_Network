# The console's primary window is a terminal

**Status:** Proposed, 2026-09-24. Amends ADR 0019, which deferred a TUI rather than rejecting it. The glossary terms are **Console**, **Account** and **Signer**.

The console's main window becomes a **terminal UI**. It is a Rust binary, `toon-console-tui`, built with `ratatui`, and it drives the same `systemd --user` daemon over the same local `/api/*` routes that the web UI uses. The Omarchy launcher, the menu entries and the default `toon-console` command open it with `omarchy-launch-or-focus-tui`. The web UI stays and is opened with `toon-console --web`. The daemon is unchanged: it still holds the keys, pays for every relay write, and serves the web UI on `127.0.0.1`.

## Why

- **It is how Omarchy ships its own apps.** Activity (`btop`), Docker (`lazydocker`), git (`lazygit`) and music (`cliamp`) are terminal apps. Omarchy's bindings launch them with `omarchy-launch-tui` or `omarchy-launch-or-focus-tui`, and `omarchy-tui-install` is its extension point for adding another. Such an app opens in the person's own terminal, through `xdg-terminal-exec`, in their own font. A console opened as a Chromium web app is the odd one out: a browser window that does not respond to the keyboard the way the rest of the desktop does.
- **It follows the theme for free.** An Omarchy theme recolours the terminal. A TUI that draws only in the terminal's own palette (the 16 ANSI colours plus default foreground and background) takes on the theme live, with no template, no `theme-set.d` hook and no round trip to the daemon.
- **The reasons ADR 0019 deferred it have answers.** A deposit QR code draws in a terminal with half-block characters and scans from a phone. Template and spawn forms are text fields and pick-lists. The docs are Markdown. The flows that genuinely want a browser can open one.
- **It keeps ADR 0019's security shape.** The TUI holds no key and no long-lived credential. It reads the daemon's URL and per-launch token from `$XDG_RUNTIME_DIR/toon-console/launch.json`, which only this user can read. The menu entries and the theme hook already authenticate this way.

## Why Rust and not the web UI's TypeScript

The TypeScript web UI has a typed daemon client (`packages/ui/src/lib/daemon.ts`) that an Ink TUI could reuse. We chose Rust anyway:
- the fleet's other long-running programs (connector, provider, gateway) are already Rust;
- it starts instantly and ships as one binary in the existing AUR package;
- it does not tie the TUI's runtime to the daemon's.

The cost is a second copy of the API's types. The daemon's tests write each route's real response as a JSON fixture, and the TUI's tests parse those fixtures. That catches drift between the two copies as a failing test, not a blank screen.

## Considered Options

- **Keep the web app as the only window, and polish it.** Rejected as the default. It keeps a browser as the one surface on a desktop whose other apps are keyboard-driven terminals.
- **Replace the web UI outright.** Rejected for now. The web UI is working, tested code, and it is the fallback on a desktop without a terminal launcher. It can be retired once the TUI covers every flow and nobody opens it.
- **TypeScript and Ink, in the console monorepo.** Rejected for the reasons above. It remains the cheaper option if keeping two copies of the API's types proves costly.
- **Go and Bubble Tea.** Rejected. It has good form widgets, but it would add a third language to a fleet that already writes Rust (connector, provider, gateway) and TypeScript.

## Consequences

- `toon-console` with no arguments opens the TUI. `--view <view>` still posts the view to the daemon, so an open TUI switches to it over the same `GET /api/desktop` long poll the web window uses. `--web` opens the web app.
- The crate lives in the console repository, at `tui/`, and the one AUR package builds and installs both. `rust` and `cargo` join `makedepends`.
- The TUI draws with no colour of its own: every style is an ANSI colour or a modifier. That is the TUI's version of the web UI's rule of "no fixed brand palette".
- Destructive and spending actions ask for confirmation in the TUI. These are terminate, rotate, gateway withdraw, opening a channel and buying gas. A single keypress must never spend money or end a lease.
- The web UI's `theme-set.d` hook and themed CSS stay, for the web window only.

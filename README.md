# FuelRats Dispatch Board

A browser-based dispatch tool for Fuel Rats dispatchers, connecting to the FuelRats API and IRC bridge to manage active rescues in real time.

## Requirements

- A FuelRats account - Must be a Drilled Rat
- [AdiIRC](https://www.adiirc.com/) (or HexChat — see [IRC client setup](#irc-client-setup))
- Python 3 (for the local web server)
- `bridge.exe` (pre-built, included in the release)

### Building from source

Create a `.env` in the project root before `npm run build`:

```
VITE_CLIENT_ID=<FuelRats OAuth client id>
```

`.env` is gitignored, and a build made without it compiles `client_id` to
`undefined` — the app loads and an existing session keeps working, so the only
symptom is that signing in dead-ends at the FuelRats authorize page. Worth
checking on any build you intend to hand to someone else.

---

## Setup

### 1. Set up the IRC bridge

#### AdiIRC

1. Open AdiIRC → **Tools** → **Scripts**
2. Load `scripts/IRC/adiirc/adiirc_tcp_server.mrc`
3. In any AdiIRC window, type `/bridge.start` to start the TCP server
4. Verify with `/bridge.status` — it should report listening on port `12346`

#### HexChat *(work in progress)*

A Python script is provided at `scripts/IRC/hexchat/hexchat_tcp_server_WIP.py` but is not yet fully supported.

### 2. Start the bridge exe

Run `bridge.exe`. A console window will open and stay running in the background — keep it open while dispatching.

To confirm the version: `bridge.exe --version`

Optionally, you can register the `fr-dispatch://` protocol handler so the dispatch board can launch the bridge automatically on page load. This adds an entry to the Windows registry. If you'd rather just run the exe yourself each time, skip this step.

```
bridge.exe --register
```

To remove the registration later:
```
bridge.exe --unregister
```

### 3. Launch the dispatch board

Double-click **`Launch Dispatch Board.bat`**.

This starts a local web server and opens the board in your browser.

### 4. Log in

Click **Login** and you'll be redirected to [fuelrats.com](https://fuelrats.com). Log in and approve the authorisation request — you'll be sent back to the dispatch board automatically.

---

## Features

**Case Management**
- Live case board pulling from the FuelRats API with auto-refresh
- Cases auto-close when the API marks them resolved — no manual dismissal needed
- Per-case windows with platform, system, language, and landmark distance badges
- Scoopable star status fetched from EDSM

**Rat Tracking**
- Rat progress bar (FR / WR / BC / FUEL) with cascade logic
- IRC nick learning via MechaSqueak relay messages
- Nearest station badge per case
- Pinned jump calls panel in each case window

**Quick Messages**
- Fully customizable button groups — add, remove, and reorder top-level groups
- Platform variants, weighted random variants, and keepOpen popovers
- Message Editor with JSON export/import and bullet point toggle

**Translation**
- Incoming messages in other languages are automatically translated in-line using MechaSqueak[BOT] auto translation - See <a href=https://confluence.fuelrats.com/spaces/FRKB/pages/439648258/Machine+Translation+with+MechaSqueak#MachineTranslationwithMechaSqueak-ReceivingLiveTranslationsofClientMessages>Receiving Live Translations</a> for more info
- WIP - Incoming message can also be translated using DeepL - DeepL account required

**IRC Bridge**
- WebSocket IRC bridge with auto-connect and persistent URL
- Nick change detection and deduplication
- AdiIRC and HexChat script support (see `scripts/IRC/`)
- Optional `fr-dispatch://` protocol handler for one-click bridge launch

---

## Changelog

### v1.1.4
- Case quotes (`!inject`/`!grab`) now shown raw alongside chat instead of flattened into the log, in both modes
- Rat mode brought to parity with dispatch: rats on case with FR/WR/BC/FUEL state, jump calls, supercruise ETA, client nick/language, and disconnected badge
- Fixed nearest scoopable star never appearing in rat mode
- Inactive cases now sorted below active ones and shown with an INACTIVE badge, instead of miscategorized as code-red
- Code red warning now shows on hidden cases in the case selector
- Rescues reconcile periodically while the WebSocket is connected, catching dropped events without a page reload
- Fixed cases flashing when nothing had actually arrived
- Jump count now clears when an unassigned caller stands down

### v1.1.3
- Spansh jump estimates in Rat Mode, with per-account short/long-range EDSY builds
- Click-to-copy system names in both modes
- Rat mode auto-translates incoming debrief messages
- Rat mode now shows translations on case messages
- `bridge:build` now uses whatever Python is on PATH instead of a hardcoded interpreter path

### v1.1.2
- Langbly translation settings page and service, alongside DeepL
- `#debrief` IRC channel messages now surface in Rat Mode
- Added Rat Mode with TAB-completion and per-account rat tracking
- Perl HexChat bridge script (replaces the old Python HexChat bridge)
- Fixed nick-change detection on client reconnect and channel-membership checks
- Fixed `!gofr -a`/`!go -a` re-announce flag being misread as a rat nick
- Fixed stale `scDistanceLs` reference in CaseWindow
- Added SC (supercruise) timer, scoopable improvements, disconnect icon, and configurable bridge port

### v1.1.1
- Station badge now shows a hover popup with S/M and Large pad stations — click either to copy to clipboard
- Station popup repositions automatically if it would clip the screen edge
- Removed verbose debug logging from API service, IRC bridge, and components
- Added site favicon

### v1.1.0
- DeepL auto-translation for incoming messages
- `bridge.exe --version` flag
- Fixed spurious WebSocket errors in bridge console on startup
- Launch script no longer auto-starts the bridge

### v1.0.0
- Initial release

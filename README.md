# FuelRats Dispatch Board

A browser-based dispatch tool for Fuel Rats dispatchers, connecting to the FuelRats API and IRC bridge to manage active rescues in real time.

## Requirements

- A FuelRats account in the **Drilled Rat** group.
- [AdiIRC](https://www.adiirc.com/) (or HexChat — see [IRC client setup](#irc-client-setup))

That is the whole list. From v2.0 the board and the bridge are a single
`FRBoard.exe`, which carries its own web server, so Python is no longer needed
to run it — only to build it.

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

### The short way

Download **`FRBoard-Setup.exe`** from the [latest release](https://github.com/techno314/FuelRats_Dispatch_Message_Board/releases/latest) and run it.

It installs to `%LOCALAPPDATA%\Programs\FRBoard`, adds a Start Menu entry (so
Windows Search finds it), places the bridge script into AdiIRC or HexChat for
you, and registers in **Settings → Apps** so it uninstalls normally. No admin
rights, because everything is per-user.

Run it again any time to update — it replaces the board, the executable and the
IRC script together, which is the combination people otherwise forget. AdiIRC
notices the script changed and offers to reload it.

The only thing it will not do while AdiIRC is open is register a script AdiIRC
has never loaded before, since that needs a line adding to `config.ini` and
AdiIRC rewrites that file when it closes. Updating an already-registered script
is fine with it running.

```
FRBoard-Setup.exe              install or update, interactively
FRBoard-Setup.exe --check      report versions, change nothing
FRBoard-Setup.exe --update     files only, no registration
FRBoard-Setup.exe --uninstall  remove it
```

### The manual way

Everything below still works, and is what to read if you would rather place the
files yourself or are running from a source checkout.

### 1. Set up the IRC bridge

#### AdiIRC

1. Open AdiIRC → **Tools** → **Scripts**
2. Load `scripts/IRC/adiirc/adiirc_tcp_server.mrc`
3. In any AdiIRC window, type `/bridge.start` to start the TCP server
4. Verify with `/bridge.status` — it should report listening on port `12346`

#### HexChat *(work in progress)*

A Perl script is provided at `scripts/IRC/hexchat/hexchat_tcp_server.pl` but is not yet fully supported. Drop it in `%APPDATA%\HexChat\addons\` — HexChat loads addons on startup, so there is nothing to register. It needs HexChat's Perl plugin, which its Windows installer offers as an optional component.

### 2. Start the bridge exe

Run `bridge.exe`. A console window will open and stay running in the background — keep it open while dispatching.

To confirm the version: `bridge.exe --version`

The bridge also reads your Elite journals, which is how Rat Mode knows your
commanders, ships, and current system. It finds them via the registry, since the
Saved Games folder can be relocated — set `JOURNAL_DIR` to override. Keep the
bridge up to date alongside the board: position tracking lives here, so an older
`bridge.exe` leaves it silently doing nothing.

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

**Case history**
- Previous cases for the client, on each case window — matched on both `client`
  and `clientNick`, since the two disagree on roughly a quarter of rescues
- Only closed rescues count as history; the case on screen never lists itself
- Every row expands to the full API record, the case log, and a paperwork link
- **Menu → Case search** searches the whole archive by client, system, rat,
  platform, status, outcome, date range or code red
- A client is free text with no account behind it, so a name match is possible
  history rather than a confirmed identity, and is labelled as such

**Rat Tracking**
- Rat progress bar (FR / WR / BC / FUEL) with cascade logic
- IRC nick learning via MechaSqueak relay messages
- Nearest station badge per case
- Pinned jump calls panel in each case window

**Your Accounts (Rat Mode)**
- Commanders are picked up from the game journal on first open, with their last system and current ship
- Position follows the journal while you play — no EDSM account, API key, or public profile needed
- Jump estimates per case via Spansh, using short and long range EDSY builds per account

**Alerts**
- Windows notification and/or sound when a case comes in, both off until switched on
- Selectable per platform, with PC split into Odyssey / Horizons / Legacy

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

### v2.0.0
- **One executable.** `FRBoard.exe` serves the board and bridges IRC in the same process, with `dist/` embedded inside it. Python is no longer needed to run the board, the `.bat` launcher is gone, and there is no longer a separate "is the board running or is the bridge running" to work out. It still serves on port `5173`, so the FuelRats sign-in redirect is unchanged
- **An installer.** `FRBoard-Setup.exe` installs to `%LOCALAPPDATA%\Programs\FRBoard`, creates a Start Menu entry, places the bridge script into AdiIRC or HexChat, and registers in Settings → Apps. Per-user, so no admin prompt. Run it again to update, or `--uninstall` to remove it
- The updater replaces the board, the executable **and** the IRC script together. Manually re-copying the `.mrc` after a release was the step most likely to be skipped, and skipping it is what left people on a broken bridge script
- Release archives are written with correct forward-slash paths. `Compress-Archive` emits backslash separators, which the ZIP spec does not permit — Windows copes, but on Linux and macOS every entry became one file with a backslash in its name rather than a directory

### v1.1.81
- A ship swap is noticed even if the board was closed when you made it. Detection compared against an in-memory record that emptied whenever `RatBoard` remounted, so a swap only registered if the board stayed open across it — reloading, opening the board afterwards, or toggling Rat/Dispatch mode all lost it. It now compares against the ship stored on the account, which survives all three
- Fixed the AdiIRC bridge script reporting `Listener: NOT ACTIVE` while it was serving, and `/bridge.start` then failing with `'ircbridge' socket in use`. AdiIRC returns empty for `$sock().listening` — unlike mIRC — and all three guards trusted it, so the status was a false negative and the advice it gave caused the error. Status now tests whether the socket exists, and start closes the name before listening
- `bridge.status` no longer lists the listener itself as a connected bridge, which made an idle client look like it had one attached
- Added `/bridge.debug`, which dumps the socket and connection state in one paste
- The launcher now says *why* Python is needed when it cannot find it — a static server, because browsers refuse ES modules over `file://` and sign-in needs a real address to return to — and warns that the Microsoft Store `python` stub is not a working install

### v1.1.8
- Case history and case search are open to every drilled rat. They were behind an additional **Drilled Dispatch** requirement, which has been removed. The board's own **Drilled Rat** requirement is unchanged
- Removed the second group lookup and the `useDispatcher` hook along with it

### v1.1.7
- Case history on each case: previous rescues for the client, matched on both `client` and `clientNick`, with the full API record, the case log and a paperwork link behind a toggle. Limited to **Drilled Dispatch**, and hidden rather than refused for anyone else
- **Menu → Case search** across the whole archive — client, system, rat, platform, status, outcome, date range, code red — paginated, same group requirement
- The board gate now reads the **Drilled Rat group** rather than the `dispatch.read`/`dispatch.write` permissions. Those come from that same group so the two agree today, but they are named after the dispatch board while being granted by the rat group, and would have changed meaning silently if that were ever tidied up
- Both gates share one `/profile` lookup instead of asking twice on every load
- Fixed the bridge treating a closed browser as a fault: a tab closing raised `ConnectionClosedOK` out of `websocket.send` and was reported as an error reading from IRC, which is the opposite end of the bridge

### v1.1.6
- The board verifies your account before it loads, requiring `dispatch.read` and `dispatch.write` — the permissions the **Drilled Rat** group carries. Anyone without them gets a screen pointing at how to get drilled or trained
- Fixed signing in with FuelRats never completing: `/authorize` redirects back with the token in the query string rather than the URL fragment, so the callback read an empty fragment and sent you back to the login screen after authorising successfully
- Journal reading is opt-in per account instead of adding every commander it finds. The import only fills gaps, so enabling it cannot clobber an account set up by hand, and disabling it leaves that account in place and stops updating it
- Case notes collapse runs of join/leave lines into one entry, so a client reconnecting repeatedly no longer buries the case
- Click a quote in the case notes to send it back as `!sub`, line and index already filled in
- Client-side sandbox at `#clienttest` for working on the case window without a live rescue
- Dropped twelve dependencies that were installed but never imported — `@mui/*`, `@emotion/*`, `date-fns`, `motion`, `react-dnd`, `react-slick`, `react-popper` among them
- Earlier releases of this fork were removed: the check lives in the app, so an older build was a way around it rather than an older version of it

### v1.1.5
- Rat Mode reads the game journal: your commanders are added automatically with their last system and current ship, taken from the game's own `Loadout` event
- Positions keep themselves current from the journal every 5 seconds, per-account, updating only the commander you are actually playing
- New-case alerts — Windows notification and/or sound, off until enabled, selectable per platform with PC split into Odyssey / Horizons / Legacy
- App version shown at the foot of the header menu
- `bridge.exe` down from 14.5 MB to 10.4 MB — PyInstaller was embedding a cryptography library the bridge never uses, picked up from the build machine
- Fixed an unnamed ship importing with a blank name: the game writes the ship name as a single space, so the fallback to the ship type was never reached. Affected pasted EDSY builds too
- Fixed a rescue with no platform or expansion throwing while being parsed, which would have taken the whole poll with it
- Fixed the rat status bar pushing its FR/WR/BC badges off the edge in a narrow column
- API requests no longer served from the browser cache, which could hand a poll a stale case list

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

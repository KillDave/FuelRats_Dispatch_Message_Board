"""
Installer and updater for the FuelRats Dispatch Board.

Three jobs, in rising order of intrusiveness:

  --check    say what is installed and what is available, touch nothing
  --update   replace the board, the bridge and the AdiIRC script in place
  --install  the above, plus register the script with AdiIRC and optionally
             the fr-dispatch:// protocol handler

The split matters. Updating only overwrites files that are already ours, so it
is safe to run at any time. Installing edits AdiIRC's config.ini, which AdiIRC
rewrites from memory when it exits -- so that half refuses to run while AdiIRC
is open, or the edit is silently undone the next time somebody closes it.

Standard library only, deliberately: this has to run before anything has been
installed, on a machine that may have no packages and no working pip.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

REPO = "techno314/FuelRats_Dispatch_Message_Board"
API_LATEST = f"https://api.github.com/repos/{REPO}/releases/latest"

# Frontier-style courtesy: identify the client. GitHub rejects requests with no
# User-Agent outright, so this is required rather than polite.
USER_AGENT = "FuelRatsDispatchBoard-Installer"

# Written beside the board so an update knows what it is replacing. The zip
# carries no version marker of its own -- the name does, but names get lost the
# moment somebody extracts into an existing folder.
STAMP = ".dispatch-board-version"

MRC_NAME = "adiirc_tcp_server.mrc"
SCRIPT_ENTRY = ".\\Scripts\\" + MRC_NAME

# HexChat's bridge script is Perl, not Python -- the README's reference to a
# hexchat_tcp_server_WIP.py is stale, no such file ships.
HEXCHAT_NAME = "hexchat_tcp_server.pl"


APP_NAME = "FuelRats Dispatch Board"
APP_KEY = "FRBoard"                       # registry key and folder name
PUBLISHER = "techno314"
BOARD_EXE = "FRBoard.exe"
SETUP_EXE = "FRBoard-Setup.exe"

# HKCU rather than HKLM throughout. A per-user install needs no elevation, so
# there is no UAC prompt and no "run as administrator" instruction -- which for
# an unsigned binary is the difference between a mild warning and a scary one.
UNINSTALL_KEY = rf"Software\Microsoft\Windows\CurrentVersion\Uninstall\{APP_KEY}"


# ---------------------------------------------------------------- locations

def default_install_dir() -> Path:
    """
    %LOCALAPPDATA%\\Programs\\FRBoard -- where per-user apps go on Windows.

    The same place VS Code and similar install to without elevation. Program
    Files would need admin, and running from Downloads leaves the app wherever
    the browser happened to put it.
    """
    base = os.environ.get("LOCALAPPDATA") or str(Path.home())
    return Path(base) / "Programs" / APP_KEY


def start_menu_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home())
    return Path(base) / "Microsoft" / "Windows" / "Start Menu" / "Programs"


def existing_install() -> Path | None:
    """Where a previous run put it, according to the uninstall entry."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as key:
            location, _ = winreg.QueryValueEx(key, "InstallLocation")
        path = Path(location)
        return path if path.is_dir() else None
    except (OSError, ImportError, FileNotFoundError):
        return None


# ---------------------------------------------------------------- shortcuts

def create_shortcut(link: Path, target: Path, args: str = "", desc: str = "") -> bool:
    """
    Write a .lnk.

    Done through PowerShell's WScript.Shell rather than pywin32, so the
    installer keeps its "standard library only" property and needs nothing
    installed on the machine it is run from.
    """
    link.parent.mkdir(parents=True, exist_ok=True)
    ps = (
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('{link}');"
        "$s.TargetPath = '{target}';"
        "$s.Arguments = '{args}';"
        "$s.WorkingDirectory = '{wd}';"
        "$s.Description = '{desc}';"
        "$s.Save()"
    ).format(link=link, target=target, args=args, wd=target.parent, desc=desc)
    try:
        done = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True, timeout=60, check=False,
        )
        return done.returncode == 0 and link.is_file()
    except (OSError, subprocess.SubprocessError):
        return False


# ---------------------------------------------------------------- registry

def register_uninstall(root: Path, version: str) -> bool:
    """
    Put the app in Settings > Apps, so it uninstalls like anything else.

    Windows lists whatever is under the Uninstall key; without this the app is
    invisible to the usual "add or remove programs" route and the only way to
    be rid of it is to delete a folder and guess at the leftovers.
    """
    try:
        import winreg
        size_kb = sum(f.stat().st_size for f in root.rglob("*") if f.is_file()) // 1024
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as key:
            values = {
                "DisplayName": APP_NAME,
                "DisplayVersion": version.lstrip("v"),
                "Publisher": PUBLISHER,
                "InstallLocation": str(root),
                "DisplayIcon": str(root / BOARD_EXE),
                "UninstallString": f'"{root / SETUP_EXE}" --uninstall',
                "URLInfoAbout": f"https://github.com/{REPO}",
            }
            for name, value in values.items():
                winreg.SetValueEx(key, name, 0, winreg.REG_SZ, value)
            winreg.SetValueEx(key, "EstimatedSize", 0, winreg.REG_DWORD, size_kb)
            for flag in ("NoModify", "NoRepair"):
                winreg.SetValueEx(key, flag, 0, winreg.REG_DWORD, 1)
        return True
    except (OSError, ImportError):
        return False


def unregister_uninstall() -> None:
    try:
        import winreg
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY)
    except (OSError, ImportError):
        pass


# ---------------------------------------------------------------- versions

def parse_version(text: str) -> tuple[int, ...]:
    """
    "v1.1.81" -> (1, 1, 81), for comparison rather than display.

    Compared numerically per component, so 1.1.81 correctly outranks 1.1.8 --
    a string comparison would get that backwards, and this project has both.
    """
    nums = re.findall(r"\d+", text or "")
    return tuple(int(n) for n in nums) or (0,)


def installed_version(root: Path) -> str | None:
    try:
        return (root / STAMP).read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def latest_release() -> dict:
    req = urllib.request.Request(API_LATEST, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/vnd.github+json",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


# ---------------------------------------------------------------- download

def download(url: str, dest: Path) -> Path:
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        # Release assets are served from a redirect that wants this explicitly.
        "Accept": "application/octet-stream",
    })
    with urllib.request.urlopen(req, timeout=120) as resp, dest.open("wb") as fh:
        shutil.copyfileobj(resp, fh)
    return dest


def safe_extract(archive: Path, into: Path) -> None:
    """
    Extract, normalising separators and refusing to escape `into`.

    Two hazards, both real here. The release zips are built with PowerShell's
    Compress-Archive, which writes entry names like "dist\\assets\\index.js" --
    backslashes, which the ZIP spec does not permit. Left alone those become
    one file with a backslash in its name rather than a directory tree.

    And an archive can name "../../anything"; nothing downloaded should be
    trusted to stay inside the folder it was pointed at, even from our own
    release page.
    """
    into.mkdir(parents=True, exist_ok=True)
    root = into.resolve()
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            name = info.filename.replace("\\", "/")
            if not name or name.endswith("/"):
                continue
            target = (root / name).resolve()
            if not str(target).startswith(str(root)):
                raise ValueError(f"archive entry escapes the target folder: {info.filename}")
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)


# ---------------------------------------------------------------- processes

def process_running(image: str) -> bool:
    """True if a process with this image name is running. Windows only."""
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {image}", "/NH"],
            capture_output=True, text=True, timeout=20, check=False,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return image.lower() in out.lower()


def stop_bridge() -> bool:
    """
    Stop the running bridge so its file can be replaced.

    Both names are handled. FRBoard.exe is the combined build that serves the
    board as well as bridging IRC; bridge.exe is what older installs have. A
    machine mid-upgrade can have either, and Windows will not let a running
    image be overwritten whichever it is called.
    """
    names = [n for n in ("FRBoard.exe", "bridge.exe") if process_running(n)]
    if not names:
        return True
    for name in names:
        subprocess.run(["taskkill", "/IM", name, "/F"],
                       capture_output=True, timeout=20, check=False)
    for _ in range(10):
        time.sleep(0.3)
        if not any(process_running(n) for n in names):
            return True
    return False


# ---------------------------------------------------------------- AdiIRC

def adiirc_config_dir() -> Path | None:
    """
    Where AdiIRC keeps Scripts/ and config.ini.

    %LOCALAPPDATA%\\AdiIRC on a normal install. A portable install keeps them
    beside the exe instead, so that is checked too -- and config.ini has to be
    present, because an empty folder left by an uninstall would otherwise look
    like a valid target.
    """
    candidates = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "AdiIRC",
        Path(os.environ.get("APPDATA", "")) / "AdiIRC",
        Path(r"C:\Program Files\AdiIRC"),
        Path(r"C:\Program Files (x86)\AdiIRC"),
    ]
    for path in candidates:
        if path.is_dir() and (path / "config.ini").is_file():
            return path
    return None


def install_mrc(cfg: Path, source: Path) -> Path:
    """
    Drop the script into AdiIRC's Scripts folder, replacing what is there.

    Overwriting a fixed path is the point: the manual route ("click New, save
    as...") is what leaves people with two copies loaded, both answering
    on *:START:, fighting over the same socket. A program cannot make that
    mistake.

    The previous copy is kept once, so a bad release can be put back by hand.
    """
    scripts = cfg / "Scripts"
    scripts.mkdir(parents=True, exist_ok=True)
    target = scripts / MRC_NAME
    if target.is_file():
        shutil.copy2(target, target.with_suffix(target.suffix + ".bak"))
    shutil.copy2(source, target)
    return target


def mrc_registered(cfg: Path) -> bool:
    """
    Whether config.ini already loads our script.

    Worth knowing separately from doing the registration, because it decides
    whether AdiIRC needs to be closed at all. Replacing the script file itself
    is safe at any time -- AdiIRC notices the change on disk and offers to
    reload -- so an install that has nothing to register need not interrupt
    anyone.
    """
    try:
        text = (cfg / "config.ini").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    return MRC_NAME.lower() in text.lower()


def register_mrc(cfg: Path) -> str:
    """
    Ensure config.ini's [Scripts] section loads our file.

    Entries look like `n4=.\\Scripts\\adiirc_tcp_server.mrc`, numbered from
    zero. A missing entry is appended with the next free index; an existing one
    is left alone, because rewriting it would only risk reordering somebody
    else's scripts for no gain.

    Caller must have checked AdiIRC is closed. It holds this file in memory and
    writes it out on exit, so an edit made underneath a running client vanishes
    without any error to notice.
    """
    ini = cfg / "config.ini"
    text = ini.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()

    start = next((i for i, l in enumerate(lines) if l.strip().lower() == "[scripts]"), None)
    if start is None:
        lines += ["", "[Scripts]", "n0=" + SCRIPT_ENTRY]
        ini.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return "created [Scripts] and registered the script"

    end = next((i for i in range(start + 1, len(lines))
                if lines[i].startswith("[")), len(lines))
    section = lines[start + 1:end]

    if any(MRC_NAME.lower() in l.lower() for l in section):
        return "already registered"

    used = []
    last = start  # insert straight after the header if the section is empty
    for offset, line in enumerate(section, start=start + 1):
        if m := re.match(r"\s*n(\d+)\s*=", line):
            used.append(int(m.group(1)))
            last = offset
    nxt = max(used) + 1 if used else 0

    # Placed against the last real entry rather than at the section's end,
    # which would put it after any trailing blank line and leave a gap in the
    # middle of the list.
    shutil.copy2(ini, ini.with_suffix(".ini.installer-bak"))
    lines.insert(last + 1, f"n{nxt}={SCRIPT_ENTRY}")
    ini.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return f"registered as n{nxt}"


# ---------------------------------------------------------------- HexChat

def hexchat_config_dir() -> Path | None:
    """
    Where HexChat keeps addons/ and hexchat.conf.

    %APPDATA%\\HexChat is the documented Windows location. Written from the
    documented layout rather than from a machine with HexChat on it, so treat
    the ordering as a best guess -- hexchat.conf must be present before any of
    these is accepted, which keeps a wrong guess harmless rather than scattering
    files into an unrelated folder.
    """
    candidates = [
        Path(os.environ.get("APPDATA", "")) / "HexChat",
        Path(os.environ.get("LOCALAPPDATA", "")) / "HexChat",
        Path.home() / ".config" / "hexchat",
    ]
    for path in candidates:
        if path.is_dir() and (path / "hexchat.conf").is_file():
            return path
    return None


def install_hexchat_addon(cfg: Path, source: Path) -> Path:
    """
    Drop the Perl script into addons/, which HexChat loads on startup.

    Simpler than the AdiIRC side: there is no registration to do and no config
    file to edit, so nothing has to be closed first. HexChat picks up anything
    in addons/ when it starts, and the running client keeps the old copy until
    it is restarted.

    Needs HexChat's Perl plugin, which its Windows installer offers as an
    optional component. Without it the file sits there doing nothing, and
    HexChat says so at startup.
    """
    addons = cfg / "addons"
    addons.mkdir(parents=True, exist_ok=True)
    target = addons / HEXCHAT_NAME
    if target.is_file():
        shutil.copy2(target, target.with_suffix(target.suffix + ".bak"))
    shutil.copy2(source, target)
    return target


def install_irc_scripts(staged: Path, do_install: bool) -> None:
    """
    Put the bridge script wherever there is a client to use it.

    Both clients are handled, and neither being present is not an error: plenty
    of people run one, and somebody evaluating the board may have installed
    neither yet.
    """
    adi = adiirc_config_dir()
    hexchat = hexchat_config_dir()

    if adi is None and hexchat is None:
        print("  no AdiIRC or HexChat config found; skipped the bridge scripts")
        print("  install one, then run --install again to place them")
        return

    if adi is not None:
        found = next(iter(staged.rglob(MRC_NAME)), None)
        if found is None:
            print("  the release has no AdiIRC script; skipped")
        else:
            was_registered = mrc_registered(adi)
            install_mrc(adi, found)
            print(f"  AdiIRC script updated at {adi / 'Scripts' / MRC_NAME}")
            if do_install:
                print(f"  AdiIRC: {register_mrc(adi)}")
            if was_registered and process_running("AdiIRC.exe"):
                # AdiIRC watches loaded scripts and prompts when one changes on
                # disk, so telling people to reload by hand is noise -- and
                # would have them running /bridge.restart on top of a reload.
                print("  AdiIRC: it will ask whether to reload -- say yes")
            elif not process_running("AdiIRC.exe"):
                print("  AdiIRC: it will load on next start")

    if hexchat is not None:
        found = next(iter(staged.rglob(HEXCHAT_NAME)), None)
        if found is None:
            print("  the release has no HexChat script; skipped")
        else:
            target = install_hexchat_addon(hexchat, found)
            print(f"  HexChat addon updated at {target}")
            print("  HexChat: restart the client to load it (addons load at startup)")


# ---------------------------------------------------------------- protocol

def register_protocol(bridge: Path) -> str:
    """Hand off to the bridge, which already owns this registration."""
    try:
        subprocess.run([str(bridge), "--register"], timeout=30, check=False)
        return "protocol handler registered"
    except (OSError, subprocess.SubprocessError) as err:
        return f"could not register protocol handler: {err}"


# ---------------------------------------------------------------- commands

def finish_install(root: Path, version: str, desktop: bool) -> None:
    """
    The parts that make it an installed application rather than a loose folder.

    Three things, in order of what people notice: a Start Menu entry (which is
    also what Windows Search indexes, so typing "FuelRats" finds it), a copy of
    this installer kept alongside so uninstall and update work later, and the
    Add/Remove Programs registration.
    """
    # Keep the installer beside the app. Running from Downloads and then
    # deleting it would otherwise leave nothing able to uninstall or update.
    try:
        source = Path(sys.executable if getattr(sys, "frozen", False) else __file__)
        if source.is_file() and source.parent.resolve() != root.resolve():
            shutil.copy2(source, root / (SETUP_EXE if getattr(sys, "frozen", False) else source.name))
    except OSError as err:
        print(f"  could not keep a copy of the installer here: {err}")

    exe = root / BOARD_EXE
    if exe.is_file():
        link = start_menu_dir() / f"{APP_NAME}.lnk"
        if create_shortcut(link, exe, desc="Dispatch board for Fuel Rats"):
            print(f"  Start Menu entry created (also how Windows Search finds it)")
        else:
            print("  could not create the Start Menu entry")

        if desktop:
            home = Path(os.environ.get("USERPROFILE") or Path.home())
            if create_shortcut(home / "Desktop" / f"{APP_NAME}.lnk", exe):
                print("  desktop shortcut created")

    if register_uninstall(root, version):
        print("  listed in Settings > Apps, so it uninstalls like anything else")
    else:
        print("  could not add the Add/Remove Programs entry")


def cmd_uninstall(interactive_mode: bool = False) -> int:
    """Remove the app, its shortcuts and its registration."""
    root = existing_install()
    if root is None:
        print("  no installation found to remove.")
        if interactive_mode:
            pause()
        return 1

    print(f"  installed at: {root}")
    if interactive_mode and not ask_yes("Remove it?", default=False):
        pause()
        return 0

    stop_bridge()

    for link in (start_menu_dir() / f"{APP_NAME}.lnk",
                 Path(os.environ.get("USERPROFILE") or Path.home()) / "Desktop" / f"{APP_NAME}.lnk"):
        try:
            link.unlink(missing_ok=True)
        except OSError:
            pass
    print("  shortcuts removed")

    unregister_uninstall()
    print("  registry entry removed")

    # Everything except this executable, which Windows holds open for as long
    # as it is running.
    running = Path(sys.executable).resolve() if getattr(sys, "frozen", False) else None
    for item in sorted(root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if running is not None and item.resolve() == running:
            continue
        try:
            item.unlink() if item.is_file() else item.rmdir()
        except OSError:
            pass

    try:
        root.rmdir()
        print("  files removed")
    except OSError:
        # This executable stays. It cannot delete itself while running, and the
        # workaround -- spawning a detached shell to do it afterwards -- is a
        # shape antivirus recognises, which is not worth inviting on a binary
        # that is already unsigned.
        #
        # Keeping it is useful anyway: reinstalling or updating later needs no
        # fresh download.
        print(f"  files removed; {SETUP_EXE} kept for reinstalling later")
        print(f"  delete {root} yourself if you want it gone entirely")

    print("\n  The AdiIRC and HexChat scripts were left in place -- they are")
    print("  config for your IRC client, not part of this app.")
    if interactive_mode:
        pause()
    return 0


def cmd_check(root: Path) -> int:
    have = installed_version(root)
    try:
        rel = latest_release()
    except (urllib.error.URLError, OSError, ValueError) as err:
        print(f"  could not reach GitHub: {err}")
        return 1

    tag = rel.get("tag_name", "?")
    print(f"  installed : {have or '(no version stamp - never installed by this tool)'}")
    print(f"  latest    : {tag}")
    if have and parse_version(have) >= parse_version(tag):
        print("  up to date")
    else:
        print("  an update is available -- run with --update")
    return 0


def cmd_update(root: Path, do_install: bool) -> int:
    if do_install:
        adi = adiirc_config_dir()
        # Only an unregistered script forces AdiIRC to be closed: that is the
        # one case needing a config.ini edit, and AdiIRC rewrites that file on
        # exit. Replacing an already-registered script is safe while it runs --
        # AdiIRC notices the file changed and offers to reload it. HexChat has
        # no equivalent step at all; addons load from a folder.
        if adi is not None and not mrc_registered(adi) and process_running("AdiIRC.exe"):
            print("  AdiIRC has not loaded this script before, so registering it means")
            print("  editing config.ini -- which AdiIRC overwrites when it closes.")
            print("  Close AdiIRC and run this again, or use --update to skip registering.")
            return 1
        if adi is None and hexchat_config_dir() is None:
            print("  neither AdiIRC nor HexChat found, so there is nothing to register.")
            print("  --update still works if you only want the board and the bridge.")
            return 1

    try:
        rel = latest_release()
    except (urllib.error.URLError, OSError, ValueError) as err:
        print(f"  could not reach GitHub: {err}")
        return 1

    tag = rel.get("tag_name", "")
    assets = {a["name"]: a["browser_download_url"] for a in rel.get("assets", [])}
    print(f"  latest release: {tag}")

    board = next((n for n in assets if n.startswith("Dispatch_Board_")), None)
    combined = "FRBoard.exe" in assets

    # The board zip is only needed by the older split builds. FRBoard.exe
    # carries dist/ inside itself, so a release shipping it needs no separate
    # copy -- and insisting on one would leave this unable to install exactly
    # the releases it was written for.
    if board is None and not combined:
        print("  that release has neither FRBoard.exe nor a Dispatch_Board_*.zip.")
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)

        if board is not None:
            print(f"  downloading {board}")
            safe_extract(download(assets[board], tmpdir / board), tmpdir / "board")

            staged = tmpdir / "board"
            dist = staged / "dist"
            if dist.is_dir():
                # Replaced wholesale rather than merged: a stale hashed bundle
                # left from a previous version is invisible and still loads.
                if (root / "dist").exists():
                    shutil.rmtree(root / "dist")
                shutil.move(str(dist), str(root / "dist"))
                print("  board updated")
            elif not combined:
                print("  the archive has no dist/ folder; refusing to guess.")
                return 1

            for extra in staged.glob("*.bat"):
                shutil.copy2(extra, root / extra.name)
        else:
            print("  board travels inside FRBoard.exe; no separate copy needed")

        # FRBoard.exe is preferred: it serves the board as well as bridging, so
        # a release carrying it needs no separate web server. bridge.exe is the
        # older split build, still accepted so this can update an install that
        # predates the merge.
        exe_name = next((n for n in ("FRBoard.exe", "bridge.exe") if n in assets), None)
        if exe_name is not None:
            if stop_bridge():
                download(assets[exe_name], tmpdir / exe_name)
                shutil.copy2(tmpdir / exe_name, root / exe_name)
                print(f"  {exe_name} updated")
                # Leave no doubt about which one to run.
                stale = root / ("bridge.exe" if exe_name == "FRBoard.exe" else "FRBoard.exe")
                if stale.is_file():
                    stale.rename(stale.with_suffix(".exe.superseded"))
                    print(f"  renamed the superseded {stale.name} out of the way")
            else:
                print(f"  {exe_name} is still running and could not be replaced; skipped")

        if "IRC_Scripts.zip" in assets:
            safe_extract(download(assets["IRC_Scripts.zip"], tmpdir / "irc.zip"), tmpdir / "irc")
            install_irc_scripts(tmpdir / "irc", do_install)
        else:
            print("  that release has no IRC_Scripts.zip; skipped the bridge scripts")

    (root / STAMP).write_text(tag, encoding="utf-8")

    if do_install and (root / "bridge.exe").is_file():
        print(f"  {register_protocol(root / 'bridge.exe')}")

    print(f"  done -- now on {tag}")
    return 0


def how_to_start(root: Path) -> str:
    """
    Name whatever was actually installed, rather than what we hope was.

    Releases carry one of two shapes. FRBoard.exe serves the board and bridges
    IRC in one process; bridge.exe is the older split build that needs a
    separate web server, which is what the .bat starts. Naming the wrong one
    sends people looking for a file that is not there -- and it is the last
    line they read, so it is the one that has to be right.
    """
    if (root / "FRBoard.exe").is_file():
        return "Run FRBoard.exe to start the board."
    if (root / "bridge.exe").is_file():
        launcher = "Launch Dispatch Board.bat"
        if (root / launcher).is_file():
            return f'Run bridge.exe, then "{launcher}" to open the board.'
        return "Run bridge.exe, then serve dist/ over HTTP to open the board."
    return "No board executable was installed -- check the messages above."


def pause() -> None:
    """
    Hold the window open.

    A double-clicked exe gets its own console, which closes the instant the
    process ends -- so without this the whole run, errors included, flashes past
    unread. Only used on the interactive path; a scripted run should not block.
    """
    try:
        input("\n  Press Enter to close...")
    except EOFError:
        pass


def ask_yes(question: str, default: bool = True) -> bool:
    suffix = "[Y/n]" if default else "[y/N]"
    try:
        answer = input(f"  {question} {suffix} ").strip().lower()
    except EOFError:
        return default
    if not answer:
        return default
    return answer.startswith("y")


def interactive(root: Path) -> int:
    """
    What happens when somebody double-clicks the thing.

    Argparse's "one of the arguments is required" is the correct answer to a
    malformed command line and the wrong answer to a double-click, which is how
    an installer is normally run. So no arguments means: say what is installed,
    offer the obvious action, do it, and wait before closing.
    """
    # ASCII only in anything printed. A double-clicked console on Windows is
    # cp437 or cp1252, not UTF-8, so an em-dash here renders as a replacement
    # character in the first line the user ever sees.
    print("  FuelRats Dispatch Board - installer")
    print("  " + "-" * 42)
    print(f"  install folder: {root}")

    have = installed_version(root)
    fresh = have is None
    try:
        tag = latest_release().get("tag_name", "?")
    except (urllib.error.URLError, OSError, ValueError) as err:
        print(f"\n  Could not reach GitHub: {err}")
        print("  Check the connection and try again.")
        pause()
        return 1

    print(f"  installed     : {have or '(nothing installed here yet)'}")
    print(f"  latest        : {tag}\n")

    first_time = have is None
    if not first_time and parse_version(have) >= parse_version(tag):
        print("  Already up to date.")
        if not ask_yes("Reinstall anyway?", default=False):
            pause()
            return 0

    # A first run wants the IRC client wired up too; a returning user usually
    # just wants the new files, and that half never needs anything closed.
    want_register = ask_yes(
        "Register the bridge script with your IRC client as well?" if first_time
        else "Also re-register the bridge script with your IRC client?",
        default=first_time,
    )

    # Only the config.ini edit is unsafe with AdiIRC open, and only a script it
    # has never loaded needs one. An update to an already-registered script is
    # just a file replacement, which AdiIRC spots and offers to reload -- so
    # there is nothing to interrupt the user about in the common case.
    adi = adiirc_config_dir()
    needs_ini_edit = want_register and adi is not None and not mrc_registered(adi)

    if needs_ini_edit and process_running("AdiIRC.exe"):
        print("\n  AdiIRC has not loaded this script before, so it needs a line")
        print("  adding to config.ini -- and AdiIRC rewrites that file when it")
        print("  closes, which would undo the change silently.")
        if ask_yes("Continue without registering?", default=True):
            want_register = False
        else:
            print("  Close AdiIRC and run this again.")
            pause()
            return 1

    desktop = ask_yes("Create a desktop shortcut?", default=False) if fresh else False

    print()
    root.mkdir(parents=True, exist_ok=True)
    code = cmd_update(root, do_install=want_register)
    if code == 0:
        finish_install(root, installed_version(root) or tag, desktop)
        print("\n  " + how_to_start(root))
        print(f"  Installed to {root}")
    pause()
    return code


def main() -> int:
    if os.name != "nt":
        print("This installer targets Windows; AdiIRC and FRBoard.exe are Windows-only.")
        return 1

    ap = argparse.ArgumentParser(description="Install or update the FuelRats Dispatch Board.")
    # Not required: no mode means a double-click rather than a malformed
    # command, and the right answer to that is to ask, not to print a usage
    # error into a console that closes before it can be read.
    mode = ap.add_mutually_exclusive_group(required=False)
    mode.add_argument("--check", action="store_true", help="report versions, change nothing")
    mode.add_argument("--update", action="store_true", help="replace board, bridge and script")
    mode.add_argument("--install", action="store_true",
                      help="update, then register with AdiIRC (needs AdiIRC closed)")
    mode.add_argument("--uninstall", action="store_true",
                      help="remove the app, its shortcuts and its registration")
    ap.add_argument("--dir", type=Path, default=None,
                    help="install location (default: where it is already installed, "
                         "or %%LOCALAPPDATA%%\\Programs\\FRBoard)")
    args = ap.parse_args()

    if args.uninstall:
        return cmd_uninstall()

    # Where an existing install lives wins, so an update never forks into a
    # second copy. Otherwise the standard per-user location -- not the folder
    # this happens to be sitting in, which is usually Downloads.
    root = (args.dir or existing_install() or default_install_dir()).resolve()

    if not (args.check or args.update or args.install):
        return interactive(root)

    print(f"  install folder: {root}")
    if args.check:
        return cmd_check(root)
    return cmd_update(root, do_install=args.install)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n  cancelled")
        raise SystemExit(130)

# AI Control Center

<img width="50%" height="50%" alt="icon" src="https://github.com/user-attachments/assets/55b9a4eb-5ae4-4a2a-9a77-21e8a44c1c73" />

A desktop app that brings **Muse (Meta)**, **Claude** and **ChatGPT** together in one glass window. It uses their official websites and the subscriptions you already have: no API, no keys.

> **Vibe-coded.** This app was built almost entirely through conversation with an AI coding assistant (Claude Code), with a human steering, testing and deciding. The code has been read and exercised, but not audited line by line. Use it at your own risk and read the source if that matters to you.

- **One view per AI**, each with its **own isolated, persistent session**. Sign in once, Google sign-in included, and you stay signed in across restarts.
- **Instant switching.** Views stay alive in the background, so a running answer is never interrupted.
- **Native notifications** when an AI is done or **needs you** (a question or an approval). The rail icon breathes until you look, and a click brings you back to the right conversation.
- **Liquid Glass UI.** Native vibrancy on macOS, compositor blur on Linux, a clean tinted fallback otherwise. Each site is reskinned in its AI's colour: warm orange for Claude, blue for Muse, near-black for ChatGPT.
- **System tray icon**: StatusNotifierItem on Linux, a template icon on macOS.
- **Lots of settings**: theme, tint, rail order, per-AI colour and zoom, do not disturb, launch at login, a global shortcut…
- **AI list in a config file**: add a new AI without touching the code.

Platforms: **Arch Linux / CachyOS** (Wayland and X11; KDE, Hyprland, GNOME) and **macOS** (Apple Silicon first, Intel too). The interface is in French.

---

## Contents

0. [Install a release](#0-install-a-release)
1. [Dependencies](#1-dependencies)
2. [Run in development](#2-run-in-development)
3. [Build packages](#3-build-packages) (AppImage, PKGBUILD, dmg)
4. [Glass effect: setting up blur](#4-glass-effect-setting-up-blur) (KDE, Hyprland)
5. [Tray icon](#5-tray-icon)
6. [Usage](#6-usage) (shortcuts, settings, [signing in with your browser](#signing-in-with-your-browser))
7. [Adding an AI](#7-adding-an-ai)
8. [Notifications: how they work, how to fix them](#8-notifications-how-they-work-how-to-fix-them)
9. [Site skins](#9-site-skins)
10. [Troubleshooting](#10-troubleshooting)
11. [Project layout](#11-project-layout)

---

## 0. Install a release

Download the files from the [Releases page](https://github.com/UncleClaude/ai-control-center/releases).

**Linux (AppImage)**

```bash
chmod +x AI-Control-Center-*-x86_64.AppImage
./AI-Control-Center-*-x86_64.AppImage
```

The AppImage needs `fuse2` (`sudo pacman -S fuse2`). Alternatively, run it with `--appimage-extract-and-run`. To get it into your application menu, use a tool like Gear Lever or AppImageLauncher, or write a `.desktop` file in `~/.local/share/applications/` whose `Exec=` points to the AppImage and with `StartupWMClass=ai-control-center`.

**macOS (dmg)**

Pick `arm64` for Apple Silicon, `x64` for Intel. Drag the app into Applications. If the release was **signed and notarized** (Developer ID — see [§3](#dmg-macos)), it just opens. Otherwise it is **not signed**, so on first launch right-click it → Open, or run:

```bash
xattr -dr com.apple.quarantine "/Applications/AI Control Center.app"
```

**Windows (installer)**

Run `AI-Control-Center-*-Setup-x64.exe` and follow the installer (it installs per-user, no admin needed). The installer is **not signed**, so SmartScreen shows a warning the first time: click **More info → Run anyway**. Updates download and run the new installer automatically.

---

## 1. Dependencies

### Arch Linux / CachyOS (pacman)

To develop and build:

```bash
sudo pacman -S --needed nodejs npm git base-devel librsvg
```

To run:

| Package | Why |
|---|---|
| `electron44` | runtime for the app installed by the PKGBUILD (pulled in automatically) |
| `libnotify` | native notifications |
| `fuse2` | running the AppImage (otherwise: `--appimage-extract-and-run`) |

```bash
sudo pacman -S --needed electron44 libnotify fuse2
```

Optional:

- KDE, real blur behind the window: `kwin-effects-better-blur-dx-git` (AUR), see [§4](#kde-plasma-kwin).
- GNOME, tray icon: `gnome-shell-extension-appindicator`.
- Hyprland, tray icon: `waybar` with the `tray` module.

### macOS (Homebrew)

```bash
brew install node git
```

Building the `.dmg` needs the Xcode Command Line Tools (`xcode-select --install`).

---

## 2. Run in development

```bash
npm install
npm run dev
```

The main process and the preloads are rebuilt at every launch, and the app's own UI (rail, settings) hot-reloads. After changing `src/main`, `src/preload`, `src/adapters` or `src/skins`, run `npm run dev` again: the new instance replaces the running one.

> Closing the window **hides it in the tray**; the app keeps running. To really quit: Ctrl+Q (Cmd+Q on macOS) or tray → Quitter.

Useful variables:

| Variable | Effect |
|---|---|
| `AICC_PROFILE=test` | separate profile (sessions, single-instance lock), to test without touching your sign-ins |
| `AICC_DEBUG=1` | logs every notification decision in the terminal |
| `AICC_GLASS=glass\|solid\|auto` | forces the glass mode (overrides the setting) |
| `AICC_SKINS=0` | disables site skins |

```bash
npm run dev:inspect     # like dev, with the Chromium debugging port 9333 (inspect the sites)
npm run typecheck       # TypeScript check
```

Where the data lives:

| | Linux | macOS |
|---|---|---|
| Profile (sessions, cookies) | `~/.config/ai-control-center/` | `~/Library/Application Support/ai-control-center/` |
| AI list | `…/ais.json` | same |
| State and settings | `…/state.json` | same |
| Custom skins | `…/skins/<id>.css` | same |

---

## 3. Build packages

### AppImage (Linux)

```bash
npm run dist:linux
# → dist/AI-Control-Center-<version>-x86_64.AppImage
```

The AppImage bundles its own Electron (about 120 MB).

### Arch package (PKGBUILD)

The PKGBUILD builds the package from the repository's **latest commit** and runs on the system Electron (`electron44`). The package is about 1 MB and gets Chromium security updates through pacman.

```bash
cd packaging/arch
makepkg -si
```

What gets installed:

- `/usr/bin/ai-control-center`: launcher (`electron44 --class=ai-control-center …/app.asar`);
- `/usr/lib/ai-control-center/`: `app.asar` and resources;
- the `.desktop` menu entry and hicolor icons.

To pass Chromium flags, create `~/.config/ai-control-center-flags.conf` with one flag per line. For example, to force X11:

```
--ozone-platform=x11
```

> Commit your changes before running `makepkg`: it only takes `HEAD`.

<a id="dmg-macos"></a>
### .dmg (macOS)

This has to run **on a Mac**; the dmg cannot be built from Linux.

```bash
npm install
npm run dist:mac
# → dist/AI-Control-Center-<version>-arm64.dmg and -x64.dmg
```

**Signing & notarization.** With no certificate the build is unsigned (set `CSC_IDENTITY_AUTO_DISCOVERY=false` so it doesn't look for one), and users clear the Gatekeeper flag manually (`xattr …`). To produce a dmg that **opens with no warning and no command**, sign with a **Developer ID Application** certificate (needs a paid Apple Developer account) and notarize. The CI does this automatically once these repository secrets exist (Settings → Secrets and variables → Actions):

| Secret | What it is |
|---|---|
| `MAC_CSC_LINK` | the Developer ID **Application** certificate as a base64 `.p12` (`base64 -i cert.p12`) |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` export password |
| `APPLE_ID` | your Apple ID e-mail |
| `APPLE_APP_SPECIFIC_PASSWORD` | an [app-specific password](https://support.apple.com/102654) for that Apple ID |
| `APPLE_TEAM_ID` | your 10-character Apple Developer Team ID |

When `MAC_CSC_LINK` is set the release workflow signs with the hardened runtime and notarizes (`--config.mac.notarize=true`); the stapled dmg then opens on any Mac with no quarantine step. Without the secrets the build stays unsigned and nothing else changes. Locally you can do the same by exporting `CSC_LINK`, `CSC_KEY_PASSWORD` and the `APPLE_*` variables before `npm run dist:mac`.

### Windows installer (.exe)

Builds **on Windows** (no Wine needed in CI):

```bash
npm install
npm run dist:win
# → dist/AI-Control-Center-<version>-Setup-x64.exe
```

A per-user NSIS installer (assisted; the user can pick the folder). It is **unsigned** by default, so SmartScreen warns once — to sign it, provide a code-signing certificate via `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`.

### Releases (GitHub Actions)

`.github/workflows/release.yml` builds the AppImage on Ubuntu, both dmgs on macOS and the installer on Windows, then attaches them to a GitHub release. macOS is signed + notarized when the secrets above are set. To publish a version:

```bash
npm version patch          # or minor / major: bumps package.json and creates the v* tag
git push --follow-tags
```

The workflow can also be started by hand (Actions → Release → Run workflow); it then builds without publishing and keeps the files as workflow artifacts.

---

## 4. Glass effect: setting up blur

The app's own UI (rail, toolbar, settings) is glass. **Site content always stays opaque and readable.** At startup the terminal prints the chosen mode, for example `[glass] mode blur (Hyprland)`.

| Mode | When | Result |
|---|---|---|
| `vibrancy` | macOS | real desktop blur (NSVisualEffectView) |
| `blur` | Hyprland; KDE with a force-blur plugin | transparent window, blurred by the compositor |
| `tint` | Wayland without blur (KDE without the plugin…) | fallback: opaque window tinted with the active AI's colour |
| `solid` | no compositor, or the "Opaque" setting | opaque background |

Change the mode in **Réglages → Apparence → Effet de verre** (Auto / Verre / Opaque). It applies at the next launch.

### KDE Plasma (KWin)

KWin only blurs windows that ask for it through a Wayland protocol Electron does not speak. You need an effect that can **force blur** per window class:

1. Install the effect from the AUR:
   ```bash
   paru -S kwin-effects-better-blur-dx-git   # or yay -S …
   ```
   On X11, use `kwin-effects-better-blur-dx-x11`.
2. **System Settings → Window Management → Desktop Effects**:
   - disable the stock **Blur** effect;
   - enable **Better Blur** and open its settings.
3. Under **Force blur**, add the window class:
   ```
   ai-control-center
   ```
4. Restart the app; the terminal should print `[glass] mode blur (KWin + plugin de flou forcé)`.

Without the plugin, the app stays in `tint` mode: clean, but no desktop blur.

### Hyprland

Hyprland blurs transparent windows as soon as blur is enabled. In `~/.config/hypr/hyprland.conf`:

```ini
decoration {
    blur {
        enabled = true
        size = 8
        passes = 3
        new_optimizations = true
        xray = false
    }
}

# Keep the app fully opaque at the compositor level: the transparency comes from the app itself,
# a global opacity (active/inactive_opacity) must not stack on top of it.
windowrulev2 = opacity 1.0 override 1.0 override, class:^(ai-control-center)$
```

> Depending on your Hyprland version, the rule keyword may be `windowrule` instead of `windowrulev2`. The class to target is always `ai-control-center`. If you have a global `noblur` rule, exclude this class.

---

## 5. Tray icon

| Environment | What you need |
|---|---|
| KDE Plasma (Wayland / X11) | nothing, native StatusNotifierItem |
| Hyprland | `waybar` with the `tray` module (see below) |
| GNOME | the **AppIndicator** extension: `sudo pacman -S gnome-shell-extension-appindicator`, then enable it in Extensions |
| macOS | nothing, monochrome icon in the menu bar |

On Linux, Electron publishes the icon through **StatusNotifierItem** (D-Bus); no `libappindicator` is needed.

Waybar (`~/.config/waybar/config.jsonc`):

```jsonc
"modules-right": ["tray", "clock"],
"tray": { "icon-size": 18, "spacing": 8 }
```

Behaviour:

- **Clicking** the icon shows or hides the window. On macOS a click opens the menu.
- **The menu** lets you open an AI directly, toggle "Do not disturb" and "Keep in the tray when closing", and quit.
- A **dot** appears on the icon while an answer is unread, and the menu shows the count per AI.

---

## 6. Usage

### Shortcuts

*Mod* is Ctrl on Linux and Cmd on macOS. Shortcuts use physical keys, so Mod+1 also works on **AZERTY** keyboards.

| Shortcut | Action |
|---|---|
| Mod+1, Mod+2, Mod+3… | switch AI |
| Mod+R | reload the active view (Mod+Shift+R: bypass cache) |
| Mod+[ / Mod+] | back / forward in the view's history |
| Alt+← / Alt+→ (Linux) | back / forward (handy on AZERTY, where [ and ] need AltGr) |
| Mod+= / Mod+- / Mod+0 | zoom in / out / reset for the active AI (remembered per AI) |
| Mod+, | settings |
| Ctrl+Q (Linux), Cmd+Q (macOS) | quit |
| F12 / Mod+Shift+I | developer tools for the active view |
| Esc | close the settings |
| Global shortcut (optional) | show / hide the window from anywhere, `CommandOrControl+Shift+Space` by default |

### Settings (gear icon at the bottom of the rail)

- **Per AI**:
  - show or hide the AI (a hidden AI is not loaded) and reorder the rail with the arrows; the order also drives Mod+1, Mod+2…;
  - notifications, sound, app-coloured skin;
  - custom colour: replaces the `ais.json` colour in the rail, the window tint and the site skin; ↺ restores the original;
  - page zoom, 50 to 200 %;
  - **Tester** shows a sample notification;
  - **Vider le cache** reloads the page without cache and keeps you signed in;
  - **Se déconnecter** wipes the site's cookies and data. It needs two clicks to confirm;
  - click an AI's name to **rename** it;
  - **Logo** replaces the icon with any image you pick: it is resized into the same rounded "bubble" as the other logos (a cut-out glyph is centred on the AI's colour; an image with its own background fills the bubble), so every icon stays consistent. ↺ restores the original;
  - **Supprimer** removes an AI you added (two clicks to confirm); the three built-in AIs can only be hidden.
- **Add an AI** (bottom of the AI list, no restart):
  - **Nouvelle instance** — pick an existing AI, give it a name, and get a second copy with its **own login**: a Claude for work and a Claude for personal, two ChatGPT accounts, and so on;
  - **Service personnalisé** — add any web app by name + URL (self-hosted **OpenWebUI**, **openclaw**, **LibreChat**, Le Chat, Perplexity…). Browser sign-in (Google/Apple) is handled the same as for the built-in AIs.
- **Appearance**:
  - System / Light / Dark theme, applied to the app and to sites that follow the system theme;
  - surface tint (0–30 %, live preview);
  - glass effect (Auto / Glass / Opaque, at next launch);
  - reduce motion: unread icons glow instead of breathing.
- **Notifications**: *Do not disturb* silences popups and sounds; icons still mark unread answers. It is also in the tray menu.
- **Startup and window**:
  - **launch at login**, optionally hidden in the tray. On Linux this writes `~/.config/autostart/ai-control-center.desktop`. It needs the AppImage or the Arch package, not a source checkout;
  - AI shown at startup (the last one used, or a fixed one);
  - keep the app in the tray when closing the window;
  - **global shortcut** to show or hide the window from anywhere (customisable). Under Wayland it goes through the XDG GlobalShortcuts portal, and KDE and Hyprland (with `xdg-desktop-portal-hyprland`) ask for confirmation the first time.
- **Files**: quick access to `ais.json`, the skins folder and the data folder.
- **Shortcuts and version**: a shortcut cheat sheet, plus the app, Electron and Chromium versions.

The chevron at the bottom of the rail shows the AI names. The app remembers the window size, its maximised state and the last AI. Under Wayland the compositor places windows, so the position is not restored.

### Signing in with your browser (automatic)

Google and Apple block sign-in from any embedded browser engine ("this browser may not be secure"), worst on macOS. These sites are also not OAuth providers for third-party apps, so there is no real "log in and get redirected straight back to the app" flow.

So the app handles it automatically, like a standard app does, without any setting to toggle:

1. In the app, on ChatGPT/Claude/…, you click **Continue with Google** (or Apple) as usual.
2. The app catches that — these providers block the embedded engine — and **opens the sign-in in your default system browser**, showing an overlay: *"Sign in in your browser…"*.
3. You sign in there (Google works in a real browser). The app **watches your browser and, the moment it sees that site's session, imports it automatically**, reloads, and you are signed in inside the app. No button to press.

The overlay also offers **J'ai terminé** (import now), **Rouvrir le navigateur**, and **Annuler** in case the automatic detection lags.

It only ever reads cookies for that AI's own domains (for example `claude.ai`, `chatgpt.com`, or `muse.ai` and the Meta domains), never your Google or Apple account, and nothing leaves your machine. For Claude and ChatGPT it waits for the actual session cookie, so anti-bot cookies set while signed out never trigger a false "signed in".

> **macOS needs Full Disk Access.** macOS (TCC) blocks apps from reading browser cookie stores — Firefox included — until you grant Full Disk Access. The login overlay detects this and shows a button that opens **System Settings → Privacy & Security → Full Disk Access**; enable **AI Control Center** there, relaunch if macOS asks, and the import works. Without it, the app sees `EPERM` on every browser. A full `login-diagnostic.txt` is written to the data folder (Réglages → Fichiers) if anything still fails.

Browsers are auto-detected:

| Browser | Platforms | Notes |
|---|---|---|
| Firefox / LibreWolf | Linux, macOS, Windows | native, Flatpak, Snap, and `~/.config/mozilla` layouts |
| Safari | macOS | reads `Cookies.binarycookies` |
| Chrome / Chromium / Brave / Edge / Vivaldi | Linux, macOS | best effort: cookies are encrypted, so this needs the system keyring (GNOME Keyring / KWallet on Linux, the Keychain on macOS, which prompts once) |

Email/password and Microsoft sign-in still work embedded, directly in the app; only the providers that block embedded login are handed off to the browser.

### Updates

At launch the app checks the project's GitHub releases for a newer version. If there is one, it asks whether to install it (**Mettre à jour** / **Plus tard**):

- **Linux (AppImage):** it downloads the new AppImage, swaps it in place and restarts — fully automatic. This needs the app to run as an AppImage (so it knows its own path); a `makepkg` install updates through `pacman` instead.
- **Windows:** it downloads the new installer and runs it; the installer closes the app, updates in place and relaunches — fully automatic (SmartScreen may warn once if the build is unsigned).
- **macOS:** it downloads the dmg and runs a small installer script that waits for the app to quit, swaps the new `AI Control Center.app` into `/Applications`, removes the Gatekeeper quarantine flag (`xattr -dr com.apple.quarantine`) so it opens without a warning, and relaunches. If it can't write to `/Applications`, it falls back to opening the dmg for a manual drag. (With a signed + notarized build the quarantine step is unnecessary; the script still runs it harmlessly.)

**Réglages → Mises à jour** has a manual **Vérifier maintenant** button and a toggle to turn the launch-time check off.

---

## 7. Adding an AI

The easy way is **Réglages → Intelligences artificielles → Add an AI**, which takes effect immediately (no restart):

- **Nouvelle instance** duplicates an existing AI into a second entry with its own session — e.g. a work Claude and a personal Claude, each signed in to a different account.
- **Service personnalisé** adds any web app by name + URL: a self-hosted **OpenWebUI** or **openclaw** instance, **LibreChat**, Le Chat, Perplexity, etc. It gets a generic adapter, its own persistent session, notifications and the full UI; sign in with Google/Apple works just like the built-in AIs.

Added AIs are written to `ais.json`, so they survive restarts, and can be renamed, recoloured, reordered, hidden or deleted from the settings. Each instance has its own cookie store (`persist:ai-<id>`), so logins never mix.

For finer control you can still edit `~/.config/ai-control-center/ais.json` (Réglages → Fichiers) directly, then restart:

```json
{
  "ais": [
    { "id": "muse", "name": "Muse", "url": "https://muse.ai", "icon": "muse.svg", "accent": "#0064E0", "adapter": "muse",
      "allowedDomains": ["muse.ai", "meta.ai", "meta.com", "facebook.com", "instagram.com"] },
    { "id": "mistral", "name": "Le Chat", "url": "https://chat.mistral.ai", "icon": "lechat.png", "accent": "#FA500F",
      "allowedDomains": ["mistral.ai"] }
  ]
}
```

| Field | |
|---|---|
| `id` | unique id: lowercase letters, digits and dashes; it also names the session (`persist:ai-<id>`) |
| `name`, `url` | display name, home page |
| `icon` | SVG/PNG file, looked up next to `ais.json` and then among the built-in icons; if missing, a monogram is drawn. Put a `.png` with the same name next to an `.svg` for the notification icon |
| `accent` | the AI's colour: UI glow and skin tint |
| `allowedDomains` | domains (and subdomains) that stay in the app; anything else opens in your browser. Google, Apple, Microsoft, OpenAI, Meta and Cloudflare sign-in pages are always allowed |
| `adapter` | `claude`, `chatgpt`, `muse`, or nothing (generic adapter) |
| `userAgent` | optional, to force a user agent |
| `enabled` | `false` removes the AI without deleting its entry (to just hide it, use the settings) |

An AI without a dedicated adapter still gets its own web notifications, a persistent session and the full UI.

---

## 8. Notifications: how they work, how to fix them

You get a notification when an AI **is done** or **is waiting for you**: a question at the end of the answer, an approval or confirmation request, or choices offered by Muse. This only happens when the app is not focused or that AI is not the active view. The notification body is the AI's answer. A click opens the app on the right AI and conversation.

Two sources are merged into **one notification per answer**:

1. **The sites' own notifications.** They are granted the permission, and their `Notification` API (and service workers' `showNotification`) is relayed to native notifications. The click is replayed in the site, which opens the right conversation itself.
2. **DOM adapters** (`src/adapters/<ai>.ts`). A script watches the page with a MutationObserver:
   - **generating**: a stop button or a streaming flag is present. If no selector matches, the adapter falls back on a universal hint: the last message keeps growing;
   - **done**: these signals have been gone for 1.5 s (agents pause between tool calls);
   - **needs you**: approval buttons, answer choices in the message, or a last sentence ending with "?".

The hub (`src/main/notifications.ts`) groups events that arrive within 1.5 s of each other. "Needs you" wins over "done", and duplicates are ignored until a new generation starts.

### When a site changes its interface

Each adapter is a plain file of **CSS selectors**, ordered from primary to fallbacks. When they stop matching, the app says so in the terminal (messages are in French):

```
[adapter:claude] generating : sélecteur principal introuvable, repli n°2 utilisé (claude)
[adapter:chatgpt] zone de saisie non reconnue — sélecteurs essayés : … mettez à jour src/adapters/chatgpt.ts
[adapter:muse] génération détectée par la croissance du texte (aucun sélecteur "generating" ne correspond) — muse
```

To fix it:

1. Run `AICC_DEBUG=1 npm run dev`. Every hub decision is printed, such as `adapter generating`, `notify done…` or `skip (being viewed)`.
2. Open the view's developer tools (F12), find the new stop button or message container, and put its selector **first** in the matching list in `src/adapters/<ai>.ts`.
3. Restart the app. The **Tester** button in the settings checks that the notification itself shows up.

> Muse's "generating" selectors could not be observed during a real answer. Until then, the text-growth fallback takes over. If the log says so, add Muse's stop-button selector at the top of `generating` in `src/adapters/muse.ts`.

---

## 9. Site skins

Each site gets an injected stylesheet (`src/skins/<ai>.css`) that reuses the **site's own colour variables**: backgrounds, surfaces, sidebar, composer. Every tone is mixed from the AI's `accent`, which gives a warm Claude, a blue Muse and a near-black ChatGPT. On top of that come a very light **glass glow**, a **frosted composer** and tinted message bubbles. Text is never touched. If a site renames its variables, the skin simply stops applying and nothing breaks.

For your own tweaks, create `~/.config/ai-control-center/skins/<id>.css`. It is appended after the built-in skin and **reloaded on save**:

```css
html { --aicc-glow-opacity: 0.35 !important; }      /* glow strength (0.22 by default) */
```

The tint strength is set in the settings (Appearance → Teinte des surfaces). Skins can be turned off per AI in the settings, or globally with `AICC_SKINS=0`.

---

## 10. Troubleshooting

**Google says "This browser or app may not be secure".** Google rejects embedded browsers. On its sign-in pages only, the app presents itself as Firefox (headers and `navigator`); it stays Chrome everywhere else. If the block persists (it is most stubborn on macOS), use **[Signing in with your browser](#signing-in-with-your-browser)** instead: sign in in your real browser and import the session. If the embedded workaround breaks after a Google change, check that `accounts.google.com` is still in `GOOGLE_AUTH_HOSTS` (`src/shared/protocol.ts`).

**Opening the app from the menu does nothing.** Another instance is already running, possibly a `npm run dev` one hidden in the tray. The new one brings it forward and exits. Quit it (tray → Quitter) first.

**The AppImage does not start (FUSE).** Install `fuse2`, or run it with `--appimage-extract-and-run`.

**`'--ozone-platform=wayland' is not compatible with Vulkan`** at startup: a harmless Chromium message; rendering goes through OpenGL.

**Forcing X11 under Wayland:**
- in dev: `npx electron-vite build && npx electron . --ozone-platform=x11`;
- Arch package: add the line `--ozone-platform=x11` to `~/.config/ai-control-center-flags.conf`;
- AppImage: `./AI-Control-Center-*.AppImage --ozone-platform=x11`.

**A notification does not arrive.** Click **Tester** in the settings. If the test notification shows up, detection is the problem: see [§8](#when-a-site-changes-its-interface). Otherwise check the desktop notification service (`libnotify`) and, on macOS, the permission in System Settings → Notifications.

**Microphone (voice mode) denied on macOS:** System Settings → Privacy & Security → Microphone → allow AI Control Center.

---

## 11. Project layout

```
config/ais.default.json      default AIs (copied into ais.json on first launch)
resources/                   AI, app and tray icons (macOS template + badge variants)
build/                       1024 px icon and macOS entitlements (electron-builder)
packaging/arch/              PKGBUILD, launcher, .desktop entry
.github/workflows/           release builds (AppImage + dmg)
src/
  main/                      main process
    index.ts                 startup, window, IPC, settings, lifecycle
    window.ts  glass.ts      native window, glass mode detection
    views.ts                 one WebContentsView per AI, switching, history, zoom
    sessions.ts              persistent partitions, user agent, permissions, Firefox identity for Google
    navigation.ts            allowed domains, OAuth popups, external links
    notifications.ts         hub: dedup, badges, do not disturb, click → right AI
    browser-cookies.ts       read the user's browser cookies (Firefox/Chromium/Safari) for an AI
    updater.ts               check GitHub releases, download + swap the AppImage, relaunch
    skins.ts                 CSS skin injection
    startup.ts               launch at login, global shortcut
    tray.ts  menu.ts  shortcuts.ts  store.ts  config.ts  paths.ts
  preload/
    shell.ts                 narrow bridge for the app UI
    site.ts                  in each AI: web notification relay + adapter
  adapters/                  one selector file per AI + detection engine (runtime.ts)
  skins/                     CSS skins: shared palette + one file per AI
  renderer/                  app UI (rail, toolbar, settings), framework-free TypeScript
  shared/protocol.ts         shared types and IPC channels
```

Stack: **Electron 44**, electron-vite, TypeScript and zod. Electron was chosen because Chromium handles OAuth and Cloudflare sign-ins reliably, gives one engine on Linux and macOS, and supports native vibrancy.

### Credits

The window design is inspired by [muse-desktop](https://github.com/robzilla1738/muse-desktop) (MIT license): integrated title bar, persistent rail, vibrancy on macOS, close to tray. No code was taken from it; this project has a different architecture, built on web views rather than a CLI client.

Muse, Claude and ChatGPT are trademarks of their respective owners. This project is independent and not affiliated with any of them.

## License

MIT, see [LICENSE](LICENSE).

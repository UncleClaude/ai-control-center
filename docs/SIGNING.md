# Signing AI Control Center

The release builds are **unsigned by default**. That works, but the OS warns the first time:

- **macOS** — Gatekeeper blocks it ("app is damaged / from an unidentified developer"); you right-click → Open, or run `xattr -dr com.apple.quarantine …`.
- **Windows** — SmartScreen shows "Windows protected your PC"; you click **More info → Run anyway**.

Signing removes those warnings. The release workflow (`.github/workflows/release.yml`) **signs automatically when the right secrets exist** — you never touch the code, you just add secrets to the repo. This guide shows how to get them.

- [macOS — Developer ID + notarization](#macos) ← the fully supported path
- [Windows — optional](#windows)
- [How the workflow decides](#how-it-works)

---

<a id="macos"></a>
## macOS — Developer ID signing + notarization

Result: the `.dmg` opens on any Mac with **no warning and no command**. This is the one you asked for.

### What you need

- An **Apple Developer Program** membership — **99 USD / year** ([developer.apple.com/programs](https://developer.apple.com/programs/)). A free Apple ID is **not** enough: only paid members can create a *Developer ID* certificate.
- A **Mac** to create and export the certificate (one-time). The CI itself runs on GitHub's macOS runners.

### Step 1 — Create a *Developer ID Application* certificate

**Easiest (Xcode):** Xcode → **Settings → Accounts** → add your Apple ID → select the team → **Manage Certificates…** → the **+** button → **Developer ID Application**. It lands in your login keychain.

**Without Xcode (web + Keychain Access):**

1. **Keychain Access** → menu **Certificate Assistant → Request a Certificate From a Certificate Authority**. Enter your email, pick **Saved to disk**, save `CertificateSigningRequest.certSigningRequest`.
2. Go to [developer.apple.com/account → Certificates](https://developer.apple.com/account/resources/certificates/list) → **+** → **Developer ID Application** → upload the CSR → **Download** the `.cer`.
3. Double-click the `.cer` to add it to your **login** keychain.

> It must be **Developer ID Application** — not "Apple Development" or "Apple Distribution". Those are for the App Store / testing and notarization will reject them.

### Step 2 — Export it as a `.p12`

In **Keychain Access** → **login** keychain → **My Certificates**, find:

```
Developer ID Application: Your Name (ABCDE12345)
```

Click the ▸ triangle to confirm it has a **private key** underneath. Right-click the certificate → **Export "Developer ID Application…"** → file format **Personal Information Exchange (.p12)** → choose a **strong password** and remember it (it becomes `MAC_CSC_KEY_PASSWORD`). Save as `DeveloperID.p12`.

### Step 3 — Base64-encode the `.p12`

GitHub secrets hold text, so encode the file:

```bash
# macOS — copies the result straight to the clipboard
base64 -i DeveloperID.p12 | pbcopy
# Linux
base64 -w0 DeveloperID.p12
```

That single-line string is `MAC_CSC_LINK`.

### Step 4 — Find your Team ID

[developer.apple.com/account](https://developer.apple.com/account) → **Membership details** → **Team ID** (10 characters, e.g. `ABCDE12345`). This is `APPLE_TEAM_ID`.

### Step 5 — Create an app-specific password (for notarization)

Notarization uploads the app to Apple. Authenticate with an **app-specific password**, not your real one:

1. [appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security → App-Specific Passwords** → **+**.
2. Name it `aicc-notarize`, copy the `xxxx-xxxx-xxxx-xxxx` value.

Use the **same Apple ID that belongs to the developer team**. The email is `APPLE_ID`, the generated value is `APPLE_APP_SPECIFIC_PASSWORD`.

### Step 6 — Add the five repository secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**. Add exactly these names:

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | the base64 string from step 3 |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` password from step 2 |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password from step 5 |
| `APPLE_TEAM_ID` | the Team ID from step 4 |

### Step 7 — Release

No code change. Cut a release as usual:

```bash
npm version patch         # bumps package.json and creates the v* tag
git push --follow-tags
```

The macOS job detects `MAC_CSC_LINK`, imports the certificate, builds with the hardened runtime, **signs**, **notarizes**, and **staples** the ticket to the dmg.

### Step 8 — Verify (on a Mac)

Download the dmg from the release, mount it, drag the app to `/Applications`, then:

```bash
# Gatekeeper verdict — want "accepted" + "source=Notarized Developer ID"
spctl -a -vvv -t install "/Applications/AI Control Center.app"

# Signature — Authority should be "Developer ID Application: … (TEAMID)"
codesign -dv --verbose=4 "/Applications/AI Control Center.app"

# Stapled notarization ticket on the dmg
stapler validate "AI-Control-Center-<version>-arm64.dmg"
```

The app should now open on a double-click, no right-click, no `xattr`.

### Troubleshooting

- **Notarization fails** — read the real reason:
  ```bash
  xcrun notarytool history --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD"
  xcrun notarytool log <submission-id> --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD"
  ```
- **"The binary is not signed with a valid Developer ID"** — wrong certificate type (see the note in step 1).
- **"You must first sign the relevant contracts"** — accept the pending agreements in App Store Connect / the developer portal, then retry.
- **The `.p12` has no private key** — you exported from *Certificates* instead of *My Certificates*; redo step 2.
- **Alternative to the Apple ID password** — an App Store Connect API key is more robust for CI. Create one (App Store Connect → Users and Access → Integrations → Keys), then replace the three `APPLE_*` env vars in the workflow with `APPLE_API_KEY` (path to the `.p8`, or its base64), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`.

---

<a id="windows"></a>
## Windows — optional

The Windows installer is an **unsigned NSIS** build. SmartScreen warns once (**More info → Run anyway**); this is normal for indie apps and perfectly usable. Signing it is harder and costlier than macOS — decide if it's worth it:

- A publicly-trusted **code-signing certificate** costs ~**200 USD+/year** (OV) from a CA (DigiCert, Sectigo, SSL.com…).
- **Since June 2023**, OV/EV signing keys must live on **FIPS hardware** (a USB token) or a **cloud HSM**. A plain `.p12` in CI generally **no longer works** for publicly-trusted certs, so classic `CSC_LINK` signing is mostly for internal/enterprise or legacy certificates.
- **CI-friendly modern option:** [**Azure Trusted Signing**](https://learn.microsoft.com/azure/trusted-signing/) (~**10 USD/month**). It signs from the cloud, works in GitHub Actions, and is the recommended route for a hobby/indie app that wants real Windows signing. It needs extra workflow wiring (the Azure signing action) beyond this repo's current setup.
- **Reputation:** even a valid **OV** signature doesn't instantly silence SmartScreen — trust builds up over downloads. **EV** certificates get immediate reputation but cost more and always require hardware.

**If you already have a usable `.p12`** (internal/enterprise or a legacy cert that still works as a file), the workflow already supports it: add two secrets and the Windows job signs the installer automatically.

| Secret | Value |
|---|---|
| `WIN_CSC_LINK` | the base64 of your `.p12` (`base64 -w0 cert.p12`) |
| `WIN_CSC_KEY_PASSWORD` | the `.p12` password |

Otherwise, shipping unsigned (with the one-time SmartScreen prompt) is a completely reasonable choice.

---

<a id="how-it-works"></a>
## How the workflow decides

In `.github/workflows/release.yml`, the *Package* step branches on the secrets, so **nothing signs by accident**:

- **macOS + `MAC_CSC_LINK` set** → import the cert, `CSC_IDENTITY_AUTO_DISCOVERY=true`, sign with `-c.mac.identity="Developer ID Application"` and `-c.mac.notarize=true`.
- **macOS, no cert** → `CSC_IDENTITY_AUTO_DISCOVERY=false`, unsigned (the config keeps `identity: null`).
- **Windows + `WIN_CSC_LINK` set** → export `CSC_LINK` and sign the installer.
- **Everything else** → a plain, unsigned build.

The secrets are deliberately named `MAC_*` / `WIN_*` (not `CSC_*`): an empty or missing secret is then just an empty variable electron-builder never sees as "please sign", which is what caused an earlier failed build.

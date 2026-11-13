# Signing the Windows installer (optional)

The release builds are **unsigned**, and that is the intended setup — no paid developer account, no yearly fee.

- **macOS** — the dmg is unsigned. On first launch Gatekeeper warns once; you right-click → **Open**, or run `xattr -dr com.apple.quarantine "/Applications/AI Control Center.app"`. The auto-updater clears that flag for you, so after the first manual open updates are seamless. There is nothing to configure.
- **Windows** — the NSIS installer is unsigned. SmartScreen shows "Windows protected your PC" the first time; you click **More info → Run anyway**. This is normal for indie apps and perfectly usable.

That is all most people need. The rest of this page is only for the rare case where you *do* have a usable Windows code-signing certificate.

---

<a id="windows"></a>
## Windows — if you have a certificate

Signing the Windows installer removes the SmartScreen prompt, but it is costly and, these days, non-trivial:

- A publicly-trusted **code-signing certificate** costs ~**200 USD+/year** (OV) from a CA (DigiCert, Sectigo, SSL.com…).
- **Since June 2023**, OV/EV signing keys must live on **FIPS hardware** (a USB token) or a **cloud HSM**. A plain `.p12` in CI generally **no longer works** for publicly-trusted certs, so the classic file-based signing below is mostly for internal/enterprise or legacy certificates.
- **CI-friendly modern option:** [**Azure Trusted Signing**](https://learn.microsoft.com/azure/trusted-signing/) (~**10 USD/month**). It signs from the cloud and works in GitHub Actions, but needs extra workflow wiring (the Azure signing action) beyond this repo's current setup.
- **Reputation:** even a valid **OV** signature doesn't instantly silence SmartScreen — trust builds up over downloads. **EV** certificates get immediate reputation but cost more and always require hardware.

**If you already have a usable `.p12`** (internal/enterprise or a legacy cert that still works as a file), the release workflow already supports it: add two repository secrets (Settings → Secrets and variables → Actions) and the Windows job signs the installer automatically.

| Secret | Value |
|---|---|
| `WIN_CSC_LINK` | the base64 of your `.p12` (`base64 -w0 cert.p12`) |
| `WIN_CSC_KEY_PASSWORD` | the `.p12` password |

Otherwise, shipping unsigned (with the one-time SmartScreen prompt) is a completely reasonable choice.

---

## How the workflow decides

In `.github/workflows/release.yml`, the *Package* step branches on the secrets, so **nothing signs by accident**:

- **macOS** → always built unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`, `identity: null` in config).
- **Windows + `WIN_CSC_LINK` set** → export `CSC_LINK` and sign the installer.
- **Everything else** → a plain, unsigned build.

The secret is deliberately named `WIN_*` (not `CSC_*`): an empty or missing secret is then just an empty variable electron-builder never reads as "please sign".

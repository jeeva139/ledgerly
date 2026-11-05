# Deploying and hosting Ledgerly

Ledgerly is a **desktop application**, not a website, so "deploying" it means **building a Windows installer and
giving people a way to download it**. There is no server to run and no database to host: every user's data stays on their
own computer. GitHub is used for three things:

| GitHub feature | Used for |
|---|---|
| **Repository** | Source code, issues, history. |
| **Releases** | Hosting the downloadable `Ledgerly-Setup.exe` / `Ledgerly.exe`. |
| **Actions** | Automatically testing every change and building each release. |
| **Pages** *(optional)* | A public landing page with a Download button. |

Do **not** commit the `.exe` files to the repository (they are ~100 MB each and Git rejects files over 100 MB).
Attach them to a Release instead.

---

## 1. Build the installer on your own PC

Requirements: Windows 10/11 x64, Node.js 20 or newer, npm, an internet connection **for the build only**
(it downloads Electron and the installer tools once; the finished app never uses the network).

```
npm install
npm run package
```

Output, in `release\`:

| File | Purpose |
|---|---|
| `Ledgerly-Setup.exe` | Installer (choose a folder, shortcuts, uninstall entry). Installs per-user — no administrator rights needed. |
| `Ledgerly.exe` | Portable build — runs from any folder without installing. |

To test quickly without building installers: `npm run build` then `npm start`.

Before you release, run the checks:

```
npm run typecheck
npm test
node scripts/audit-network.mjs
```

## 2. Code signing (recommended)

The builds are **unsigned** unless you provide a certificate. Windows Smart App Control, SmartScreen or a company
"Application Control" policy may warn about or **block unsigned programs** (this happened on the development PC).
Signing with a trusted code-signing certificate is the real fix.

1. Obtain a code-signing certificate (`.pfx`) from a certificate authority.
2. Locally: set the environment variables, then build.

   ```
   set CSC_LINK=C:\path\to\certificate.pfx
   set CSC_KEY_PASSWORD=your-password
   npm run package
   ```
3. On GitHub: add repository secrets `CSC_LINK` (the `.pfx` file encoded as base64) and `CSC_KEY_PASSWORD`
   (*Settings → Secrets and variables → Actions*). The release workflow picks them up automatically.

Never commit the certificate or its password to the repository.

## 3. Publish a release on GitHub

### Automatic (recommended)

The workflow `.github/workflows/release.yml` builds and publishes for you.

```
# 1. choose the new version (this edits package.json and creates the git tag)
npm version patch        # or: minor / major / 1.2.0

# 2. push the commit and the tag
git push origin main --follow-tags
```

GitHub Actions then runs the type-check, tests and offline audit, builds both executables, writes a `SHA256SUMS.txt`
checksum file and creates a **Release** named after the tag with the files attached. The tag must match the
`version` in `package.json` (for example `v1.0.1`); the workflow stops if they differ.
Progress is visible under the repository's **Actions** tab.

You can also run the workflow by hand (*Actions → Release → Run workflow*): the build is then kept as a downloadable
artifact for 14 days instead of a public release — handy for testing.

### Manual

1. Run `npm run package` on your PC.
2. On GitHub open **Releases → Draft a new release**, create a tag such as `v1.0.1`, drag in
   `release\Ledgerly-Setup.exe` and `release\Ledgerly.exe`, and click **Publish release**.

Your download link is always `https://github.com/jeeva139/ledgerly/releases/latest`.

## 4. Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request: it installs dependencies, type-checks,
runs the test suite (inside Electron's Node, exactly like on your PC) and runs the offline audit. A red ✗ next to a commit
means something broke. Consider protecting `main` (*Settings → Branches → Add rule → Require status checks*) so only
passing changes can be merged.

> The test suite includes performance checks on 75,000–100,000 rows. GitHub's shared runners can be slower than a
> desktop, so if one of those time budgets ever fails only on GitHub, re-run the job or relax that budget.

## 5. Optional: a GitHub Pages landing page

The folder `docs/` contains `index.html`, a small public page with a **Download** button that points at the latest release.

1. In the repository open **Settings → Pages**.
2. *Build and deployment → Source:* **Deploy from a branch**.
3. *Branch:* `main`, *folder:* `/docs`, then **Save**.
4. After a minute the page is live at `https://jeeva139.github.io/ledgerly/`.

The page is static: it only links to GitHub and makes no requests of its own. Ledgerly (the app) still never touches
the network.

## 6. Installing and updating (for users)

- **Install:** download `Ledgerly-Setup.exe` from the Releases page, run it, and launch Ledgerly from the Start menu.
  Or download the portable `Ledgerly.exe` and double-click it.
- **Where the data lives:** `%APPDATA%\Ledgerly` — never inside the program folder.
  Updating or uninstalling does **not** delete it.
- **Update:** download the new installer and run it over the old one. There is deliberately **no auto-update**, because
  Ledgerly never connects to the internet. When the app starts on a newer version it upgrades the database
  automatically and first saves a safety copy into `%APPDATA%\Ledgerly\backups`. Still, **create a backup before
  upgrading** (*Settings → Backup & restore*).
- **Verify a download:** compare its SHA-256 with `SHA256SUMS.txt` from the release:
  `Get-FileHash .\Ledgerly-Setup.exe -Algorithm SHA256`.
- **Uninstall:** *Settings → Apps → Ledgerly → Uninstall*. Your data folder is kept; delete it by hand to remove all data.

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "An Application Control policy has blocked this file", SmartScreen warning, or the exe will not start | The executable is unsigned. Sign it (section 2) or ask your administrator to allow it. |
| `EPERM … directory rename failed, retrying` during `npm run package` | Antivirus is scanning new files. It retries automatically and is harmless. |
| Release workflow fails at "Tag must match package.json version" | Use `npm version …` so the tag and `package.json` agree, then push the tag again. |
| Workflow cannot create the release | *Settings → Actions → General → Workflow permissions* must allow **Read and write**. |
| First start takes long on a managed PC | Security software scanning a freshly installed Electron app; later starts are faster. |

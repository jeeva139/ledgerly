# Ledgerly — Private Personal Finance

An offline Windows desktop application for personal finance. Electron + React + TypeScript + SQLite.
Your financial data never leaves your computer: no cloud, no accounts, no telemetry, no network access.

**Documentation:** [User guide](docs/USER_GUIDE.md) · [Deploying & hosting on GitHub](docs/DEPLOYMENT.md)

## Deploy and host on GitHub (summary)

Ledgerly is a desktop app, so "deploying" means building the Windows installer and publishing it for download.
Full details, code signing and troubleshooting are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

```
npm install && npm run package          # build release/Ledgerly-Setup.exe and release/Ledgerly.exe locally

npm version patch                       # bump version + create tag (e.g. v1.0.1)
git push origin main --follow-tags      # GitHub Actions builds and publishes a Release with the installers
```

| GitHub feature | What it does here |
|---|---|
| **Releases** | Hosts the downloads: `https://github.com/jeeva139/ledgerly/releases/latest` |
| **Actions** | `ci.yml` type-checks, tests and audits every push; `release.yml` builds and publishes on a version tag |
| **Pages** (optional) | *Settings → Pages → `main` / `/docs`* serves the landing page `docs/index.html` |

Do not commit the `.exe` files — attach them to a Release.

## Deliverables

| | |
|---|---|
| Installer | `release/Ledgerly-Setup.exe` (Windows x64, NSIS, per-user) |
| Portable | `release/Ledgerly.exe` |
| Database | Local SQLite (`%APPDATA%\Ledgerly\ledgerly.db`) |
| Document storage | Local vault (`%APPDATA%\Ledgerly\documents\…`) |
| Internet requirement | None |
| Cloud dependency | None |

## Features

Transactions, income/expense/transfer handling, accounts, categories + subcategories, tags · **Category Finder** with keyword
matching across full bank/UPI narrations and saved rules · QIF, CSV and Excel import with preview, column mapping, duplicate
detection, history and undo · recurring-payment and subscription *suggestions* (never auto-confirmed) · budgets · goals ·
net worth · reports and charts · local document vault with offline text extraction · CSV/Excel/QIF export ·
backup/restore (`.ledgerlybackup`) · optional application lock · full data erase.

## Architecture

```
electron/   main process: SQLite (node:sqlite), migrations, services, IPC handlers (zod-validated),
            imports (QIF/CSV/Excel + worker thread), documents vault, backup/restore, security
src/        React renderer (Vite): pages under src/features/*, shared UI kit in src/components
shared/     types and pure logic shared by both sides (matching engine, dates, money, merchant normaliser, API contract)
tests/      vitest suites (run inside Electron's Node)
scripts/    build, test runner, icon generation, QA driver (scripts/qa) and the offline audit
```

Security model: `contextIsolation` on, `nodeIntegration` off, sandboxed renderer, a preload bridge exposing only typed
methods, sender validation on every IPC call, all SQL parameterised, strict CSP, every non-local network request cancelled
(`electron/security/netGuard.ts`), permissions denied, Chromium background networking disabled.

## Development

Requires Windows, Node 20+ and npm. (Toolchain notes: Electron 45 bundles Node 24 whose built-in `node:sqlite` is used, so no
native module or C++ compiler is needed. Vite 6 / Vitest 3 are pinned for Node 20.18 compatibility.)

```
npm install          # also downloads the Electron binary (scripts/setup-electron.mjs)
npm run dev          # Vite + Electron with hot reload
npm run typecheck
npm test             # vitest inside Electron's Node
npm run build        # bundles main, preload, import worker and renderer
npm run package      # builds Ledgerly-Setup.exe and the portable Ledgerly.exe into release/
node scripts/audit-network.mjs   # offline-architecture audit (spec §108)
```

QA scripts (drive the real app over the DevTools protocol against throwaway data folders):
`ELECTRON_RUN_AS_NODE=1 node_modules\electron\dist\electron.exe scripts\qa\<script>.mjs` —
`smoke`, `e2e-core`, `e2e-txn`, `e2e-formats`, `e2e-system`, `perf`, `visual`.

## Code signing

The packaged executables are **unsigned**. Windows Smart App Control / Application Control policies can block unsigned
programs. To sign, set `CSC_LINK` (path or base64 of your `.pfx`) and `CSC_KEY_PASSWORD`, then run `npm run package`.

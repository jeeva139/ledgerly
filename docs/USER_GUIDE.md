# Ledgerly — User Guide

**Ledgerly — Private Personal Finance.** Your financial data stays on your computer. Ledgerly works completely offline:
no account, no cloud, no sync, no telemetry, and it never connects to the internet.

## Install

| File | What it is |
|---|---|
| `Ledgerly-Setup.exe` | Installer. Choose an install folder, get Start-menu and desktop shortcuts. |
| `Ledgerly.exe` | Portable version. Runs without installing; copy it anywhere. |

Both are Windows x64. Your data is **not** inside the program folder: it lives in `%APPDATA%\Ledgerly`
(`C:\Users\<you>\AppData\Roaming\Ledgerly`), so updating or uninstalling Ledgerly never deletes it.

> **Windows security note.** These builds are not code-signed. Windows *Smart App Control* or an *Application Control*
> policy on your PC may block an unsigned program. If that happens, ask your administrator to allow it, or sign the
> executables with your own code-signing certificate (see the README). Ledgerly itself needs no special permissions.

## First launch

Ledgerly starts **empty**. There are no sample transactions, balances, budgets or goals.
The Dashboard shows "No transactions yet" and **Net worth: Not set**. You will see starter *names* only:
categories (Housing, Groceries, Dining …) and four account definitions (Main Checking, Everyday Visa, Rewards Card, Cash),
all with no balance. Rename, add or remove them in **Settings**.

Good first steps: **Settings → Accounts** (rename the starter accounts to yours), then **Import** a statement.

## Importing a statement

Open **Import** (Ctrl+I). Choose **Import QIF**, **Import CSV** or **Import Excel**, or drag the file onto the page.
Nothing is saved until you confirm.

1. **Choose the account** the transactions belong to (or create one).
2. Read the **preview**: transactions detected, income, expenses, potential duplicates, needs review, invalid/skipped.
3. Check the **column mapping** (CSV / Excel). If Ledgerly is unsure, it highlights the column and asks you to confirm — it never guesses silently.
4. If dates could be read two ways (e.g. `03/04/2026`) pick *Day/Month/Year* or *Month/Day/Year*.
5. Click **Import Transactions**. A report shows Inserted, Duplicates skipped, Needs review and Invalid/skipped.

Re-importing the same file is safe: every row that already exists is detected as a duplicate and skipped.
**Import history** lists every import and lets you **Undo** one (it removes only that import's transactions).

### QIF
Supports Bank, Cash and Credit-card sections. Payee → merchant, memo → searchable extra text, `L` category kept,
`L[Account]` becomes a transfer. Positive amounts are income and negative are expenses; for credit-card files that
show charges as positive, switch **Amount sign** to *Reverse* and check the totals in the preview.

### CSV
Bank preamble lines and footer/total rows are skipped. Recognised columns: Date, Description / Narration / Merchant,
Amount, Debit / Withdrawal, Credit / Deposit, Dr/Cr indicator, Category, Account, Balance, Reference.
Amounts such as `1,299.50`, `(250.00)`, `1,23,456.78` and `100 Dr` are understood.

### Excel (.xlsx / .xls)
Pick the sheet, confirm the mapping. Real Excel date cells are read exactly (no time-zone shifts).

## Category Finder

The fastest way to categorise many transactions at once. Open **Category Finder**.

1. **Category** — choose one (or *Create new category…*).
2. **Keywords** — separate with commas, e.g. `Tea, Briyani, Dosa, Dinner, Lunch, Breakfast`.
3. **Search** — Ledgerly searches the full wording of every transaction (merchant and memo), ignoring upper/lower case.
   A keyword can be anywhere, even inside a very long UPI narration (`…LUNCHUPI…`, `TEA-12345`, `Briyani@Restaurant`).
   Tick *Match whole words only* if you don't want "tea" to match "steak".
4. **Preview and select** — each row shows the matched keyword. Use Select all / none / invert and untick any row.
   Rows you categorised by hand are listed but unticked.
5. **Apply** — confirm "Apply Food to N selected transactions?". Only the category changes; amounts, dates, merchants and
   accounts are never touched. Nothing changes before you click Apply.
6. **Save as rules** — optionally save each keyword as a rule (`Tea → Food`) so future imports are categorised automatically.

Manage rules on the **Rules** page: enable/disable, edit, delete, and reorder (the first matching rule wins).
*Bulk recategorize* re-runs your rules over existing transactions, only after you confirm.

## Everyday use

- **Add Entry** (Ctrl+N): expense, income or transfer. Amount and merchant start blank. Attach a receipt (up to 20 MB).
- **Transactions**: search, filter by date/account/category/tag/type, sort, bulk actions, inline category and tags. Transfers are not counted as income or spending.
- **Recurring / Subscriptions**: Ledgerly *suggests* repeating payments from your history. Nothing is confirmed until you choose **Keep** or **Ignore**.
- **Budgets**, **Goals**, **Reports**, **Documents** (local receipt/statement vault).
- **Net worth** is only what you enter in *Settings → Net worth* (assets − liabilities).

Keyboard shortcuts: Ctrl+N new · Ctrl+I import · Ctrl+F search · Ctrl+S save · Ctrl+B backup · Ctrl+R refresh · Ctrl+L lock · Ctrl+1…9 pages · Esc close.

## Backup and restore

**Back up regularly — your data exists only on this computer.**

- **Create:** *Settings → Backup & restore → Create backup*. Produces `Ledgerly_Backup_YYYY-MM-DD.ledgerlybackup`
  containing your database (transactions, rules, categories, accounts, tags, settings) and your document vault.
- **Restore:** *Settings → Backup & restore → Restore backup*, choose a file. Ledgerly validates it first and shows what it contains.
  Restoring **replaces** your current data, so Ledgerly first saves a safety backup of the current data (on by default).
  An invalid or corrupt file is rejected without changing anything, and a failed restore rolls back automatically.

## Erase all data

*Settings → Danger zone → Erase all Ledgerly data.* This permanently deletes transactions, accounts, categories, tags, rules,
budgets, goals, recurring items, subscriptions, documents and imported data. Type `DELETE` exactly to enable the button.
Afterwards Ledgerly looks like a brand-new installation. Earlier backup files are separate and are not deleted.

## Privacy and protection — what is and is not true

- Everything is stored locally (`%APPDATA%\Ledgerly`). Ledgerly makes no network connections.
- The optional **application lock** (Settings → Security) asks for a PIN to open the app. It does **not** encrypt your files;
  Windows account permissions protect the folder. Use disk encryption (BitLocker) if you need encryption at rest.
- Logs contain only event codes and counts — never transaction text, amounts, account numbers or document contents.

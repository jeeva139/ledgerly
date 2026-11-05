import type { Migration } from './index'

/**
 * Additive extensions on top of the base schema:
 *  - transactions: memo (searchable narration), isTransfer, categoryLocked (manual override), reference, importId, receiptDocId
 *  - rules: priority (explicit ordering), matchType, source
 *  - documents: kind, note, extracted (local extraction result as JSON)
 *  - import_history table and the query indexes
 */
export const migration002: Migration = {
  version: 2,
  name: 'extensions: memo, transfers, rule priority, import history, indexes',
  up(db) {
    const cols = (table: string) => new Set(db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name))
    const addColumn = (table: string, name: string, ddl: string) => {
      if (!cols(table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`)
    }

    addColumn('transactions', 'memo', "TEXT NOT NULL DEFAULT ''")
    addColumn('transactions', 'isTransfer', 'INTEGER NOT NULL DEFAULT 0')
    addColumn('transactions', 'categoryLocked', 'INTEGER NOT NULL DEFAULT 0')
    addColumn('transactions', 'reference', "TEXT NOT NULL DEFAULT ''")
    addColumn('transactions', 'importId', 'TEXT')
    addColumn('transactions', 'receiptDocId', 'TEXT')

    addColumn('rules', 'priority', 'INTEGER NOT NULL DEFAULT 0')
    addColumn('rules', 'matchType', "TEXT NOT NULL DEFAULT 'contains'")
    addColumn('rules', 'source', "TEXT NOT NULL DEFAULT 'manual'")

    addColumn('documents', 'kind', "TEXT NOT NULL DEFAULT 'other'")
    addColumn('documents', 'note', "TEXT NOT NULL DEFAULT ''")
    addColumn('documents', 'extracted', 'TEXT')

    db.exec(`
      CREATE TABLE IF NOT EXISTS import_history (
        id          TEXT PRIMARY KEY,
        filename    TEXT NOT NULL,
        format      TEXT NOT NULL,
        account     TEXT NOT NULL DEFAULT '',
        inserted    INTEGER NOT NULL DEFAULT 0,
        duplicates  INTEGER NOT NULL DEFAULT 0,
        skipped     INTEGER NOT NULL DEFAULT 0,
        needsReview INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL DEFAULT 'complete',
        documentId  TEXT,
        createdAt   TEXT NOT NULL,
        undoneAt    TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_txn_date          ON transactions(date);
      CREATE INDEX IF NOT EXISTS idx_txn_category      ON transactions(category);
      CREATE INDEX IF NOT EXISTS idx_txn_account       ON transactions(account);
      CREATE INDEX IF NOT EXISTS idx_txn_type_date     ON transactions(type, date);
      CREATE INDEX IF NOT EXISTS idx_txn_import        ON transactions(importId);
      CREATE INDEX IF NOT EXISTS idx_txn_merchant      ON transactions(merchant COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_txn_transfer_date ON transactions(isTransfer, date);
      CREATE INDEX IF NOT EXISTS idx_rules_priority    ON rules(priority);
      CREATE INDEX IF NOT EXISTS idx_docs_created      ON documents(createdAt);
      CREATE INDEX IF NOT EXISTS idx_import_created    ON import_history(createdAt);
    `)
  }
}

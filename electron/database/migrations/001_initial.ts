import type { Migration } from './index'

/** Base schema exactly as specified. Idempotent (IF NOT EXISTS). */
export const migration001: Migration = {
  version: 1,
  name: 'initial schema',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id          TEXT PRIMARY KEY,
        date        TEXT NOT NULL,
        merchant    TEXT NOT NULL,
        category    TEXT NOT NULL DEFAULT 'Needs review',
        amount      REAL NOT NULL CHECK (amount > 0),
        type        TEXT NOT NULL CHECK (type IN ('expense', 'income')),
        account     TEXT NOT NULL DEFAULT 'Imported account',
        tags        TEXT NOT NULL DEFAULT '[]',
        receipt     INTEGER NOT NULL DEFAULT 0,
        source      TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        createdAt   TEXT NOT NULL,
        updatedAt   TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        name      TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rules (
        id        TEXT PRIMARY KEY,
        whenText  TEXT NOT NULL,
        thenText  TEXT NOT NULL,
        enabled   INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key       TEXT PRIMARY KEY,
        value     TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        id         TEXT PRIMARY KEY,
        filename   TEXT NOT NULL,
        mimeType   TEXT NOT NULL,
        size       INTEGER NOT NULL,
        objectPath TEXT NOT NULL UNIQUE,
        status     TEXT NOT NULL CHECK (status IN ('stored', 'review', 'queued')),
        source     TEXT NOT NULL CHECK (source IN ('upload', 'import')),
        createdAt  TEXT NOT NULL,
        updatedAt  TEXT NOT NULL
      );
    `)
  }
}

import Database from 'better-sqlite3';
import fs from 'node:fs';
import { dataDir, sqlitePath } from './paths.js';

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(sqlitePath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function migrate(): void {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sha256 TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_mtime INTEGER NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 0,
      cover_page INTEGER,
      memo TEXT NOT NULL DEFAULT '',
      is_missing INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      page_no INTEGER NOT NULL,
      entry_name TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      thumb_status TEXT NOT NULL DEFAULT 'none',
      UNIQUE(library_id, page_no)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS library_tags (
      library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      UNIQUE(library_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      target_id INTEGER,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_libraries_file_name ON libraries(file_name);
    CREATE INDEX IF NOT EXISTS idx_libraries_updated_at ON libraries(updated_at);
    CREATE INDEX IF NOT EXISTS idx_libraries_is_missing ON libraries(is_missing);
    CREATE INDEX IF NOT EXISTS idx_pages_library_id ON pages(library_id);
  `);
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

//! Database service - rusqlite wrapper
//!
//! This will replace better-sqlite3 in Phase 1.

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct DatabaseService {
    conn: Mutex<Connection>,
}

impl DatabaseService {
    pub fn new(db_path: PathBuf) -> rusqlite::Result<Self> {
        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn query<T, F>(&self, sql: &str, f: F) -> rusqlite::Result<T>
    where
        F: FnOnce(&rusqlite::Statement) -> rusqlite::Result<T>,
    {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(sql)?;
        f(&mut stmt)
    }

    pub fn execute(&self, sql: &str) -> rusqlite::Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(sql, [])
    }

    pub fn execute_params(&self, sql: &str, params: &[&dyn rusqlite::ToSql]) -> rusqlite::Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(sql, params)
    }
}

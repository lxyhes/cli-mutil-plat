//! Database service - rusqlite wrapper
//!
//! This will replace better-sqlite3 in Phase 1.

use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct DatabaseService {
    conn: Mutex<Connection>,
    db_path: PathBuf,
}

impl DatabaseService {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        Ok(Self { conn: Mutex::new(conn), db_path })
    }

    pub fn prepare<T: rusqlite::ToSql>(&self, sql: &str, params: &[T]) -> rusqlite::Result<rusqlite::Statement> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(sql)?;
        stmt.query(params)?;
        Ok(stmt)
    }

    pub fn execute<T: rusqlite::ToSql>(&self, sql: &str, params: &[T]) -> rusqlite::Result<usize> {
        let conn = self.conn.lock().unwrap();
        conn.execute(sql, params)
    }
}

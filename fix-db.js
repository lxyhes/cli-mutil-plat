/**
 * 数据库修复脚本 - 添加 Prompt Optimizer 表和更新 schema_version
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'SpectrAI', 'claudeops.db');

console.log('Opening database:', dbPath);

function tableExists(db, tableName) {
  const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
  return !!result;
}

try {
  const db = new Database(dbPath);

  // 1. 检查并更新 schema_version
  const currentVersion = db.prepare('SELECT MAX(version) as max_ver FROM schema_version').get();
  console.log('Current schema version:', currentVersion?.max_ver ?? 0);

  // 2. 创建 v41 表
  if (!tableExists(db, 'prompt_templates')) {
    console.log('Creating prompt_templates table...');
    db.exec(`
      CREATE TABLE prompt_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        tags TEXT,
        variables TEXT,
        current_version_id TEXT,
        is_active INTEGER DEFAULT 1,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_prompt_templates_category ON prompt_templates(category);
    `);
    console.log('✓ prompt_templates table created');
  } else {
    console.log('- prompt_templates table already exists');
  }

  if (!tableExists(db, 'prompt_versions')) {
    console.log('Creating prompt_versions table...');
    db.exec(`
      CREATE TABLE prompt_versions (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        content TEXT NOT NULL,
        system_prompt TEXT,
        variables_values TEXT,
        change_notes TEXT,
        score REAL,
        test_count INTEGER DEFAULT 0,
        is_baseline INTEGER DEFAULT 0,
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES prompt_templates(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_prompt_versions_template ON prompt_versions(template_id);
    `);
    console.log('✓ prompt_versions table created');
  } else {
    console.log('- prompt_versions table already exists');
  }

  if (!tableExists(db, 'prompt_tests')) {
    console.log('Creating prompt_tests table...');
    db.exec(`
      CREATE TABLE prompt_tests (
        id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL,
        test_input TEXT NOT NULL,
        test_output TEXT,
        tokens_used INTEGER,
        duration_ms INTEGER,
        score REAL,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (version_id) REFERENCES prompt_versions(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_prompt_tests_version ON prompt_tests(version_id);
    `);
    console.log('✓ prompt_tests table created');
  } else {
    console.log('- prompt_tests table already exists');
  }

  // 3. 创建 v42 表
  if (!tableExists(db, 'prompt_optimization_runs')) {
    console.log('Creating prompt_optimization_runs table...');
    db.exec(`
      CREATE TABLE prompt_optimization_runs (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        target_version_id TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        optimization_strategy TEXT DEFAULT 'auto',
        prompt_before TEXT,
        prompt_after TEXT,
        improvement_score REAL,
        iterations INTEGER DEFAULT 0,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (template_id) REFERENCES prompt_templates(id) ON DELETE CASCADE,
        FOREIGN KEY (target_version_id) REFERENCES prompt_versions(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_prompt_opt_runs_template ON prompt_optimization_runs(template_id);
      CREATE INDEX idx_prompt_opt_runs_status ON prompt_optimization_runs(status);
    `);
    console.log('✓ prompt_optimization_runs table created');
  } else {
    console.log('- prompt_optimization_runs table already exists');
  }

  if (!tableExists(db, 'prompt_feedback')) {
    console.log('Creating prompt_feedback table...');
    db.exec(`
      CREATE TABLE prompt_feedback (
        id TEXT PRIMARY KEY,
        optimization_run_id TEXT NOT NULL,
        criterion TEXT NOT NULL,
        score_before REAL,
        score_after REAL,
        feedback_text TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (optimization_run_id) REFERENCES prompt_optimization_runs(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_prompt_feedback_run ON prompt_feedback(optimization_run_id);
    `);
    console.log('✓ prompt_feedback table created');
  } else {
    console.log('- prompt_feedback table already exists');
  }

  // 4. 更新 schema_version
  const newVersion = 42;
  const existing = db.prepare('SELECT version FROM schema_version WHERE version = ?').get(newVersion);
  if (!existing) {
    db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
      newVersion,
      'create prompt_optimization_runs, prompt_feedback tables'
    );
    console.log(`✓ schema_version updated to ${newVersion}`);
  } else {
    console.log('- schema_version already at 42');
  }

  db.close();
  console.log('\n✅ Database fixed successfully!');
} catch (err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
}

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS brands(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), name TEXT NOT NULL, context TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, brand_id TEXT REFERENCES brands(id), owner TEXT NOT NULL, status TEXT DEFAULT 'DRAFT', category TEXT, provider TEXT, model TEXT, is_mock INTEGER NOT NULL DEFAULT 1, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS query_sets(id TEXT PRIMARY KEY, run_id TEXT REFERENCES runs(id), questions TEXT NOT NULL, prompt_version TEXT NOT NULL, generation TEXT);
CREATE TABLE IF NOT EXISTS responses(id TEXT PRIMARY KEY, run_id TEXT REFERENCES runs(id), query TEXT NOT NULL, kind TEXT NOT NULL, intent TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL, raw_answer TEXT NOT NULL, timestamp TEXT NOT NULL, brand_mentioned INTEGER NOT NULL, mention_position INTEGER, competitors TEXT NOT NULL, citations TEXT NOT NULL, tokens TEXT, latency_ms INTEGER NOT NULL, cost REAL, is_mock INTEGER NOT NULL, web_search INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, run_id TEXT UNIQUE REFERENCES runs(id), metrics TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS contents(id TEXT PRIMARY KEY, report_id TEXT REFERENCES reports(id), channel TEXT, body TEXT, status TEXT DEFAULT 'DRAFT', is_mock INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY, content_id TEXT REFERENCES contents(id), path TEXT, mime TEXT, is_demo INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS publish_tasks(id TEXT PRIMARY KEY, content_id TEXT REFERENCES contents(id), platform TEXT, mode TEXT NOT NULL DEFAULT 'PREPARE_ONLY' CHECK(mode='PREPARE_ONLY'), status TEXT DEFAULT 'DRAFT');
CREATE TABLE IF NOT EXISTS publish_results(id TEXT PRIMARY KEY, task_id TEXT REFERENCES publish_tasks(id), status TEXT, url TEXT, verified_at TEXT);

CREATE TABLE IF NOT EXISTS ai_suggestions(id TEXT PRIMARY KEY, report_id TEXT REFERENCES reports(id), payload TEXT NOT NULL, generation TEXT NOT NULL, evidence_mock INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS content_generations(content_id TEXT PRIMARY KEY REFERENCES contents(id), generation TEXT NOT NULL, query_ids TEXT NOT NULL, evidence_mock INTEGER NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS session_settings(owner TEXT PRIMARY KEY,provider TEXT NOT NULL,model TEXT NOT NULL,base_url TEXT NOT NULL,extra TEXT NOT NULL,updated_at INTEGER NOT NULL);

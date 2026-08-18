import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'homing.db');

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS designs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Untitled design',
  sender_name TEXT NOT NULL DEFAULT '',
  tagline TEXT NOT NULL DEFAULT '',
  accent_color TEXT NOT NULL DEFAULT '#4f46e5',
  logo_data_url TEXT,
  hero_image_data_url TEXT,
  headline_font TEXT NOT NULL DEFAULT 'Inter',
  body_font TEXT NOT NULL DEFAULT 'Inter',
  style_sample TEXT NOT NULL DEFAULT '',
  static_sections TEXT NOT NULL DEFAULT '[]',
  detected_headline TEXT NOT NULL DEFAULT '',
  font_detection_note TEXT NOT NULL DEFAULT '',
  extraction_note TEXT NOT NULL DEFAULT '',
  source_image_data_url TEXT,
  source_image_width INTEGER,
  source_image_height INTEGER,
  source_text_blocks TEXT NOT NULL DEFAULT '[]',
  text_overrides TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  design_id TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  opening TEXT NOT NULL DEFAULT '',
  body_paragraphs TEXT NOT NULL DEFAULT '[]',
  closing TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(design_id, company_name)
);

CREATE INDEX IF NOT EXISTS idx_proposals_design ON proposals(design_id);
`);

// Lightweight migration: add columns introduced after the initial CREATE TABLE
// to any pre-existing designs table (CREATE TABLE IF NOT EXISTS won't do this).
const existingColumns = new Set(db.prepare('PRAGMA table_info(designs)').all().map((c) => c.name));
const newColumns = [
  ['source_image_data_url', 'TEXT'],
  ['source_image_width', 'INTEGER'],
  ['source_image_height', 'INTEGER'],
  ["source_text_blocks", "TEXT NOT NULL DEFAULT '[]'"],
  ["text_overrides", "TEXT NOT NULL DEFAULT '{}'"],
];
for (const [name, def] of newColumns) {
  if (!existingColumns.has(name)) {
    db.exec(`ALTER TABLE designs ADD COLUMN ${name} ${def}`);
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS recipients (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  custom_fields TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recipients_email ON recipients(email);
CREATE INDEX IF NOT EXISTS idx_recipients_company ON recipients(company_name);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  design_id TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  subject_template TEXT NOT NULL DEFAULT 'Proposal for {{company_name}}',
  status TEXT NOT NULL DEFAULT 'draft',
  provider TEXT NOT NULL DEFAULT 'resend',
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  proposal_id TEXT REFERENCES proposals(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  sent_at TEXT,
  opened_at TEXT,
  clicked_at TEXT,
  UNIQUE(campaign_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_recipient ON campaign_recipients(recipient_id);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS email_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_email_events_proposal ON email_events(proposal_id);
CREATE INDEX IF NOT EXISTS idx_email_events_recipient ON email_events(recipient_id);
`);

// ═══════════════════════════════════════════
// BECCA — Personal Intelligence Assistant
// ═══════════════════════════════════════════

db.exec(`
CREATE TABLE IF NOT EXISTS becca_topics (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_becca_topics_workspace ON becca_topics(workspace);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS becca_briefings (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  topic_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uncertain',
  headline TEXT NOT NULL DEFAULT '',
  what_changed TEXT NOT NULL DEFAULT '',
  why_it_matters TEXT NOT NULL DEFAULT '',
  sentiment TEXT NOT NULL DEFAULT 'Neutral',
  source_note TEXT NOT NULL DEFAULT 'Web search',
  source_type TEXT NOT NULL DEFAULT 'secondary',
  diff_old TEXT NOT NULL DEFAULT '',
  diff_new TEXT NOT NULL DEFAULT '',
  urls TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_becca_briefings_workspace ON becca_briefings(workspace);
CREATE INDEX IF NOT EXISTS idx_becca_briefings_topic ON becca_briefings(topic_name);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS becca_reminders (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  text TEXT NOT NULL,
  due TEXT,
  when_raw TEXT NOT NULL DEFAULT '',
  fired INTEGER NOT NULL DEFAULT 0,
  dismissed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_becca_reminders_workspace ON becca_reminders(workspace);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS becca_profile (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  industries TEXT NOT NULL DEFAULT '[]',
  usecases TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace)
);

CREATE TABLE IF NOT EXISTS becca_memory (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS becca_chat_history (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  session_id TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_becca_chat_workspace ON becca_chat_history(workspace);
`);

// Migration: add session_id to existing becca_chat_history
const chatColumns = new Set(db.prepare('PRAGMA table_info(becca_chat_history)').all().map((c) => c.name));
if (!chatColumns.has('session_id')) {
  db.exec(`ALTER TABLE becca_chat_history ADD COLUMN session_id TEXT NOT NULL DEFAULT ''`);
}

db.exec(`CREATE INDEX IF NOT EXISTS idx_becca_chat_session ON becca_chat_history(session_id)`);

// ═══════════════════════════════════════════
// BECCA — Content Pipeline
// ═══════════════════════════════════════════

db.exec(`
CREATE TABLE IF NOT EXISTS becca_posts (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  topic_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  cover_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  published_url TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  seo_score INTEGER NOT NULL DEFAULT 0,
  seo_data TEXT NOT NULL DEFAULT '{}',
  news_sources TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_becca_posts_workspace ON becca_posts(workspace);
CREATE INDEX IF NOT EXISTS idx_becca_posts_status ON becca_posts(status);
CREATE INDEX IF NOT EXISTS idx_becca_posts_topic ON becca_posts(topic_name);
`);

export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return randomUUID();
}

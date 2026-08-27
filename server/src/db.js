import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { mkdirSync, existsSync, createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'homing.db');
mkdirSync(path.dirname(dbPath), { recursive: true });

// ── Free-tier persistence: optional S3/R2 backup ──
// Set R2_BUCKET + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_ENDPOINT (or AWS_*)
// If set, DB file is restored from remote on boot and uploaded every 5 min.
// This keeps the sync `node:sqlite` API with zero refactor.
let s3 = null;
let bucket = process.env.R2_BUCKET || process.env.S3_BUCKET || '';
let r2Endpoint = process.env.R2_ENDPOINT || process.env.S3_ENDPOINT || '';
if (bucket && process.env.R2_ACCESS_KEY_ID) {
  try {
    const { S3Client } = await import('@aws-sdk/client-s3');
    s3 = new S3Client({
      region: process.env.R2_REGION || 'auto',
      endpoint: r2Endpoint || undefined,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      forcePathStyle: !!r2Endpoint,
    });
    // Restore: if local DB missing but remote exists, download it
    if (!existsSync(dbPath)) {
      try {
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: 'homing.db' }));
        if (res.Body) {
          await pipeline(res.Body, createWriteStream(dbPath));
          console.log('[DB] Restored homing.db from R2');
        }
      } catch (e) {
        if (e.Name !== 'NoSuchKey') console.warn('[DB] R2 restore skip:', e.message);
      }
    }
    // Periodic backup every 5 min + on exit
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    async function backup() {
      if (!existsSync(dbPath)) return;
      try {
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: 'homing.db', Body: createReadStream(dbPath) }));
      } catch (e) { console.warn('[DB] R2 backup failed:', e.message); }
    }
    setInterval(backup, 5 * 60 * 1000);
    process.on('SIGTERM', () => { backup().finally(() => process.exit(0)); });
    console.log('[DB] R2 backup enabled →', bucket);
  } catch (e) {
    console.warn('[DB] R2 init failed:', e.message);
  }
}

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
try {
  const existingColumns = new Set(db.prepare('PRAGMA table_info(designs)').all().map((c) => c.name));
  const newColumns = [
    ['source_image_data_url', 'TEXT'],
    ['source_image_width', 'INTEGER'],
    ['source_image_height', 'INTEGER'],
    ["source_text_blocks", "TEXT NOT NULL DEFAULT '[]'"],
    ["text_overrides", "TEXT NOT NULL DEFAULT '{}'"],
    ["pages", "TEXT NOT NULL DEFAULT '[]'"],
    ["page_overrides", "TEXT NOT NULL DEFAULT '{}'"],
    ["source_pdf_path", "TEXT"],
    ["background_color", "TEXT NOT NULL DEFAULT '#ffffff'"],
    ["brand_colors", "TEXT NOT NULL DEFAULT '[]'"],
    ["logo_variations", "TEXT NOT NULL DEFAULT '[]'"],
    ["logo_slots", "TEXT NOT NULL DEFAULT '[]'"],
    ["canvas_json", "TEXT"],
  ];
  for (const [name, def] of newColumns) {
    if (!existingColumns.has(name)) {
      db.exec(`ALTER TABLE designs ADD COLUMN ${name} ${def}`);
    }
  }
} catch (e) {
  console.warn('[DB] Skipping designs migration:', e.message);
}

// Migration: add company_logo to proposals
try {
  const propColumns = new Set(db.prepare('PRAGMA table_info(proposals)').all().map((c) => c.name));
  if (!propColumns.has('company_logo')) {
    db.exec(`ALTER TABLE proposals ADD COLUMN company_logo TEXT`);
  }
} catch (e) {
  console.warn('[DB] Skipping proposals migration:', e.message);
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
  created_at TEXT,
  updated_at TEXT,
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
  website TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '[]',
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
try {
  const chatColumns = new Set(db.prepare('PRAGMA table_info(becca_chat_history)').all().map((c) => c.name));
  if (!chatColumns.has('session_id')) {
    db.exec(`ALTER TABLE becca_chat_history ADD COLUMN session_id TEXT NOT NULL DEFAULT ''`);
  }
} catch (e) {
  console.warn('[DB] Skipping chat_history migration:', e.message);
}

// Migration: add website + links to existing becca_profile
try {
  const profileColumns = new Set(db.prepare('PRAGMA table_info(becca_profile)').all().map((c) => c.name));
  if (!profileColumns.has('website')) {
    db.exec(`ALTER TABLE becca_profile ADD COLUMN website TEXT NOT NULL DEFAULT ''`);
  }
  if (!profileColumns.has('links')) {
    db.exec(`ALTER TABLE becca_profile ADD COLUMN links TEXT NOT NULL DEFAULT '[]'`);
  }

  // Migration: add business profile fields
  const bizFields = [
    ['company_name', "TEXT NOT NULL DEFAULT ''"],
    ['company_description', "TEXT NOT NULL DEFAULT ''"],
    ['company_size', "TEXT NOT NULL DEFAULT ''"],
    ['key_products', "TEXT NOT NULL DEFAULT '[]'"],
    ['competitors', "TEXT NOT NULL DEFAULT '[]'"],
    ['target_market', "TEXT NOT NULL DEFAULT ''"],
    ['value_proposition', "TEXT NOT NULL DEFAULT ''"],
    ['knowledge_base', "TEXT NOT NULL DEFAULT '[]'"],
  ];
  for (const [name, def] of bizFields) {
    if (!profileColumns.has(name)) {
      db.exec(`ALTER TABLE becca_profile ADD COLUMN ${name} ${def}`);
    }
  }
} catch (e) {
  console.warn('[DB] Skipping profile migration:', e.message);
}

// Knowledge base documents table
db.exec(`
CREATE TABLE IF NOT EXISTS becca_knowledge_docs (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  filename TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  doc_type TEXT NOT NULL DEFAULT 'text',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_becca_knowledge_workspace ON becca_knowledge_docs(workspace);
`);

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

// ═══════════════════════════════════════════
// BECCA — Watchlist v2, Daily Briefs, Blog Drafts
// ═══════════════════════════════════════════

// Migrate becca_topics: add new columns for watchlist features
try {
  const topicCols = new Set(db.prepare('PRAGMA table_info(becca_topics)').all().map(c => c.name));
  const topicMigrations = [
    ['normalized_topic', 'TEXT NOT NULL DEFAULT ""'],
    ['status', "TEXT NOT NULL DEFAULT 'active'"],
    ['blog_generation_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_briefed_at', 'TEXT'],
    ['last_blog_generated_at', 'TEXT'],
    ['last_fetch_status', "TEXT NOT NULL DEFAULT 'pending'"],
    ['last_fetch_error', 'TEXT'],
    ['consecutive_fetch_failures', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [name, def] of topicMigrations) {
    if (!topicCols.has(name)) {
      db.exec(`ALTER TABLE becca_topics ADD COLUMN ${name} ${def}`);
    }
  }
  // Backfill normalized_topic for existing rows
  db.exec(`UPDATE becca_topics SET normalized_topic = LOWER(TRIM(name)) WHERE normalized_topic = ''`);
} catch (e) {
  console.warn('[DB] Skipping topics migration:', e.message);
}

// Recreate becca_briefings with new schema (old schema had 0 rows)
db.exec(`DROP TABLE IF EXISTS becca_briefings`);
db.exec(`
CREATE TABLE IF NOT EXISTS becca_briefings (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  topics_included TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  topics_skipped TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_becca_briefings_workspace ON becca_briefings(workspace);
`);

// Blog drafts table
db.exec(`
CREATE TABLE IF NOT EXISTS becca_blog_drafts (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  watchlist_item_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  meta_description TEXT NOT NULL DEFAULT '',
  target_keyword TEXT NOT NULL DEFAULT '',
  headers TEXT NOT NULL DEFAULT '[]',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_becca_blog_drafts_workspace ON becca_blog_drafts(workspace);
CREATE INDEX IF NOT EXISTS idx_becca_blog_drafts_topic ON becca_blog_drafts(watchlist_item_id);
CREATE INDEX IF NOT EXISTS idx_becca_blog_drafts_status ON becca_blog_drafts(status);
`);

// ── Migrations that depend on tables created above ──
// Wrapped in try/catch so a missing table never crashes the server.
try {
  const crColumns = new Set(db.prepare('PRAGMA table_info(campaign_recipients)').all().map((c) => c.name));
  const crNewColumns = [
    ['created_at', 'TEXT'],
    ['updated_at', 'TEXT'],
  ];
  for (const [name, def] of crNewColumns) {
    if (!crColumns.has(name)) {
      db.exec(`ALTER TABLE campaign_recipients ADD COLUMN ${name} ${def}`);
    }
  }
} catch (e) {
  console.warn('[DB] Skipping campaign_recipients migration:', e.message);
}

// ── Social Listening tables ──
db.exec(`
CREATE TABLE IF NOT EXISTS social_mentions (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  topic_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  author_url TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  sentiment TEXT DEFAULT NULL,
  sentiment_score REAL DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_mentions_workspace ON social_mentions(workspace);
CREATE INDEX IF NOT EXISTS idx_social_mentions_topic ON social_mentions(topic_id);
CREATE INDEX IF NOT EXISTS idx_social_mentions_platform ON social_mentions(platform);
CREATE INDEX IF NOT EXISTS idx_social_mentions_fetched ON social_mentions(fetched_at);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS social_trends (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  topic_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  date TEXT NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 0,
  sentiment_avg REAL DEFAULT NULL,
  UNIQUE(workspace, topic_id, platform, date)
);
CREATE INDEX IF NOT EXISTS idx_social_trends_topic ON social_trends(topic_id);
`);

// Add platforms column to becca_topics
try {
  const cols = new Set(db.prepare('PRAGMA table_info(becca_topics)').all().map((c) => c.name));
  if (!cols.has('platforms')) {
    db.exec(`ALTER TABLE becca_topics ADD COLUMN platforms TEXT NOT NULL DEFAULT '["google_news"]'`);
  }
} catch (e) {
  console.warn('[DB] Skipping becca_topics platforms migration:', e.message);
}

// Buffer autopilot — tracks posts scheduled through Buffer
db.exec(`
CREATE TABLE IF NOT EXISTS buffer_scheduled_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buffer_post_id TEXT,
  proposal_id TEXT,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  scheduled_at TEXT,
  created_at TEXT NOT NULL
);
`);

try {
  const bufferColumns = new Set(db.prepare('PRAGMA table_info(buffer_scheduled_posts)').all().map((c) => c.name));
  if (!bufferColumns.has('image_url')) {
    db.exec(`ALTER TABLE buffer_scheduled_posts ADD COLUMN image_url TEXT`);
  }
} catch (e) {
  console.warn('[DB] Skipping buffer_scheduled_posts migration:', e.message);
}

// Composited social-post images (client-side template renders) — stored as
// base64 so Buffer has a stable URL to fetch at send time, since Render's
// filesystem is ephemeral between requests.
db.exec(`
CREATE TABLE IF NOT EXISTS social_assets (
  id TEXT PRIMARY KEY,
  data_base64 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return randomUUID();
}

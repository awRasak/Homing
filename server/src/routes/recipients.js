import { Router } from 'express';
import { parse } from 'csv-parse/sync';
import { db, nowIso, newId } from '../db.js';

const router = Router();

function serializeRecipient(row) {
  if (!row) return null;
  return {
    ...row,
    companyName: row.company_name,
    firstName: row.first_name,
    lastName: row.last_name,
    customFields: JSON.parse(row.custom_fields || '{}'),
    tags: JSON.parse(row.tags || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/recipients
router.get('/', (req, res) => {
  const { search, tag, company } = req.query;
  let sql = 'SELECT * FROM recipients';
  const conditions = [];
  const values = [];

  if (search) {
    conditions.push('(email LIKE ? OR company_name LIKE ? OR first_name LIKE ? OR last_name LIKE ?)');
    const like = `%${search}%`;
    values.push(like, like, like, like);
  }
  if (tag) {
    conditions.push('tags LIKE ?');
    values.push(`%"${tag}"%`);
  }
  if (company) {
    conditions.push('company_name = ?');
    values.push(company);
  }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...values);
  res.json(rows.map(serializeRecipient));
});

// GET /api/recipients/tags — list all unique tags
router.get('/tags', (req, res) => {
  const rows = db.prepare('SELECT tags FROM recipients').all();
  const tagSet = new Set();
  for (const row of rows) {
    const tags = JSON.parse(row.tags || '[]');
    for (const t of tags) tagSet.add(t);
  }
  res.json([...tagSet].sort());
});

// GET /api/recipients/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM recipients WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Recipient not found' });
  res.json(serializeRecipient(row));
});

// POST /api/recipients
router.post('/', (req, res) => {
  const { email, companyName, firstName, lastName, customFields, tags } = req.body;
  if (!email || !email.trim()) return res.status(400).json({ error: 'Email is required' });

  const existing = db.prepare('SELECT id FROM recipients WHERE email = ?').get(email.trim().toLowerCase());
  if (existing) return res.status(409).json({ error: 'A recipient with this email already exists', id: existing.id });

  const id = newId();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO recipients (id, email, company_name, first_name, last_name, custom_fields, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    email.trim().toLowerCase(),
    (companyName || '').trim(),
    (firstName || '').trim(),
    (lastName || '').trim(),
    JSON.stringify(customFields || {}),
    JSON.stringify(tags || []),
    ts,
    ts,
  );
  const row = db.prepare('SELECT * FROM recipients WHERE id = ?').get(id);
  res.status(201).json(serializeRecipient(row));
});

// PUT /api/recipients/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM recipients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Recipient not found' });

  const { email, companyName, firstName, lastName, customFields, tags } = req.body;
  if (email && email.trim().toLowerCase() !== existing.email) {
    const dupe = db.prepare('SELECT id FROM recipients WHERE email = ? AND id != ?').get(email.trim().toLowerCase(), req.params.id);
    if (dupe) return res.status(409).json({ error: 'Another recipient already uses this email' });
  }

  const ts = nowIso();
  db.prepare(
    `UPDATE recipients SET
      email = ?, company_name = ?, first_name = ?, last_name = ?,
      custom_fields = ?, tags = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    (email || existing.email).trim().toLowerCase(),
    companyName !== undefined ? companyName.trim() : existing.company_name,
    firstName !== undefined ? firstName.trim() : existing.first_name,
    lastName !== undefined ? lastName.trim() : existing.last_name,
    customFields !== undefined ? JSON.stringify(customFields) : existing.custom_fields,
    tags !== undefined ? JSON.stringify(tags) : existing.tags,
    ts,
    req.params.id,
  );
  const row = db.prepare('SELECT * FROM recipients WHERE id = ?').get(req.params.id);
  res.json(serializeRecipient(row));
});

// DELETE /api/recipients/:id
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM recipients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Recipient not found' });
  db.prepare('DELETE FROM recipients WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// POST /api/recipients/import — CSV upload (multipart or JSON { csv: "..." })
router.post('/import', (req, res) => {
  const csvText = req.body?.csv;
  if (!csvText) return res.status(400).json({ error: 'csv field is required' });

  let records;
  try {
    records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (err) {
    return res.status(400).json({ error: 'Failed to parse CSV: ' + err.message });
  }

  const ts = nowIso();
  let imported = 0;
  let skipped = 0;
  const errors = [];

  const insert = db.prepare(
    `INSERT INTO recipients (id, email, company_name, first_name, last_name, custom_fields, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '{}', '[]', ?, ?)`
  );
  const findDupe = db.prepare('SELECT id FROM recipients WHERE email = ?');

  const columnMap = {
    email: ['email', 'e-mail', 'email_address', 'emailaddress'],
    company_name: ['company', 'company_name', 'companyname', 'organization', 'org'],
    first_name: ['first_name', 'firstname', 'first'],
    last_name: ['last_name', 'lastname', 'last'],
  };

  function resolveColumn(fieldNames, headers) {
    for (const fn of fieldNames) {
      const match = headers.find((h) => h.toLowerCase().replace(/[\s_-]/g, '') === fn.replace(/[\s_-]/g, ''));
      if (match) return match;
    }
    return null;
  }

  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  const mapping = {};
  for (const [field, aliases] of Object.entries(columnMap)) {
    mapping[field] = resolveColumn(aliases, headers);
  }

  if (!mapping.email) {
    return res.status(400).json({ error: 'CSV must contain an "email" column' });
  }

  for (const record of records) {
    const email = (record[mapping.email] || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      skipped++;
      errors.push(`Row ${imported + skipped}: invalid email "${email}"`);
      continue;
    }

    const existing = findDupe.get(email);
    if (existing) {
      skipped++;
      continue;
    }

    insert.run(
      newId(),
      email,
      mapping.company_name ? (record[mapping.company_name] || '').trim() : '',
      mapping.first_name ? (record[mapping.first_name] || '').trim() : '',
      mapping.last_name ? (record[mapping.last_name] || '').trim() : '',
      ts,
      ts,
    );
    imported++;
  }

  res.json({ imported, skipped, total: records.length, errors: errors.slice(0, 20) });
});

export default router;

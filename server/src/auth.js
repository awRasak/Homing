import crypto from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRET_FILE = path.join(__dirname, '..', 'data', '.jwt_secret');

function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE, 'utf-8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  try { writeFileSync(SECRET_FILE, secret, { mode: 0o600 }); } catch {}
  return secret;
}

const JWT_SECRET = getJwtSecret();
const ALG = 'sha256';

// ── Password hashing (scrypt, no bcrypt dep) ──

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

// ── Minimal JWT (HS256, no dep) ──

function b64url(buf) {
  return (Buffer.isBuffer(buf) ? buf : Buffer.from(buf))
    .toString('base64url');
}

function sign(payload, expiresMs) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Date.now();
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + expiresMs }));
  const sig = b64url(
    crypto.createHmac(ALG, JWT_SECRET).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

export function createToken(userId, workspace) {
  return sign({ sub: userId, ws: workspace }, 30 * 24 * 60 * 60 * 1000); // 30 days
}

export function verifyToken(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = b64url(
      crypto.createHmac(ALG, JWT_SECRET).update(`${header}.${body}`).digest()
    );
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return { userId: payload.sub, workspace: payload.ws };
  } catch {
    return null;
  }
}

// ── Users table ──

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  workspace TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace);
`);

export function createUser(email, password, name) {
  const id = crypto.randomUUID();
  const workspace = `ws_${id.slice(0, 8)}`;
  const password_hash = hashPassword(password);
  const created_at = new Date().toISOString();
  db.prepare('INSERT INTO users (id, email, password_hash, name, workspace, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, email.toLowerCase().trim(), password_hash, name || '', workspace, created_at);
  return { id, email: email.toLowerCase().trim(), name, workspace };
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
}

export function getUserById(id) {
  return db.prepare('SELECT id, email, name, workspace, created_at FROM users WHERE id = ?').get(id);
}

// ── Auth middleware ──

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const decoded = verifyToken(auth.slice(7));
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.userId = decoded.userId;
  req.workspace = decoded.workspace;
  next();
}

// Optional auth — sets workspace if token present, otherwise req.workspace = 'default'
export function optionalAuth(req, _res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const decoded = verifyToken(auth.slice(7));
    if (decoded) {
      req.userId = decoded.userId;
      req.workspace = decoded.workspace;
    }
  }
  if (!req.workspace) req.workspace = 'default';
  next();
}

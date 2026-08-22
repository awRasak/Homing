#!/usr/bin/env node
// Stress test for the Becca API (/api/becca/*).
//
// Usage:
//   node scripts/stress-test-becca.mjs [--url http://localhost:4000] [--phases 1,10,50,100] [--reqs-per-phase 300] [--timeout-ms 10000]
//
// Notes:
// - Uses an isolated workspace (stress-<timestamp>) and cleans up after itself.
// - Only exercises local DB-backed endpoints. LLM-backed endpoints
//   (/chat/message, /pipeline/*) are excluded because they call Groq/external
//   services and would burn quota under load.

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = String(argValue('--url', process.env.BECCA_URL || 'http://localhost:4000')).replace(/\/$/, '');
const PHASES = String(argValue('--phases', '1,10,50,100')).split(',').map(Number).filter(Boolean);
const REQS_PER_PHASE = Number(argValue('--reqs-per-phase', '300'));
const TIMEOUT_MS = Number(argValue('--timeout-ms', '10000'));

const WORKSPACE = `stress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const API = `${BASE}/api/becca`;

const pad = (s, n) => String(s).padEnd(n);
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`);

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

const stats = new Map(); // label -> { count, errors, statuses: Map, latencies: [] }
function record(label, ms, status) {
  let s = stats.get(label);
  if (!s) { s = { count: 0, errors: 0, statuses: new Map(), latencies: [] }; stats.set(label, s); }
  s.count++;
  s.statuses.set(status, (s.statuses.get(status) || 0) + 1);
  if (status >= 400 || status === 0) s.errors++;
  if (s.latencies.length < 60000) s.latencies.push(ms);
}

async function request(method, path, body, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = performance.now();
  let status = 0;
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    status = res.status;
    const json = await res.json().catch(() => null); // drain + parse when possible
    return { status, ok: res.ok, json };
  } catch {
    status = 0;
    return { status, ok: false, json: null };
  } finally {
    clearTimeout(timer);
    const ms = performance.now() - start;
    record(label ?? `${method} ${path.split('?')[0]}`, ms, status);
  }
}

let n = 0;
const uid = () => `${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40); // ~2.4KB

async function mixedOperation(created) {
  // Weighted mix: ~70% reads, ~30% writes across Becca's DB-backed surface.
  const roll = Math.random();
  if (roll < 0.14) return request('GET', `/profile?workspace=${WORKSPACE}`);
  if (roll < 0.28) return request('GET', `/topics?workspace=${WORKSPACE}`);
  if (roll < 0.38) return request('GET', `/briefings?workspace=${WORKSPACE}&limit=50`);
  if (roll < 0.46) return request('GET', `/reminders?workspace=${WORKSPACE}`);
  if (roll < 0.54) return request('GET', `/memory?workspace=${WORKSPACE}`);
  if (roll < 0.60) return request('GET', `/chat?workspace=${WORKSPACE}`);
  if (roll < 0.66) return request('GET', `/settings?workspace=${WORKSPACE}`);
  if (roll < 0.70) return request('GET', `/posts?workspace=${WORKSPACE}&limit=50`);

  if (roll < 0.76) {
    const r = await request('POST', '/topics', { workspace: WORKSPACE, name: `topic-${uid()}`, context: lorem.slice(0, 500), priority: 'medium' });
    if (r.ok && r.json?.id) created.topicIds.push(r.json.id);
    return;
  }
  if (roll < 0.82) {
    const r = await request('POST', '/briefings', {
      workspace: WORKSPACE, topic_name: `stress-topic`, status: 'changed',
      headline: `Headline ${uid()}`, what_changed: lorem, why_it_matters: lorem.slice(0, 800),
      urls: [`https://example.com/${uid()}`],
    });
    if (r.ok && r.json?.id) created.briefingIds.push(r.json.id);
    return;
  }
  if (roll < 0.87) {
    const r = await request('POST', '/reminders', { workspace: WORKSPACE, text: `Reminder ${uid()}`, due: null, when_raw: 'tomorrow' });
    if (r.ok && r.json?.id) created.reminderIds.push(r.json.id);
    return;
  }
  if (roll < 0.92) {
    const r = await request('POST', '/chat', { workspace: WORKSPACE, role: Math.random() < 0.5 ? 'user' : 'assistant', content: lorem.slice(0, 1200), session_id: `${WORKSPACE}:session` });
    if (r.ok && r.json?.id) created.chatIds.push(r.json.id);
    return;
  }
  if (roll < 0.95) {
    return request('PUT', '/settings', { workspace: WORKSPACE, key: 'daily', value: { dailyOn: true, dailyTime: '07:00', country: 'Nigeria', nonce: uid() } });
  }
  if (roll < 0.99) {
    const r = await request('POST', '/posts', {
      workspace: WORKSPACE, topic_name: 'stress-topic', title: `Post ${uid()}`,
      slug: `post-${uid()}`, body: lorem.repeat(4), excerpt: 'Excerpt',
      tags: ['stress'], status: 'draft',
    });
    if (r.ok && r.json?.id) created.postIds.push(r.json.id);
    return;
  }
  // Heavy read: full export
  return request('GET', `/export?workspace=${WORKSPACE}`);
}

async function cleanup(created) {
  const jobs = [];
  jobs.push(request('DELETE', `/chat?workspace=${WORKSPACE}&session=${WORKSPACE}%3Asession`));
  for (const id of created.postIds) jobs.push(request('DELETE', `/posts/${id}`));
  for (const id of created.topicIds) jobs.push(request('DELETE', `/topics/${id}`));
  for (const id of created.reminderIds) jobs.push(request('DELETE', `/reminders/${id}`));
  await Promise.allSettled(jobs);
}

// Briefings/memory/profile/settings have no per-workspace DELETE endpoints, so
// finish the purge directly on the SQLite DB (same machine as the server).
function purgeWorkspaceFromDb() {
  const dbPath = new URL('../data/homing.db', import.meta.url).pathname;
  return import('node:sqlite')
    .then(({ DatabaseSync }) => {
      const db = new DatabaseSync(dbPath);
      const tables = ['becca_topics', 'becca_briefings', 'becca_reminders', 'becca_memory', 'becca_chat_history', 'becca_posts', 'becca_profile', 'becca_settings'];
      let removed = 0;
      for (const t of tables) {
        removed += db.prepare(`DELETE FROM ${t} WHERE workspace = ?`).run(WORKSPACE).changes;
      }
      db.close();
      return removed;
    })
    .catch(() => 0);
}

async function runPhase(concurrency, reqsPerPhase) {
  const created = { topicIds: [], briefingIds: [], reminderIds: [], chatIds: [], postIds: [] };
  const perWorker = Math.ceil(reqsPerPhase / concurrency);
  const start = performance.now();

  async function worker() {
    for (let i = 0; i < perWorker; i++) {
      await mixedOperation(created);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  const wallMs = performance.now() - start;
  return { wallMs, rps: (perWorker * concurrency) / (wallMs / 1000), created };
}

async function main() {
  console.log(`\nBecca API stress test`);
  console.log(`  target:     ${BASE}`);
  console.log(`  workspace:  ${WORKSPACE} (isolated, cleaned up after)`);
  console.log(`  phases:     ${PHASES.join(' -> ')} concurrent workers`);
  console.log(`  per phase:  ~${REQS_PER_PHASE} requests\n`);

  // Health check
  const health = await fetch(`${BASE}/api/status`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) {
    console.error(`Server not reachable at ${BASE}. Start it first:  cd server && npm start`);
    process.exit(1);
  }
  console.log(`  server ok — provider: ${health.activeProvider}\n`);

  const phaseResults = [];
  const allCreated = { topicIds: [], briefingIds: [], reminderIds: [], chatIds: [], postIds: [] };
  for (const c of PHASES) {
    process.stdout.write(`Phase @ ${pad(c, 4)} concurrent ... `);
    const { wallMs, rps, created } = await runPhase(c, REQS_PER_PHASE);
    for (const k of Object.keys(allCreated)) allCreated[k].push(...created[k]);
    phaseResults.push({ c, wallMs, rps });
    console.log(`${fmtMs(wallMs)} wall, ${rps.toFixed(1)} req/s`);
  }

  // Report
  console.log(`\n${'─'.repeat(78)}`);
  console.log(`${pad('ENDPOINT', 34)}${pad('REQS', 7)}${pad('ERR%', 6)}${pad('P50', 10)}${pad('P95', 10)}${pad('P99', 10)}MAX`);
  console.log('─'.repeat(78));

  const all = [];
  const rows = [...stats.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [label, s] of rows) {
    const lat = s.latencies.sort((a, b) => a - b);
    all.push(...lat);
    const errPct = ((s.errors / s.count) * 100).toFixed(1);
    console.log(
      `${pad(label, 34)}${pad(s.count, 7)}${pad(errPct, 6)}${pad(fmtMs(percentile(lat, 50)), 10)}${pad(fmtMs(percentile(lat, 95)), 10)}${pad(fmtMs(percentile(lat, 99)), 10)}${fmtMs(lat[lat.length - 1] || 0)}`
    );
  }

  const totalLat = all.sort((a, b) => a - b);
  const totalReqs = rows.reduce((acc, [, s]) => acc + s.count, 0);
  const totalErrs = rows.reduce((acc, [, s]) => acc + s.errors, 0);

  console.log('─'.repeat(78));
  console.log(
    `${pad('TOTAL', 34)}${pad(totalReqs, 7)}${pad(((totalErrs / totalReqs) * 100).toFixed(1), 6)}${pad(fmtMs(percentile(totalLat, 50)), 10)}${pad(fmtMs(percentile(totalLat, 95)), 10)}${pad(fmtMs(percentile(totalLat, 99)), 10)}${fmtMs(totalLat[totalLat.length - 1] || 0)}`
  );

  const peakRps = Math.max(...phaseResults.map((p) => p.rps));
  console.log(`\nPeak throughput: ${peakRps.toFixed(1)} req/s @ ${phaseResults.find((p) => p.rps === peakRps)?.c} workers`);

  // Status code breakdown
  const codes = new Map();
  for (const [, s] of stats) for (const [code, cnt] of s.statuses) codes.set(code, (codes.get(code) || 0) + cnt);
  console.log(`Status codes: ${[...codes.entries()].map(([k, v]) => `${k === 0 ? 'timeout/net-err' : k}: ${v}`).join(', ')}`);

  console.log('\nCleaning up test data...');
  await cleanup(allCreated).catch(() => {});
  const purged = await purgeWorkspaceFromDb();
  console.log(`DB purge removed ${purged} remaining rows for ${WORKSPACE}.`);
  console.log('Done.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });

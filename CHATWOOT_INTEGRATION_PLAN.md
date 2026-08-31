# Chatwoot Integration Plan

**Goal:** connect live customer inquiries from the client's website (via Chatwoot) into Homing, so Homin can draft replies from the same business context it already uses for proposals/content, and the business owner gets a lightweight, near-real-time view of incoming conversations without leaving Homing. When Homin can't confidently answer something itself, the owner gets emailed about the specific question instead of it silently sitting unanswered.

**Non-goal for v1:** replacing Chatwoot's own agent UI, building a custom chat widget, or auto-sending replies without human approval. Chatwoot already does live-chat infrastructure well (widget, delivery, presence, multi-channel) — don't rebuild it. Homing's job is the AI-drafting layer + a lightweight review surface + the escalation path.

---

## Why Chatwoot, not build-from-scratch

Real-time multi-channel chat (website widget, WhatsApp/Instagram/Messenger connectors, delivery guarantees, agent assignment) is a large, separate infrastructure problem, not something to build inside Homing. Chatwoot is open-source, self-hostable, has a real REST API + webhooks, and already solves this. Integrating is a fraction of the effort of building it, and keeps Homing focused on what it actually does: AI-assisted business communication with real context (brand, proposals, watchlist, content history).

---

## Architecture

```
Client's website  →  Chatwoot widget  →  Chatwoot (self-hosted or Cloud)
                                                │
                                     webhook on new message
                                                ▼
                                  POST /api/chatwoot/webhook  (Homing server)
                                                │
                              buildKnowledgeBase() + Homin's drafting prompt
                                                │
                               ┌────────────────┴────────────────┐
                               ▼                                 ▼
                   CAN answer confidently              CAN'T answer confidently
                               │                                 │
                draft posted to Chatwoot as a          email sent to the owner
                PRIVATE NOTE (agent-visible               (question + link to
                only, not sent to customer)               the conversation)
                               │
                    Homing's "Inbox" tab  ←  polls/streams GET /api/chatwoot/conversations
                    (near-real-time list, shows draft, review/edit/approve → sends via Chatwoot API)
```

Key decision: **drafts, not auto-replies, for v1.** A wrong or off-brand AI reply going straight to a real customer is a much worse failure mode than a bad blog post draft. Every reply needs a human "send" click until there's a track record to justify auto-send as an opt-in per-inbox setting later.

---

## Prerequisites (infra, not code)

1. Stand up a Chatwoot instance — either self-hosted (Docker: `docker-compose` from Chatwoot's own repo) or Chatwoot Cloud (chatwoot.com, has a free tier).
2. In Chatwoot: create a **Website** inbox for the client's site, get the widget embed script, and add it to the client's website (outside this repo — that's their site, not Homing's).
3. In Chatwoot: generate an **API access token** (Profile Settings → Access Token) and note the **Account ID** and **Inbox ID**.
4. In Chatwoot: set up an **outgoing webhook** (Settings → Integrations → Webhooks) pointing at `https://<homing-server-domain>/api/chatwoot/webhook`, subscribed to at minimum the `message_created` event.

These four are manual setup steps for whoever owns the Chatwoot account — no code needed, but the plan below assumes they're done first so there's something real to test against.

---

## Phase 1 — Server-side API client + webhook receiver (prove connectivity)

**New file: `server/src/chatwoot.js`** — follow the exact pattern already used in `server/src/buffer.js` and `server/src/ai/tavily.js` in this repo (a thin fetch wrapper, `isChatwootAvailable()` checking for the env var, functions returning parsed JSON or throwing).

```js
const CHATWOOT_URL = process.env.CHATWOOT_URL; // e.g. https://app.chatwoot.com or self-hosted URL
const token = () => process.env.CHATWOOT_API_TOKEN || '';
const accountId = () => process.env.CHATWOOT_ACCOUNT_ID || '';

export function isChatwootAvailable() {
  return !!(CHATWOOT_URL && token() && accountId());
}

async function chatwootRequest(path, options = {}) { /* fetch wrapper, api_access_token header, JSON in/out */ }

export function getConversations() { /* GET /api/v1/accounts/:id/conversations */ }
export function getConversation(conversationId) { /* GET .../conversations/:id */ }
export function postPrivateNote(conversationId, content) { /* POST .../messages with private: true */ }
export function sendReply(conversationId, content) { /* POST .../messages with private: false */ }
```

**New route file: `server/src/routes/chatwoot.js`**, mounted in `server/src/index.js` the same way every other router is (`app.use('/api/chatwoot', requireAuth, chatwootRouter)` for the authenticated proxy endpoints — but the **webhook receiver itself must NOT be behind `requireAuth`**, since Chatwoot calls it directly with no user JWT. Verify it instead via a shared secret Chatwoot sends in the payload/header — mount it unauthenticated at the app level, same pattern already used for `/api/social-assets`'s GET route in this codebase).

```js
// POST /api/chatwoot/webhook — public, verified by shared secret instead of JWT
router.post('/webhook', async (req, res) => {
  // 1. Verify req.body matches expected shape / shared-secret header
  // 2. Only act on event === 'message_created' && message_type === 'incoming'
  //    (ignore outgoing/agent messages, or you'll draft replies to your own replies)
  // 3. Log it for now — Phase 1 is just "does this fire correctly"
  res.status(200).json({ ok: true }); // ack fast; Chatwoot retries on non-2xx
});
```

**Phase 1 done when:** a real message typed into the client's website widget shows up in this server's logs with the right conversation ID, contact info, and message text.

---

## Phase 2 — Homin drafts a reply, or escalates by email if it can't

Extend the webhook handler: on a genuine incoming customer message,

1. Fetch the conversation's recent message history from Chatwoot (`getConversation`) for context.
2. Reuse `buildKnowledgeBase(ws)` from `server/src/routes/becca.js` — same company/brand/tone context Homin already uses for proposals and social posts.
3. Call a new, narrowly-scoped prompt (same pattern as the CHAT answer-prompt already in `becca.js`: persona + context + "answer directly, on-brand tone") — **not** the action-classifier prompt; a webhook message isn't the user's own chat with Homin, it's drafting on their behalf for a third party.
4. **The prompt must be able to say "I can't answer this"** — instruct it explicitly: "If the knowledge base above doesn't actually cover what's being asked (pricing you don't have, a policy question, anything requiring a human judgment call), respond with exactly `NEEDS_HUMAN` and nothing else, instead of guessing." A sentinel string is simpler and more reliably checked in code than asking for nested JSON here, consistent with how lightweight single-purpose decisions are already handled elsewhere in this codebase.
5. Branch on the response:
   - **Got a real draft:** post it via `postPrivateNote()` — visible to agents inside Chatwoot immediately, without touching what the customer sees.
   - **Got `NEEDS_HUMAN` (or the response is empty/near-empty/just apologizes without answering — add that as a deterministic backstop, since a model saying "I'm not sure, but..." and rambling anyway is a softer version of the same failure this session's testing repeatedly found prompt-only instructions don't fully catch on their own):** don't post a note. Instead, send an email to the workspace owner via the **existing** `sendEmail()` in `server/src/email.js` (same function already used for password resets and campaign sends) — subject line naming the contact, body with the actual customer question, the conversation history for context, and a direct link into Chatwoot (or Homing's own Inbox tab once Phase 3 exists) to answer it. Look up the owner's email from the `users` table (already keyed by workspace).

This alone is a shippable, useful v1: whoever's answering support in Chatwoot's own UI now sees an AI-drafted starting point on every answerable message, and gets emailed the moment something needs a human — with zero new UI in Homing yet.

**Which workspace?** Chatwoot has no concept of Homing's workspaces. Simplest v1: one Chatwoot account per Homing workspace, mapped via a `chatwoot_settings` table (see below) rather than env vars, so this can eventually support more than one client/business.

**New table** (via the same ad-hoc migration pattern already used throughout `server/src/db.js`):
```sql
CREATE TABLE IF NOT EXISTS chatwoot_settings (
  workspace TEXT PRIMARY KEY,
  chatwoot_url TEXT NOT NULL,
  api_token TEXT NOT NULL,
  account_id TEXT NOT NULL,
  inbox_id TEXT,
  auto_reply_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```
The webhook payload includes the Chatwoot account ID — use that to look up which Homing workspace it belongs to.

---

## Phase 3 — "Inbox" tab in Homing's UI, updating as messages arrive

Add a new section to the Homin shell, alongside the existing Chat/Watchlist/Briefings/Pipeline/Reminders tabs (`client/src/components/BeccaLayout.jsx` already has this tab pattern — follow it exactly).

- `GET /api/chatwoot/conversations` (authenticated proxy) → list open conversations for the workspace's Chatwoot account.
- Each row shows: contact name, last message, Homin's drafted reply (pulled from the private note) if one exists, or a visible "escalated — check your email" state if it isn't.
- "Send" button posts the (possibly edited) draft via `sendReply()`.
- "Open in Chatwoot" link for anything needing full agent tools (attachments, assignment, tags) this UI won't replace.

**"See messages as they enter"** — this app has no real-time/websocket infrastructure anywhere today, so there are two honest options, not one "correct" answer:

1. **Short-interval polling (recommended v1)** — the Inbox tab re-fetches `GET /api/chatwoot/conversations` every 10–15 seconds while it's open. Simple, consistent with how the rest of Homing already works, no new infrastructure. Not instant, but close enough for a support-inbox use case, and the *server-side* draft/escalation reaction (Phase 2) already happens the instant the webhook fires regardless of whether anyone has the tab open — polling only affects how fast the UI reflects it.
2. **Server-Sent Events (upgrade path, not v1)** — Express supports SSE natively (no new dependency, unlike full websockets). The webhook handler could push an event to any connected Inbox tab the moment a message arrives, for a genuinely live feel. Worth doing once the polling version is working and proven useful — don't build this first.

This is intentionally thin — a review/triage surface, not a full inbox rebuild.

---

## Phase 4 (later, opt-in) — Auto-reply for specific cases

Once there's a track record of good drafts, add a per-workspace `auto_reply_enabled` toggle (column already scaffolded in Phase 2's table) that sends the drafted reply immediately for narrowly-defined cases (e.g., FAQ-style questions matching known topics) instead of waiting for approval. Should ship disabled by default, with a visible on/off control and probably a confirmation step the first time it's turned on given the blast radius (a bad reply goes straight to a real customer).

---

## Security notes

- Chatwoot API token lives server-side only (`chatwoot_settings` table or `.env` for a single-workspace setup), never sent to the client — same handling as every other API key in this codebase (`GROQ_API_KEY`, `TAVILY_API_KEY`, `BUFFER_API_KEY`).
- The webhook endpoint is the one deliberately-unauthenticated route (Chatwoot can't send a Homing JWT) — it MUST verify the payload some other way (Chatwoot supports signing webhooks; check their current docs for the exact header/HMAC scheme, since Chatwoot's API has changed this across versions) so a random POST to that URL can't inject fake conversations or spoof private notes.
- Rate-limit or de-dupe the webhook handler — a Chatwoot retry storm (they retry on non-2xx) could otherwise fire the LLM draft call repeatedly for the same message.

---

## Open questions for whoever picks this up

1. Self-host Chatwoot or use Chatwoot Cloud? (Affects `CHATWOOT_URL` and ongoing cost — Cloud has a free tier but limits.)
2. Single workspace/business for now, or does the `chatwoot_settings`-per-workspace design need to support multiple client Chatwoot accounts from day one?
3. Which model should draft replies — reuse the user's selected Homin model, or pin something specific for this (a bad customer-facing reply is higher-stakes than a bad blog draft, so this might warrant always using the most reliable model regardless of the user's chat preference)?
4. Escalation email throttling — if several messages need a human at once (a busy hour, or a broken drafting prompt firing `NEEDS_HUMAN` on everything), should each one send its own email immediately, or batch into a short digest (e.g. "3 questions need your attention") to avoid flooding the owner's inbox? Worth a simple per-workspace cooldown (e.g. don't send more than one escalation email per N minutes, bundling anything that arrives in between) rather than 1:1 with every escalated message.

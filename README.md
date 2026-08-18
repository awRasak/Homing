# Homing — Tailored Proposal Generator

Generate on-brand, recipient-tailored proposal PDFs from your own existing
proposal design. See `PRD.md` for the full product spec.

## Structure

- `server/` — Express API (Node's built-in `node:sqlite` for storage, Anthropic SDK for AI copy generation)
- `client/` — React + Vite single-page app (pdf.js for in-browser PDF parsing/rendering)

## Setup

Requires Node 24+ (uses the built-in `node:sqlite` module).

```bash
cd server
npm install
cp .env.example .env   # then add your ANTHROPIC_API_KEY
npm run dev             # http://localhost:4000
```

```bash
cd client
npm install
npm run dev             # http://localhost:5173 (proxies /api to :4000)
```

## Notes

- All designs/branding/style samples/static sections and generated proposal
  history persist in `server/data/homing.db` (gitignored, local to each
  machine — not synced across devices by this repo).
- Without `ANTHROPIC_API_KEY` set, the app runs fully except the "Generate
  tailored copy" action, which returns a clear "not configured" error.
- PDF/image parsing (text, colors, logo, fonts) happens entirely client-side
  in the browser; only the recipient-specific copy generation call goes to
  the server, which forwards it to the Claude API.

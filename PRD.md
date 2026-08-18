# PRD: Tailored Proposal Generator (Homing)

Status: Draft (v0.3, based on working prototype)
Owner: TBD
Last updated: August 15, 2026

## 1. Problem

Sending a personalized proposal to many companies (e.g. 100 target accounts) today means manually duplicating a designed document and hand-editing the name, images, and body copy for each recipient. This is slow, error-prone (old company names left in from copy-paste), and makes it hard to keep every version visually consistent with the original design. It gets worse for anyone who pitches more than one type of deal — a "standard proposal" and an "enterprise pitch" end up as separate, hand-maintained files with no shared system between them.

There is no tool that lets someone:

1. Reuse their exact existing proposal branding, copy structure, and layout,
2. Maintain more than one proposal design side by side without them colliding,
3. Generate recipient-specific body copy that still sounds like them, and
4. Export a clean, on-brand PDF per company,

without hiring a designer or writing custom mail-merge scripts for every campaign.

## 2. Goal

Let a single user go from "I have a proposal design and a list of company names" to "I have a tailored, on-brand PDF for each company" in minutes, with AI handling the copy tailoring and the tool handling layout fidelity — and let them do this for as many distinct proposal designs as their business needs, not just one.

### Success looks like

- A user can set up a template (branding + static content + style sample) in under 10 minutes, largely auto-filled from an upload rather than typed by hand.
- Generating one tailored proposal (AI copy + preview) takes under 30 seconds, or a single typed word in the chat bar.
- The exported PDF is visually consistent with the user's original design (colors, logo, fonts, layout) with no manual re-formatting needed.
- A user managing several proposal types (e.g. by service line, deal size, or region) can switch between them without re-entering branding or losing either one's history.
- A user sending to 100 companies does not need to touch a design tool at any point after setup.

### Non-goals (for this version)

- This is not a full document editor (no rich-text formatting, drag-and-drop layout).
- This is not a CRM or outreach/sending tool — it produces files for the user to send however they choose.
- This does not attempt full PDF layout reconstruction (multi-column, complex vector layouts) — it uses a single flexible template per design, not literal PDF editing.

## 3. Target user

Someone doing lightweight B2B outreach at volume — freelancers, agencies, sales/BD teams, founders — who already has one or more designed proposals (as a PDF or in a design tool) and needs to send tailored versions to many prospects without a designer or developer in the loop.

## 4. User stories

- As a user, I want to upload my existing proposal design so the tool matches my real branding instead of a generic template.
- As a first-time user, I want to be guided to upload a design (or explicitly skip) the moment I open the tool, rather than landing on a blank form with no direction.
- As a user, I want the tool to read the actual text of my uploaded proposal — not just its colors — and pre-fill sender/recipient names, my writing style, and my boilerplate sections, so I'm reviewing and adjusting instead of starting from nothing.
- As a user, I want to extract my brand color, logo, and fonts directly from that design rather than re-entering hex codes, re-exporting logo files, or guessing which typeface to pick.
- As a user with more than one proposal design (e.g. different service lines or deal types), I want each one saved separately with its own branding, style, and content — switching between them shouldn't mix up copy or overwrite each other.
- As a user, I want to add a new design at any time, going through the same guided upload-or-skip flow, without disturbing my existing designs.
- As a user, I want to give one example of my writing style so AI-generated copy sounds like me, not like generic AI copy.
- As a user, I want to keep certain sections identical across every proposal (e.g. "Why us," pricing, process) so my core pitch doesn't drift between versions.
- As a user, I want to enter just a company name — even in a single quick word — and get a full draft of the parts of the proposal that should be tailored (headline, opening, body, closing), using whichever design is currently active.
- As a user, I want to preview the tailored proposal exactly as it will be exported before downloading.
- As a user, I want to download a clean PDF per company that I can send immediately.
- As a user, I want each design's past generated proposals saved separately so I don't have to redo setup every session and can revisit/re-download past ones without them bleeding across designs.

## 5. Features

### 5.1 Onboarding

- On first visit (no saved design yet, and the person hasn't previously dismissed it), a modal offers two paths: upload a proposal to auto-fill from it, or skip for now to start blank.
- Choosing upload reuses the full design-import pipeline (§5.2); the modal closes immediately on file selection so the person watches their fields populate live rather than waiting behind a static screen.
- Returning users with an existing design skip the modal entirely. Creating an additional new design (§5.6) re-triggers the same modal for that design specifically, since it starts blank regardless of what other designs already exist.

### 5.2 Design import (branding + content extraction)

- Upload a PDF or image of an existing designed proposal.
- Renders the source design in-browser (first page for PDFs).
- Auto-suggested palette: samples the rendered design and surfaces ~5–7 dominant, non-background colors as clickable swatches.
- Manual color picker: click anywhere on the rendered design to sample that exact pixel as the accent color, for precision beyond the auto palette.
- Logo extraction: drag a selection box over the logo in the rendered design; crop and save it as the template logo.
- Font detection (PDF only): reads the embedded text to identify the font used for the largest text (headline) and the most-used smaller text (body).
  - Exact font name resolved and present on Google Fonts → loaded and applied directly.
  - Common non-Google corporate font detected (Arial, Times New Roman, Georgia, Calibri, etc.) → swapped for Google's official metric-compatible equivalent (Arimo, Tinos, Gelasio, Carlito, respectively).
  - Neither resolves → falls back to a serif/sans-serif heuristic guess from a curated shortlist.
  - The tool states plainly which of the three outcomes occurred rather than presenting a guess as certain. Not available for image uploads (no font metadata in a raster image).
- Content extraction (PDF only): reconstructs lines and paragraphs from the PDF's embedded text and classifies them by font-size tier (title / heading / body):
  - The largest text on the page is treated as the document's header/title and stored as a structural reference the AI uses when writing new headlines (not copied verbatim).
  - Body text following a heading-sized line (e.g. "Why us," "Our process," "Pricing") is grouped under that heading and auto-fills Static sections.
  - Body text appearing before any heading (the intro/pitch) auto-fills the Style sample.
  - Common phrasing patterns ("Prepared for:", "To:", "Prepared by:", "From:") are matched to auto-fill sender name and recipient company name; any email address found auto-fills the contact line.
  - Auto-fill never overwrites a field the person has already typed into — it only fills blanks — so re-uploading or uploading a second reference file is non-destructive.
  - A status message states exactly what was and wasn't auto-filled, since the heading/body split is a heuristic, not true document understanding.
- Two font dropdowns (headline / body, curated Google Fonts list) let the user override any detected or guessed font at any time.
- All processing happens client-side; the uploaded file is not sent to a server.

### 5.3 Multi-template (multi-design) management

- A strip of chips at the top of the panel lists every saved proposal design, each labeled with its name and a dot in its accent color.
- Clicking a chip switches the active design: its branding, style sample, static content, and fonts load into the working fields, and its own generated-proposal history and chat quick-suggestions load in place of the previous design's.
- "+ New design" creates a new blank design, clears all fields, and opens the onboarding modal (§5.1) so the person can upload a reference for it or start from scratch.
- Each design has an editable name field so multiple designs (e.g. "Standard proposal," "Enterprise pitch") stay distinguishable in the strip.
- Clear deletes only the active design (two-step in-place confirmation, no browser popups) — its branding and its generated-proposal history — then switches to another existing design or creates a fresh blank one if none remain. It never affects other designs.
- Every design's branding, content, and generated-proposal history are stored independently; nothing is shared or overwritten across designs.

### 5.4 Template setup ("Your details" + "Static sections")

- Sender name, tagline/contact line, accent color (from import or manual), logo — auto-filled where possible by §5.2, editable regardless.
- Style sample: an example of the user's own writing (auto-filled from the intro of an uploaded design, or pasted manually), used to steer the tone/voice of AI-generated copy.
- Static sections: content that appears unchanged in every proposal (e.g. "Why us," process, pricing) — auto-filled from the uploaded design's headed sections, plus one shared hero image (manual upload).
- Saved automatically per active design and reloaded on return visits or when switching back to that design.

### 5.5 Recipient input & AI generation

Two equivalent entry points, both driving the same generation logic against the currently active design:

- Full form: company name (required) + free-text context notes (optional — industry, pain point, how the relationship started, etc.), with a "Generate tailored copy" action.
- Quick-generate chat bar: a single input docked at the bottom of the preview, styled as a chat/command bar. Typing just a company name and pressing enter (or the send button) triggers the same generation — no context notes, using the active design's saved tokens (accent color, fonts, style sample, static content) as-is. Up to 4 pills above the bar suggest recently generated company names for quick re-entry.
- Generated copy: headline, opening paragraph, 2–3 body paragraphs, and a closing/CTA paragraph — constrained to match the style sample's tone, avoid duplicating the static sections, and (when available) follow the structural pattern of the design's original detected headline.
- Regeneration is available if the first draft isn't right (re-running either entry point overwrites the current draft).

### 5.6 Live preview

- Real-time document preview reflecting the active design's branding + static content + generated copy, styled as the actual output document (not a raw form).
- Preview updates immediately as fields or generated copy change, and when switching between designs.

### 5.7 Export

- One-click export to PDF via the browser's native print-to-PDF, preserving layout/branding exactly as previewed.

### 5.8 History / persistence

- Each design's branding, style sample, and static content is saved automatically and reloaded on return visits or when switching designs.
- Each generated proposal is saved (company name, notes, generated copy) under its owning design and listed for quick recall — clicking a past entry reloads it into the preview without regenerating. History and chat suggestions are scoped to whichever design is currently active.

## 6. Primary user flow

### First-time setup (per design)

1. Land in the tool → onboarding modal appears.
2. Upload an existing proposal design (PDF/image), or skip to start blank.
3. If uploaded: review what was auto-filled (colors, logo via manual crop, fonts, sender/recipient names, style sample, static sections) and adjust anything that needs correcting.
4. If skipped: fill in sender details, style sample, and static sections manually.
5. Name the design.

### Ongoing use

6. Enter a recipient company name (full form, or a single word in the chat bar) and optional context notes.
7. Generate → review the AI-drafted copy in the live preview.
8. Download as PDF.
9. Repeat 6–8 for each additional company, reusing the same design.
10. To pitch a different type of deal, click "+ New design" and repeat the first-time setup — the existing design and its history remain untouched and one click away in the strip.

## 7. Technical notes (from prototype)

- Built as a single-page client-side app; no dedicated backend in the prototype.
- PDF rendering and text extraction: pdf.js (client-side, loaded from CDN) — used for both branding (fonts) and content (headings/paragraphs/sender-recipient detection) via `getTextContent()`.
- Color extraction: canvas pixel sampling + frequency bucketing, run in-browser.
- Logo extraction: canvas crop of a user-selected region.
- Content extraction: text items grouped into lines by vertical position, classified into title/heading/body tiers by font size, then grouped into structural blocks.
- AI generation: calls the Claude API (Sonnet) with a prompt combining the style sample, static content, detected original headline (as a structural hint), and recipient/context; expects structured JSON output (headline/opening/body/closing).
- Export: browser print-to-PDF (`window.print()` with print-specific CSS) rather than a server-rendered PDF, to guarantee visual parity with the on-screen preview.
- Persistence: key-value storage scoped to the user's browser, namespaced per design (`template:<id>`, `<id>:index`, plus a shared `templates:index` and `activeTemplateId`) — not a shared/multi-user backend.

### Known limitations to flag

- Font detection is best-effort: works well for PDFs exported from tools that use real Google Font names (Canva, Figma, Google Slides), less reliably for PDFs using paid/licensed fonts, and not at all for image uploads.
- Content extraction (headings vs. body vs. sender/recipient) is a font-size and regex heuristic, not true document understanding — works best on cleanly structured proposals with clear heading hierarchy, and may under- or over-classify text on free-flowing or unconventionally formatted documents. The tool reports exactly what it filled so nothing changes silently.
- Only the first page of a multi-page PDF is used for all extraction (colors, logo, fonts, content).
- Workflow is one-recipient-at-a-time (form or chat); there is no bulk/CSV import in this version.
- Storage/persistence in the prototype is local to the browser/account, not a durable multi-device or multi-user backend — "multi-template" here means multiple designs for one user, not multiple users.
- A real production build (in progress, separate spec) moves the Claude API call server-side and replaces browser storage with a real database — see the accompanying build spec document for phasing.

## 8. Risks / open questions

- AI copy quality at scale: with minimal context per company (just a name, or a name + short notes), how often will generated copy need manual editing? May need a lightweight edit-in-preview capability.
- Content-extraction accuracy: the heading/body heuristic may misclassify text on designs with unconventional hierarchy (e.g. no distinct heading sizes, or heavy use of imagery-as-text). Needs validation against a range of real uploaded proposals.
- Brand color extraction accuracy: auto-palette may surface a photo tone or off-brand color as the top suggestion; manual click-to-sample is the fallback, but should be validated with real designs.
- PDF fidelity across browsers: `window.print()`-based export can vary slightly by browser/OS print settings; may need testing or a server-side render fallback if consistency issues appear.
- Scale of outreach: if usage patterns show most users want to do 50–100+ at once, one-at-a-time generation will become the main friction point and should be prioritized next (batch/CSV mode, tracked separately in the build spec).
- Design-strip scalability: works well for a handful of designs; if users end up with dozens, the chip strip will need search/sort/archiving rather than a flat list.

## 9. Out of scope for this version (future considerations)

- Bulk generation from a CSV/spreadsheet of companies (batch mode) — see build spec Phase 2.
- Multi-page design import (branding/content pulled from more than page 1).
- Automated font and content detection for image-based uploads (not feasible without a dedicated visual recognition model — out of scope for a client-side tool).
- Team/shared templates and true multi-user collaboration (current model is multi-design, single-user).
- Direct send integration (email) rather than PDF download only.
- In-preview manual editing of AI-generated copy before export.
- Design-strip search, sorting, folders, or archiving for users with many saved designs.

---

This PRD reflects the working prototype already built (`proposal_generator.html`) and should be refined once real usage/testing surfaces which limitations actually matter. The separate build spec document covers the production (React + Node/Express) implementation plan and its phasing.

## Implementation note

This repo implements the **production build** referenced in §7/§9 rather than the single-file client-side prototype: a real Express + `node:sqlite` backend replaces browser `localStorage`, and the Claude API call is server-side (key never touches the browser). PDF/image parsing and rendering (colors, logo, fonts, content) remain entirely client-side per §5.2, since that part of the pipeline has no reason to move server-side.

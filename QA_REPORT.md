# Homing — QA Pass (Live Testing)

**Scope**: Whole app, live testing against the running local dev servers (`localhost:5173` client / `localhost:4000` server).
**Date**: 2026-08-26
**Environment**: Chromium-based automated browser, desktop viewport (1280×720) unless noted, macOS.

## Summary

Core flows I could reach work (proposal setup, recipient CRUD, chat/watchlist/briefings/pipeline/reminders shells, RebrandPanel). Three of the four blockers from the first pass were **fixed and verified live during this retest** (source was being actively edited concurrently while testing): the Dashboard tab no longer hangs, the Design canvas no longer clips content, and primary navigation is now real `<button>`s with `aria-label`s. Only the **mobile/responsive layout issue remains open** — the app is still unusable below ~768px wide. One new Minor finding surfaced this pass: an intermittent 401-then-retry on `GET /api/designs`.

---

## Bug list

### ~~[Critical] Dashboard tab never leaves "Loading your proposals…"~~ — FIXED, verified in retest

**Area**: Proposals → Dashboard
**Environment**: Chrome (automated), desktop viewport, localhost:5173
**Steps to reproduce**:
1. Go to Proposals → Dashboard tab.
2. Observe the proposal list area.

**Expected**: Once `GET /api/proposals` (or equivalent) resolves, either a list of proposals or an empty state ("No proposals yet") should render.
**Actual**: The list area is stuck on "Loading your proposals…" forever, even though the stats cards above it load real data correctly.

**Root cause** (found in code): [App.jsx:248-256](client/src/App.jsx#L248) gates the fetch on `if (section !== 'dashboard') return;`, but `section` is the top-level nav state (`'proposals'`, `'becca'`, `'design'`, …) — the sub-tab is tracked separately as `proposalTab`. Since `section` is never literally `'dashboard'`, this effect body never runs, `listAllProposals()` is never called, and `dashboardLoading` (initialized `true`) is never set to `false`. Confirmed via network log: `GET /api/designs/.../proposals` and `GET /api/proposals/stats` fire, but no all-proposals fetch ever does.

**Notes**: 100% reproducible at time of writing. This was a real regression, not a data/timing issue — the guard condition could never be satisfied.

**Retest** (same session, source edited concurrently): [App.jsx:249](client/src/App.jsx#L249) now reads `if (section !== 'proposals' || proposalTab !== 'dashboard') return;` with deps `[section, proposalTab]`. Reloaded and clicked Dashboard: renders "No proposals yet" empty state correctly instead of hanging. **Fixed.**

---

### ~~[Critical] Design canvas editor clips ~48% of the canvas vertically at default viewport~~ — FIXED, verified in retest

**Area**: Design (AI-powered canvas editor)
**Environment**: Chrome (automated), 1280×720 viewport, "Fit" zoom (96%), localhost:5173
**Steps to reproduce**:
1. Open Design (pencil icon in the left nav rail).
2. Select the Text tool and click anywhere in the upper portion of the canvas to add a text layer.
3. Look at the canvas.

**Expected**: The added "Edit me" text layer should be visible somewhere on the visible canvas, and "Fit" zoom should scale the canvas to fit inside its container.
**Actual**: The text layer is created (confirmed present in the Layers panel and Props panel with real X/Y/Font values) but is completely invisible — nothing renders on the visible canvas area.

**Root cause** (found via DOM inspection): the fabric.js canvas element is rendered at `1040×1040` CSS px, but its scroll container `.design-canvas-area` is only `936×542` CSS px. The canvas is vertically centered via flex, producing a `-249px` offset — i.e. ~249px is clipped off the top of the canvas and ~249px off the bottom, with `scrollTop` stuck at `0` and no way to scroll to the clipped regions (confirmed: `scrollHeight` 791 vs `clientHeight` 542, but the canvas itself sits outside that scrollable range due to the centering transform). "Fit" zoom appears to size the canvas to fit the container's *width* only, ignoring the much smaller available *height*.

**Notes**: 100% reproducible at time of writing. Any object placed in roughly the top or bottom quarter of the canvas was invisible/unreachable, with no visual indicator telling the user content was off-screen. This affected the app's core value proposition (visual design editing).

**Retest** (same session, source edited concurrently): reopened Design, the artboard now renders fully at 46% zoom with visible checkerboard padding around it (correctly scaled to fit both width and height). Added a text layer near the top of the canvas — it rendered immediately and correctly. **Fixed.**

---

### ~~[Blocker — Accessibility] Primary navigation is entirely unreachable by keyboard and unlabeled for assistive tech~~ — FIXED, verified in retest

**Area**: Global navigation (left icon rail — Homin/Proposals/Design/Brand Kit/Settings/Sign out)
**Environment**: Chrome (automated), desktop viewport
**Steps to reproduce**:
1. Inspect the left nav rail DOM, or try to Tab to it from the page.

**Expected**: Primary navigation controls should be focusable via Tab and have an accessible name (visible text, `aria-label`, or equivalent) per WCAG.
**Actual**: Every nav item is a plain `<div class="nav-item" title="...">` wrapping an `<img alt="">` (empty alt). None has `tabindex`, `role="button"`, or any ARIA labeling — only a mouse-hover `title` tooltip. A keyboard-only user cannot Tab into this nav at all; a screen reader gets no name for any of these controls (image alt is explicitly empty).

**Notes**: Confirmed via direct DOM query (`tabindex: null, role: null` on all 7 nav items) at time of writing. This blocked switching between Chat/Proposals/Design/Brand Kit/Settings for keyboard and screen-reader users.

**Retest** (same session, source edited concurrently): [NavRail.jsx](client/src/components/NavRail.jsx) now renders real `<button type="button">` elements with `aria-label` on the logo, sign-out, and settings controls (still worth double-checking the per-item icons in the mapped list carry `aria-label` too, not just title). Icons still use empty `alt=""`, which is fine since the button itself now carries the name. **Fixed** for keyboard reachability and the primary labeling gap; worth a follow-up spot-check that every mapped nav item (not just the static ones) has an `aria-label`.

---

### [Critical — Cross-platform] No responsive/mobile layout — app is unusable below ~768px

**Area**: Global layout
**Environment**: Chrome (automated), emulated mobile viewport 375×812
**Steps to reproduce**:
1. Resize viewport to 375×812 (a typical phone width) and reload.

**Expected**: Per the responsive checklist baseline, the app should reflow at 375px — collapsing/hiding non-essential chrome, making the main content area usable without horizontal scrolling.
**Actual**: The desktop three-column layout (icon rail + full sidebar + main panel) is rendered unchanged and simply overflows. The chat/session panel is pushed off-screen to the left; the main content area is blank; text and controls are cut off mid-word ("...ssion", "...ns yet"). There's no hamburger menu, no collapsed nav, no reflow of any kind.

**Notes**: 100% reproducible, still open — retested after the other three fixes landed and confirmed the mobile layout is unchanged (same overflow, same cut-off text). If mobile/tablet use is in scope for this product, this is a full-app blocker on those form factors, not a cosmetic nit.

---

### [Minor] Intermittent 401 on `GET /api/designs` that silently self-retries

**Area**: Global (app-level auth)
**Environment**: Chrome (automated), desktop viewport, observed during the retest pass
**Steps to reproduce**: Not reliably reproducible on demand — observed once in the network log during normal navigation (opening Proposals → Editor after being on the Design tab).
**Expected**: Authenticated requests should not intermittently fail auth on an already-logged-in session.
**Actual**: Network log showed `GET /api/designs → 401 Unauthorized` immediately followed by `GET /api/designs → 200 OK` (apparently an automatic retry) with no visible error surfaced to the UI.

**Notes**: Low impact since it self-recovers and the user sees no broken state, but worth a look — could indicate a token-refresh race (e.g., a request fired just before a refreshed auth token was applied to the request layer). If this happens more often under real network latency or on slower connections, a request could fail without a retry and silently break a page load. Recommend checking the client's auth/token-attachment logic for a race between token refresh and in-flight requests.

---

### [Minor] Recipient delete confirmation could not be verified end-to-end

**Area**: Proposals → Recipients
**Environment**: automated browser (native JS dialogs disabled in this environment)
**Steps to reproduce**: Click "Delete" on a recipient row.
**Expected**: A confirmation prompt ("Delete this recipient?") appears before the row is removed.
**Actual**: The `confirm("Delete this recipient?")` call was observed firing correctly (confirms the app *does* implement a confirmation step, per the general usability checklist requirement for destructive actions), but this test browser auto-suppresses native dialogs and returns `false`, so the actual delete-on-confirm path couldn't be exercised live. Not a bug — flagging as a coverage gap. Recommend a manual click-through to confirm the delete completes and the list updates.

---

## Passed / verified

- **Proposal Editor**: setup panel loads with pre-filled sender/tagline/colors/logo/fonts; page thumbnails and multi-page preview render correctly; "Enter company you're pitching to" bar and model selector (Anthropic/Groq) are present and functional.
- **Recipients**: add-recipient drawer opens/closes correctly; required-field (email) validation blocks empty submission via native HTML5 validation; a valid recipient submits successfully (`POST /api/recipients` → 201) and appears in the list immediately; search bar and Import CSV entry points are present.
- **Injection/XSS sanity check**: entering `<script>alert(1)</script>&"'` into the Company field on Add Recipient stored and rendered it as inert escaped text — no script execution, no console errors. Basic input-handling hygiene passes.
- **Campaigns tab**: correct, clearly designed empty state ("No campaigns yet" + "+ New" CTA).
- **Dashboard stats cards**: the 6 metric tiles (Proposals/Recipients/Campaigns/Emails Sent/Open Rate/Click Rate) load and reflect real counts correctly (independent of the broken proposal-list bug above).
- **Chat / Watchlist / Briefings / Pipeline / Reminders** (the "Homin" assistant shell): all five tabs render without console errors; Watchlist shows active/paused topic tracking with platform tags and a priority dropdown; Briefings shows daily-briefing toggle + region/timezone settings; Pipeline and Reminders show correct empty states with clear CTAs.
- **Brand Kit**: loads with populated logo, variations, colors, typography (20-font picker with live preview), identity, writing-tone, and static-sections panels — no console errors.
- **RebrandPanel** ("Swap the recipient name and logo throughout" on the Editor): full flow tested — enter new company name → live "Review changes" preview shows an accurate diff count ("34 replacements on 7 pages", "0 logo slots will be blanked", exact "Motoka" → "Acme Corp" substitution shown) → Apply → confirmation message → page content updates correctly in the canvas. Baked-in raster logo imagery is correctly left untouched (as the tool itself discloses) since no replacement logo was uploaded.
- Three of the four bugs/blockers from the first pass (Dashboard hang, Design canvas clipping, unlabeled/unreachable nav) were confirmed **fixed** in this retest — see struck-through entries above.

## Coverage summary — what wasn't tested

- **Settings and CompanyOnboarding screens** were not exercised in this pass (time-boxed).
- **PDF export/download** (`Download PDF`, the PyMuPDF structural export path in `pdf_edit.py`/`pdfTool.js`) was clicked but produced no observable network request in the log; this test browser also blocks the actual file save, so the export couldn't be verified end-to-end. Needs a manual check that clicking it actually produces a correct PDF.
- **AI-generated copy** (the "Generate" tab, recipient-tailored copy generation) was not tested — requires a configured `ANTHROPIC_API_KEY`/provider and would consume API credits.
- **CSV import** for recipients was not tested (no sample file provided).
- **Auth / login / multi-user permission behavior**: the app appears to run as a single logged-in session already; login flow, session expiry, and logout-then-relogin data isolation were not tested. Note the intermittent 401 above may be worth folding into this investigation.
- **Cross-browser** (Safari/Firefox/Edge) and **tablet width (768px)** were not tested — only Chromium at desktop and one mobile emulation point.
- **Delete flows** (recipients, designs, watchlist items) could not be fully verified end-to-end because native `confirm()` dialogs are suppressed in this automated browser (see Minor finding above).
- **Performance under load** (large recipient lists, many proposals, throttled network) was not tested — current data volumes were near-empty.
- One test recipient (`test@example.com`) and one new proposal ("Acme Corp") from this pass's RebrandPanel test may remain in the data — recommend clearing test data before using real data.

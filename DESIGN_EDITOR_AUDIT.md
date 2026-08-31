# Design Editor — Audit Against Standard Design-Tool Operations

**Scope**: `client/src/components/design/{DesignEditor,DesignCanvas,DesignToolbar,LayerPanel}.jsx` — the AI-powered canvas editor under the "Design" nav item. Audited via source review + live testing against the running local app.
**Date**: 2026-08-30

## Summary

Of the six operations audited, **two are completely non-functional** (Undo/Redo, font-family selection), **one is confirmed broken exactly as reported** (zoom discards pan/view state — "throws out the layers"), and **one is confirmed broken** (panels are not resizable and the toolbar overflows/bleeds at narrower widths). Layer management (reorder, hide, lock, duplicate, delete) and the image-to-layers import pipeline are solidly built, with one real but lower-severity bug found in the latter (imported color values break the Fill picker).

---

## Findings

### [Blocker] Undo / Redo do nothing at all

**Area**: Global editor controls
**Steps to reproduce**: Add any object (text/rect/circle), then click the Undo button or press Ctrl+Z.
**Expected**: The last action reverses.
**Actual**: Nothing happens — confirmed live both via the toolbar button and the Ctrl+Z shortcut.

**Root cause**: [DesignEditor.jsx:752-753](client/src/components/design/DesignEditor.jsx#L752) wires the toolbar's Undo/Redo buttons to literal no-ops:
```js
onUndo={() => {}}
onRedo={() => {}}
```
And the Ctrl+Z keydown handler ([DesignEditor.jsx:540](client/src/components/design/DesignEditor.jsx#L540)) only calls `e.preventDefault()` — it swallows the browser's own undo behavior and substitutes nothing. There is no history stack anywhere in the editor. The buttons and the "(Ctrl+Z)" / "(Ctrl+Shift+Z)" tooltips in [DesignToolbar.jsx:59-64](client/src/components/design/DesignToolbar.jsx#L59) actively promise a feature that was never built — worse than simply omitting it, since it invites a destructive action (delete, clear, a bad property edit) with no safety net.

**Notes**: 100% reproducible. This is standard-operation #1 in the audit request and is a complete gap, not a partial bug.

---

### [Critical] No way to change font family — only font size

**Area**: Text object properties (Props panel)
**Steps to reproduce**: Add text, select it, open the Props panel.
**Expected**: A font-family control alongside font size (standard in every design tool).
**Actual**: The Props panel (`ObjectPanel` in [DesignEditor.jsx:985-999](client/src/components/design/DesignEditor.jsx#L985)) only exposes **Text content** and **Font size** for text objects. No font-family dropdown exists anywhere in the UI. Confirmed live — added a text object, Props panel showed only those two fields.

**Notes**: The data is already tracked (`fontFamily` is set on creation — [DesignEditor.jsx:134](client/src/components/design/DesignEditor.jsx#L134) — and serialized — [DesignCanvas.jsx:298](client/src/components/design/DesignCanvas.jsx#L298)) — the object model supports it, only the UI control is missing. The app already has a 20-option Google Fonts picker elsewhere (Brand Kit's headline/body font selectors), so there's a ready-made pattern to reuse here.

---

### [Critical] Zoom (toolbar buttons) discards pan position — "throws out" whatever you'd scrolled to

**Area**: Zoom controls (toolbar buttons and the floating zoom widget — both call the same handlers)
**Steps to reproduce**:
1. Pan the canvas (drag on empty space) so part of the design is off-screen.
2. Click the Zoom In (or Zoom Out / Fit) button.

**Expected**: Zoom should scale around the current view (or at least not silently discard the pan), matching how scroll-wheel/pinch zoom already behaves in this same editor.
**Actual**: Confirmed live — panned the canvas so the design's right half was off-screen, then clicked Zoom In. The view snapped instantly back to the frame's top-left origin, and the design reappeared at a new zoom level as if the pan had never happened.

**Root cause**: [DesignEditor.jsx:382-420](client/src/components/design/DesignEditor.jsx#L382) — `handleZoomIn`/`handleZoomOut`/`handleZoomFit` all call:
```js
fc.setViewportTransform([next, 0, 0, next, 0, 0]);
```
The `4` and `5` indices of a Fabric.js viewport transform matrix are the x/y pan translation — hard-coding them to `0` on every zoom click **resets pan to origin every time**, regardless of where the user was looking. This is inconsistent with the mouse-wheel/pinch zoom handlers in [DesignCanvas.jsx:120-131](client/src/components/design/DesignCanvas.jsx#L120) and [143-156](client/src/components/design/DesignCanvas.jsx#L143), which correctly use `fc.zoomToPoint(...)` — a proper zoom-around-a-point that preserves relative pan.

**Notes**: Verified this is a **view-only** bug, not data corruption — selected an object before/after and its stored `left`/`top` (X/Y in Props) were unchanged (100, 100 both times). Still a real, disorienting bug matching the report exactly: on any design bigger than what fits at 100% zoom, working in a specific region and then clicking a zoom button yanks the view away from what you were doing. Fix: compute the zoom around the current viewport center (or cursor position) instead of hard-resetting translation to 0.

---

### [Critical] Sidebar panels are not resizable, and the toolbar bleeds/overflows at narrower widths

**Area**: Global editor layout
**Steps to reproduce**:
1. Try to drag the border between the canvas and the right-hand Layers/AI/Props sidebar.
2. Resize the browser window narrower (tested at 900px).

**Expected**: Either the sidebar is resizable (the sibling Proposal Editor already has this — `.editor-resizer` / `.editor-resizer-right`), or at minimum the toolbar wraps/scrolls instead of clipping content off-screen.
**Actual**: 
- Confirmed live: dragging on the sidebar's left edge does nothing at all — no cursor change, no resize.
- Confirmed live at 900px width: the canvas-size dropdown ("Instagram Post 1080×1080") disappeared from view, and the "Use as template" button's text was clipped, bleeding past the right edge of the screen with no scrollbar or wrap to reach it.

**Root cause**: [App.css:7766-7773](client/src/App.css#L7766) hard-codes `.design-sidebar { width: 280px; flex-shrink: 0; }` with no resizer element in the DOM (compare to `.editor-resizer`/`.editor-resizer-right`, which exist for the separate Proposal Editor's panels but were never added here). [App.css:7493-7501](client/src/App.css#L7493) — `.design-toolbar` is a plain `display:flex` row with no `flex-wrap` or `overflow-x`, so its ~9 button groups simply run off the container at any width narrower than they collectively need.

**Notes**: Both are straightforward CSS/layout fixes (add a resizer element matching the Proposal Editor's existing pattern; add `overflow-x: auto` or wrap behavior to the toolbar), not deep architectural problems.

---

### [Minor] Imported layer colors break the Fill color picker

**Area**: Image/PDF → layers import, Props panel Fill swatch
**Steps to reproduce**: Import a page as layers (toolbar "Layers" button → pick a page), select an imported text/shape object, look at the Fill swatch — or just open dev tools console.
**Actual**: Console fills with repeated warnings: `The specified value "rgb(0,0,0)" does not conform to the required format. The format is "#rrggbb"...` — the native `<input type="color">` silently rejects the value and shows a fallback instead of the object's real color.

**Root cause**: [designImport.js:42](client/src/lib/designImport.js#L42) sets `fill: s.fill || s.color || 'rgba(0,0,0,0)'` — these values come from browser color extraction (canvas/DOM APIs), which return `rgb(r,g,b)`/`rgba(...)` strings, not hex. The Props panel's Fill input ([DesignEditor.jsx:1026](client/src/components/design/DesignEditor.jsx#L1026)) binds directly to that raw value with no rgb→hex conversion.
**Notes**: Cosmetic/editing-accuracy issue, not data loss — the object still renders with its real imported color, but a user trying to *edit* that color from the Props panel would be working from a wrong starting swatch. Fix: normalize any `rgb()`/`rgba()` fill to hex before it reaches the color input (a ~5-line utility).

---

## Passed / verified

- **Layer management**: reorder (drag-and-drop), bring-forward/send-backward, visibility toggle, lock/unlock, duplicate (correct +20/+20 offset confirmed), delete — all tested live via the Layers panel and all worked correctly, including staying in sync with canvas selection.
- **Image → layers import pipeline**: opened the import picker, saw all 7 pages of an existing proposal PDF as thumbnails, correctly showed the "canvas already has layers, replace?" confirmation before overwriting (this specific confirm() call couldn't be completed end-to-end in this automated test browser, which suppresses native dialogs, but firing the correct confirmation at the correct moment is itself the correct, expected behavior — not a bug).
- **Add operations**: Add Text, Add Rectangle, Add Circle, Add Image (file picker) all work and correctly register in the layer list.
- **Zoom via scroll wheel / pinch**: correctly zooms around the cursor/pinch-center and preserves pan — this is the *correct* reference behavior the toolbar buttons should be matching but currently aren't (see finding above).
- **Object properties**: position (X/Y), size (Width/Height), rotation, and text-content editing all update the canvas live and correctly round-trip through the Props panel.
- **Basic export**: PNG/SVG export buttons are present and wired to real Fabric.js export calls (`toDataURL`/`toSVG`) — not executed end-to-end since this test browser blocks file downloads, but the code path is sound.

## Coverage notes

- Redo specifically inherits the same root cause as Undo (same no-op wiring) — not re-tested separately since the fix is identical.
- Did not test collaborative/multi-page interactions beyond a single page (page add/duplicate/delete exist and weren't in scope of "standard design operations" per the request).
- Panel-resize and toolbar-overflow findings were tested at one narrower width (900px); the exact breakpoint where the toolbar starts clipping wasn't pinpointed precisely, but the underlying cause (no wrap/scroll at all) means it's not a narrow edge case — it'll clip on any viewport narrower than the toolbar's total content width.

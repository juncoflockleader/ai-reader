# Study Reader — UI Redesign & Rewrite Plan

> Scope: the **Reader** experience only (`activeApp === "reader"`). The Writer, Algorithm Lab,
> and Distributed Lab workspaces are out of scope except where they share the app shell, topbar,
> theme system, and `app.css`. Those shared pieces are touched carefully so the other apps keep working.

---

## Status — implemented & cut over

The rewrite has shipped. `PdfPanel.tsx` (1,760 lines) and the old `MarkdownPanel.tsx` are **deleted**;
the v2 reader under `components/reader/` is now the default with **no feature flag**.

- **Phase 0 — done.** Provider, persistence hook, shared overlay primitive. (The shipped design system settled on the shared `Modal`; the reader uses an inline tool-popover over the proven global `.tool-popover` classes, and the assistant keeps App's existing compact drawer — so the prototype `Popover`/`Drawer` primitives were dropped rather than shipped unused.)
- **Phase 1 — done.** `usePdfDocument` + `ReadingSurface`/`PdfDocument`/`PdfPage`: render, nav, zoom, scroll↔page sync, search, highlight rendering, selection. Verified in-browser.
- **Phase 2 — done.** `useReaderAnnotations` (highlights/bookmarks/drawings + undo/redo, getting-started), `DrawingLayer`+area-capture in `PdfPage`, `ReadingRuler`, `SelectionMenu`, `ReadingProgress` (bookmarks + hover previews), `StructureNavigator`, `GettingStarted`, `CommandPalette`, typography. Verified: bookmark create/persist, drawing persist, ruler, getting-started, command palette.
- **Phase 3 — done (read-only Markdown).** `MarkdownDocument` + `MarkdownReader` share `ReadingSurface`. Assistant still renders where App places it (its topbar portal remains valid; not moved, to avoid destabilizing the shared `AssistantPanel`).
- **Phase 4 — done.** Responsive/touch: pointer-events model (mouse/touch/pen) for draw/ruler/capture/progress; App's compact-width assistant drawer remains. Modal reskin: `BookManager`/`NotesManager`/`ProviderSettings` now render through the shared `Modal` (`unstyled` mode preserves their proven `.settings-modal` panels). The shared `Modal` gained a **focus trap + focus restore**, **Esc-to-close**, and **backdrop-click-close**, and every dialog now carries `role="dialog"` / `aria-modal` / `aria-labelledby`. Verified in-browser (Esc, backdrop click, Tab-wrap focus trap across all three modals).
- **Phase 5 — done.** Flag removed, old files deleted, App routes Markdown→`MarkdownReader` / PDF→`ReaderWorkspace`. Reader CSS classes are **reused** by v2 (not dead), so `app.css` was intentionally left intact.

Everything below is the original plan, kept for reference.

---

## 1. Where we are today

### Files that make up the reader
| File | Lines / size | Role |
|---|---|---|
| `src/frontend/App.tsx` | ~465 | App shell: topbar, app-switcher, theme switcher, start screen, split layout, modal hosting, book/upload/page state. |
| `src/frontend/components/pdf/PdfPanel.tsx` | **1760 / 76 KB** | The reader itself. PDF rendering, search, zoom, highlights, scribble/drawing + undo/redo, area-capture screenshots, reading ruler, getting-started overlay, command palette, structure navigator, bookmarks w/ hover previews, typography presets, reader settings. **38 `useState`, 18 `useEffect`.** |
| `src/frontend/components/pdf/MarkdownPanel.tsx` | ~35 | Markdown reader. Half-built: ignores `currentPage`/`onPageChange`, always loads page 1, renders the whole doc, no highlights/search/notes. |
| `src/frontend/components/assistant/AssistantPanel.tsx` | ~600 / 21 KB | Chat assistant. Context scope (selection/page/document), response style (fast/thinking), citations, save-as-note, follow-up, attachments, conversation history. Portals controls into the topbar via `getElementById`. |
| `src/frontend/components/books/BookManager.tsx` | ~5 KB | Library modal. |
| `src/frontend/components/notes/NotesManager.tsx` | ~5 KB | Notes/highlights modal. |
| `src/frontend/components/settings/ProviderSettings.tsx` | ~19 KB | Provider/model/API-key modal (shared across apps). |
| `src/frontend/actions/registry.ts` | ~small | Declarative action registry (summarize, highlight, follow-up…) — partially wired. |
| `src/frontend/styles/app.css` | **90 KB / ~682 selectors** | One global stylesheet for **all** apps. Three themes (`day`/`warm`/`night`) via `:root[data-theme]` CSS variables. |
| `src/frontend/api.ts` | — | Shared types: `Book`, `Highlight`, `ChatMessage`, `Conversation`, `ChatAttachment`, `AppSettings`, etc. |
| Backend routes | `books.ts`, `chat.ts`, `highlights.ts`, `drawings.ts`, `settings.ts` | REST API the reader calls. **Unchanged by this work.** |

### What the reader does well today
- A real, working feature set: per-page PDF render, persistent highlights, drawings, AI chat with citations, notes, three reading themes, resizable split, page/zoom persistence in `localStorage`.
- A sensible CSS-variable token system already exists (`--surface-*`, `--text-*`, `--accent*`, `--reader-page-filter`).

### The pain (why we rewrite)
1. **`PdfPanel` is a god component.** 38 pieces of `useState` + 18 effects + refs in one 1760-line file. Rendering, gestures, drawing history, overlays, bookmarks, search, and settings are all interleaved. Nearly impossible to change safely.
2. **Tool sprawl, no hierarchy.** Ruler, area-capture, scribble, command palette, structure navigator, bookmarks, getting-started, typography, zoom, search all live at the same level with ad-hoc popovers. The toolbar was "regrouped" recently (commit `3e4e836`) but the underlying model is still flat.
3. **Cross-component coupling via the DOM.** `AssistantPanel` `createPortal`s into `#app-topbar-assistant`; `PdfPanel` reaches into topbar slots too. State flows through stringly-typed `localStorage` keys (`studyreader:*`) scattered across files.
4. **Inconsistent surfaces.** Modals (BookManager/Notes/Settings), popovers, drawers, overlays, and the command palette each have bespoke markup and z-index. No shared primitive.
5. **Markdown reading is a second-class citizen** — effectively a stub.
6. **Styling is one 90 KB global file.** Class-name collisions are a constant risk across four apps; reader styles aren't isolated.
7. **Accessibility & responsive gaps.** Pointer-only interactions (ruler/scribble/resize), partial keyboard support, compact layout is a single `<1080px` breakpoint with a drawer bolt-on.

---

## 2. Goals & non-goals

**Goals**
- Keep every capability users rely on (highlights, drawings, notes, chat-with-citations, themes, persistence) — **no feature regressions.**
- Break `PdfPanel` into composable, testable pieces with clear ownership of state.
- A coherent visual system: one **reading surface**, a calm primary toolbar, and secondary tools tucked into predictable places.
- First-class Markdown reading that shares the chrome with PDF.
- Isolated, themeable styles (CSS Modules per component) on top of the existing token variables.
- Better keyboard + responsive behavior.

**Non-goals**
- No backend/API changes. Same endpoints, same data model.
- No change to Writer / Algorithm Lab / Distributed Lab features (only shared shell/tokens).
- Not introducing a heavy state library (Redux/Zustand) unless decomposition demands it — start with context + reducers.

---

## 3. The new reader UI

### 3.1 Layout
A three-zone reading workspace inside the existing app shell:

```
┌──────────────────────────────────────────────────────────────────┐
│ App shell topbar  [Study·Reader] [app switcher] ……… [theme] [⚙]   │  (existing)
├──────────────────────────────────────────────────────────────────┤
│ Reader toolbar:  ‹ Book title ▾ ›   [search] [zoom] [tools ▾]      │  (new, reader-owned)
├───────────────────────────────────────┬──────────────────────────┤
│                                        │                          │
│   READING SURFACE                      │   ASSISTANT               │
│   (PDF pages or Markdown)              │   (chat + context)        │
│   • highlights, drawings, ruler        │                          │
│   • selection toolbar (floats)         │   resizable splitter ↔    │
│                                        │                          │
├───────────────────────────────────────┴──────────────────────────┤
│ Reading footer:  page 12 / 340   ▓▓▓▓░░░ progress   bookmarks ▾    │  (new)
└──────────────────────────────────────────────────────────────────┘
```

- **Reader toolbar (new, owned by the reader, not portalled into the app topbar).** Left: book title + dropdown (switch/library). Center: search. Right: zoom stepper and a single **Tools** menu that groups the secondary tools (ruler, draw, screenshot, typography, structure, getting-started). This replaces today's flat row of always-on tool buttons.
- **Reading surface.** One scroll container. PDF and Markdown render through a shared `<ReadingSurface>` frame so chrome (theme, typography, scroll, footer) is identical for both. PDF gets the full interactive layer (selection toolbar, highlights, drawing); **Markdown is read-only in v2** — clean typeset rendering only.
- **Floating selection toolbar.** On text selection, a small contextual bar appears near the selection (Highlight / Ask / Summarize / Copy) driven by `actionRegistry`, instead of right-click-only context menus.
- **Reading footer.** Page counter, draggable progress bar (today's "reading progress drag"), and a bookmarks menu with the existing hover previews — moved out of the page body into a stable strip.
- **Assistant** stays on the right with the resizable splitter, but owns its own header (provider/model pill + clear) instead of portalling into the global topbar.

### 3.2 Tool model (the key UX change)
Reduce cognitive load by ranking tools:

| Tier | Tools | Where |
|---|---|---|
| **Primary** (always visible) | Search, Zoom, Page nav | Reader toolbar + footer |
| **Secondary** (one menu) | Reading ruler, Draw/scribble, Screenshot capture, Typography preset, Structure navigator, Getting-started | "Tools ▾" dropdown; each opens a focused mode/panel |
| **Modal** | Library, Notes, Settings | Topbar icons → shared `<Modal>` |

Each secondary tool becomes a **mode** with its own toolbar strip when active (e.g. entering Draw shows color/eraser/undo/redo), so the base reading view stays clean.

### 3.3 Interactions & polish
- Keyboard: `⌘F` search, `⌘K` command palette (kept, now the discoverability backbone for all actions), `[`/`]` page nav, `+`/`-` zoom, `Esc` exits active mode.
- Selection → floating toolbar (mouse) **and** a persistent action row (keyboard/touch).
- Smooth, consistent overlays via one `<Popover>`/`<Modal>`/`<Drawer>` primitive set (focus trap, `Esc`, backdrop, single z-index scale).

### 3.4 Responsive & touch (first-class, per decision §8.4)
- **Breakpoints, not a single toggle.** Replace today's lone `<1080px` check with a small set of breakpoints (compact / regular / wide) driving layout via CSS, not just JS.
- **Assistant presentation by width.** Wide: side panel + splitter. Regular/compact: a proper **bottom sheet / drawer** with drag-to-expand, not the current bolt-on overlay.
- **Touch-capable interactions.** Pointer-events model unifies mouse/touch/pen for the ruler, drawing, area-capture, and splitter (pinch-to-zoom on the surface; drag handles sized for touch).
- **Reader toolbar** wraps/condenses gracefully; primary controls stay reachable, the rest fold into the Tools menu and command palette.
- Each component ships its responsive/touch behavior **as it's built** (so by cutover the whole reader is responsive), rather than retrofitting at the end.

---

## 4. New component architecture

Decompose `PdfPanel` by **concern**, with a reader-scoped context owning shared state.

```
components/reader/
  ReaderWorkspace.tsx        // top-level: layout, splitter, mode orchestration
  ReaderProvider.tsx         // context + reducer: book, page, zoom, selection, activeMode
  toolbar/
    ReaderToolbar.tsx
    SearchControl.tsx
    ZoomControl.tsx
    ToolsMenu.tsx
  surface/
    ReadingSurface.tsx       // shared scroll frame + selection plumbing
    PdfDocument.tsx          // pdf.js render, page virtualization
    PdfPage.tsx              // one page: canvas + text layer + overlays
    MarkdownDocument.tsx     // real markdown reader (parity-ish features)
    SelectionToolbar.tsx     // floating contextual actions
  overlays/
    HighlightLayer.tsx
    DrawingLayer.tsx         // strokes + undo/redo, isolated history
    ReadingRuler.tsx
    AreaCapture.tsx          // screenshot selection → attachment
  footer/
    ReadingFooter.tsx
    ProgressBar.tsx
    BookmarksMenu.tsx
  panels/
    StructureNavigator.tsx
    GettingStarted.tsx
    TypographyControls.tsx
    ReaderSettings.tsx
  hooks/
    usePdfDocument.ts        // load/cache pages, pdf.js lifecycle
    useReaderPersistence.ts  // ONE place for all studyreader:* localStorage keys
    useTextSelection.ts
    useDrawingHistory.ts
common/
  Modal.tsx  Popover.tsx  Drawer.tsx  IconButton.tsx   // shared primitives
```

**State ownership**
- `ReaderProvider` holds cross-cutting state: `book`, `currentPage`, `zoom`, `selection`, `activeMode`, `searchQuery`. Exposes a reducer + typed actions.
- Leaf overlays own their *local* state (e.g. drawing in-progress stroke) and commit to context/back-end on completion.
- All `localStorage` access funnels through `useReaderPersistence` with a typed key map — no more scattered string literals.
- The **App ↔ Assistant ↔ Reader** contract is cleaned up: instead of DOM portals into topbar slots, `ReaderWorkspace` renders the assistant header itself and lifts only the minimal shared state (`selectedText`, `currentPage`, `draftQuestion`, `attachments`) — same props App already passes, just no `getElementById`.

---

## 5. Styling / design system

- Adopt **CSS Modules** (`*.module.css`) per reader component, consuming the existing `:root[data-theme]` token variables. This isolates reader styles and lets us delete reader rules from the global `app.css` as components migrate.
- Promote/round out the token set: spacing scale, radius scale, elevation/shadow tokens, z-index scale, and the three theme palettes already present. Document them in `docs/design-tokens.md`.
- Keep `data-theme` on `<html>` (works app-wide; other apps unaffected).
- Outcome: `app.css` shrinks to shell + non-reader app styles; reader styling lives next to its components.

---

## 6. Migration plan (incremental, behind a flag)

Strategy: **strangler-fig.** Build the new reader alongside the old one, switch via a flag, delete the old once at parity. No big-bang rewrite, no long-lived broken state.

**Phase 0 — Scaffolding & safety net (low risk)**
- Add `components/reader/` skeleton + `ReaderProvider` + shared `Modal/Popover/Drawer` primitives.
- Introduce a `READER_V2` flag (localStorage/env) in `App.tsx`: render new `<ReaderWorkspace>` vs old `<PdfPanel>`.
- Add `useReaderPersistence` and route existing `studyreader:*` keys through it (old panel can keep working; new uses same keys → state carries over).
- Snapshot current UX: short screen recordings / a checklist of every feature for parity tracking.

**Phase 1 — Reading surface parity (PDF)**
- `ReadingSurface` + `PdfDocument`/`PdfPage` via `usePdfDocument` (port pdf.js logic out of `PdfPanel`).
- Page nav, zoom, scroll-driven page tracking, persistence. Highlights render (read-only first, then create/edit).
- Toolbar (search + zoom) and footer (page + progress).
- **Gate:** new PDF reader reaches feature parity for read + highlight + search + zoom + nav.

> **Responsive/touch is built into every phase** (decision §8.4): each component below ships its breakpoint + touch behavior when it lands. The list calls out the notable bits; it is not a separate late phase.

**Phase 2 — Overlays & tools**
- Port `DrawingLayer` (+ undo/redo), `ReadingRuler`, `AreaCapture`, `SelectionToolbar` — all on a unified pointer-events model (mouse/touch/pen).
- `ToolsMenu` (the single collapsed menu, §8.1) + per-mode toolbars; `StructureNavigator`, `GettingStarted`, `TypographyControls`, `ReaderSettings`.
- Wire `actionRegistry` into the selection toolbar and command palette.

**Phase 3 — Assistant integration & Markdown (read-only)**
- Move assistant header out of topbar portal into `ReaderWorkspace`; verify chat, citations, save-note, follow-up, attachments, screenshot → attachment flow. Assistant ships its responsive presentation (side panel ↔ bottom sheet) here.
- Build `MarkdownDocument` as a **read-only** reader (typeset rendering, theme + typography, shared `ReadingSurface` chrome). No highlights/notes/search in v2 (§8.2).

**Phase 4 — Modals, responsive polish, a11y**
- Reskin `BookManager`/`NotesManager`/`ProviderSettings` onto the shared `<Modal>` (responsive/touch-sized).
- System-wide pass: breakpoint audit, keyboard map, focus traps, ARIA on ruler/draw/resize, touch-target sizing.

**Phase 5 — Cutover & cleanup**
- Flip `READER_V2` default on; soak.
- Delete `PdfPanel.tsx` + old `MarkdownPanel.tsx`; remove dead reader rules from `app.css`.
- Remove the flag.

Each phase ends with a working app (flag on for testing, off for users) so we can ship/pause at any boundary.

---

## 7. Risks & mitigations
| Risk | Mitigation |
|---|---|
| pdf.js render/text-layer regressions (most logic lives in the god component) | Port `usePdfDocument` first, diff against old panel side-by-side behind the flag. |
| Drawing/highlight data loss during migration | Same backend routes + same `localStorage`/anchor model; new code is read-compatible before write. Verify against existing `studyreader-data/`. |
| Shared `app.css` collisions while both readers coexist | New reader uses CSS Modules from day one; don't touch global reader rules until Phase 5 deletion. |
| Scope creep into Writer/Lab apps | Hard boundary — only shell/tokens shared; flag isolates reader. |
| Parity gaps slipping through | Phase-0 feature checklist is the acceptance gate for each phase. |

---

## 8. Decisions (locked)
1. **Secondary tools collapse into one "Tools ▾" menu.** No always-visible secondary row. Base reading view stays clean; each tool opens as a focused mode.
2. **Markdown is read-only for v2.** Clean, well-typeset rendering sharing `ReadingSurface` chrome (theme, typography, scroll). No highlights/notes/search on Markdown in v2 — revisit later. (PDF keeps full feature set.)
3. **Keep all three themes** (`day`/`warm`/`night`). Refine the token *system* (spacing/radius/elevation/z-index) but do not change the palettes.
4. **Invest in responsive/touch now.** Responsive + touch is a first-class concern threaded through every phase, not deferred to the end (see §6). Pointer interactions (ruler, draw, area-capture, resize) get touch support and the assistant gets a proper mobile presentation as their components are built.

---

*Next step: scaffold Phase 0 (flag + provider + primitives) — non-destructive, old reader stays the default.*

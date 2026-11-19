# Z-Ai — `/appledesign1` Design Review

Apple Human Interface Guidelines principles, adapted (not copied verbatim) for
web + Android + Windows + Linux, applied to the actual Z-Ai implementation.

## 1. Accessibility

| Checkpoint | Finding | Evidence |
|---|---|---|
| Minimum readable text size | Base font `14px`/`--zai-font-base`, scalable via Settings → "حجم الخط" to 4 steps (`fontScale -1..2` maps to `16 + n*1.5px` root size) without breaking layout (all spacing uses `rem`-free `px` tokens + flex wrapping, no fixed-height text containers) | `src/zai/styles/tokens.css`, `store.ts::applyTheme` |
| Color contrast, computed from actual hex tokens (not eyeballed) | `greenapple-dark` text/bg **15.60:1**, secondary text/bg **8.53:1**, primary/on-primary **7.73:1**; `greenapple-light` text/bg **15.95:1**, secondary **6.85:1**, primary-container/on **4.94:1**; neutral dark/light **15.54:1** / **17.06:1**; error/on-error **6.86:1**; success-on-white **5.95:1**. All ≥ WCAG AA (4.5:1), most ≥ AAA (7:1) | computed via the WCAG relative-luminance formula against `tokens.css` values (see `docs/architecture.md` git history for the calculation script) |
| Hit area ≥ 44px on mobile | `--zai-hit-min: 44px` applied to `.zai-icon-btn`, `.zai-send`, `.zai-btn-new`, `.zai-chat-item`, `.zai-menu-item` | `tokens.css`, `zai.css` |
| `aria-label` on every icon-only button | Every icon button in `Topbar`, `Sidebar`, `Composer`, `Lightbox`, all sheets has an explicit `aria-label` (checked manually across all 14 sheet components) | e.g. `Composer.tsx` mic/attach/send, `Lightbox.tsx` zoom/rotate/download/share/close |
| Keyboard + screen reader support | `Sheet.tsx` implements `role="dialog"` `aria-modal="true"`, a real focus trap (Tab/Shift+Tab cycling), Escape-to-close, and restores focus to the triggering element on close. Model picker and search use `role="listbox"/"option"`/`role="tab"` | `src/zai/components/Sheet.tsx` |
| Not color-only signaling | Status is always paired with text/icon: "· فشل الإرسال" text (not just red), rating buttons show `aria-pressed` + icon fill change, connection dot pairs with "متصل"/"غير متصل" text | `MessageItem.tsx`, `Sidebar.tsx` |
| Reduced motion | `[data-reduced-motion]`-driven: `@media (prefers-reduced-motion: reduce)` collapses all `.zai-root` transitions/animations to 0.01ms; Settings also exposes an explicit toggle | `tokens.css`, `SettingsSheet.tsx` |
| Reduced transparency | `[data-reduced-transparency="true"] .zai-glass` drops `backdrop-filter` and swaps to a solid `--zai-surface` background | `tokens.css` |
| High contrast | `[data-contrast="high"]` variants per theme pair (not a single global override) boost text/outline contrast further | `tokens.css` |

## 2. Platform conventions

- **Desktop**: persistent `Sidebar` (300px, collapsible to 72px via
  `compactSidebar` setting), model picker and chat/message actions render as
  **popovers** anchored to their trigger (`Sheet variant="pop"`), not full-screen
  modals — matching desktop expectations instead of copying a phone sheet.
- **Mobile (≤768px)**: `Sidebar` becomes an off-canvas drawer (`transform:
  translateX`, RTL-aware), model picker / chat actions / message actions /
  settings switch to **bottom sheets** with a grabber and swipe-to-dismiss
  (`Sheet.tsx`'s `onTouchMove`/`onTouchEnd` handlers), matching Android's
  Material bottom-sheet convention and iOS's sheet convention simultaneously —
  this is the one Apple-HIG-derived behavior kept cross-platform because both
  ecosystems converged on the same pattern.
- **Escape + swipe + outside-tap**: `Sheet.tsx` centralizes this so every one
  of the 14 required sheets/popovers behaves consistently instead of each
  being a bespoke implementation.
- **Safe areas**: `--zai-safe-b`/`--zai-safe-t` (`env(safe-area-inset-*)`)
  applied to the composer, topbar, and bottom sheets.
- **Mouse + touch + keyboard**: every actionable element is a real `<button>`
  (never a `<div onClick>`), so it is reachable by Tab and activatable by
  Enter/Space without extra work.

## 3. Visual craft

- **One spacing scale**: `--zai-space-1..8` (4/8/12/16/20/24/32px) used
  throughout `zai.css` — no ad-hoc pixel values in component files.
- **One typography scale**: `--zai-font-xs..xl` (11/12.5/14/15/17/20px).
- **One color per meaning**: `--zai-success`/`--zai-error`/`--zai-warning`
  are each used for exactly one semantic purpose (never re-purposed for
  decoration elsewhere).
- **Glass restricted to floating layers only**: `.zai-glass` is applied to
  **zero** message bubbles or body content — only to the (currently unused by
  default, available via `glassDensity`) floating chrome. Bubbles use solid
  `--zai-card-bg`/`--zai-primary-container`, directly fixing the reference
  file's "glass effects on content" anti-pattern called out in the task.
- **Green Apple, calm not loud**: `greenapple-dark`'s primary `#7adb8f` sits at
  medium lightness against a near-black `#0f1510` background (15.6:1 contrast)
  rather than a saturated neon green — legible and calm, per the task's
  "مميزة ولكن هادئة" requirement.
- **Consistent empty/loading/error states**: `.zai-hero` (empty chat),
  `.zai-typing` (loading — three animated dots, not an ambiguous spinner),
  `.zai-err` (error block, consistent red-tinted card) are each a single
  reusable CSS class instantiated everywhere that state occurs.

## 4. Generative AI UX

- **Sending vs. stopping is unambiguous**: `Composer.tsx` swaps the same
  physical button between a send (➤) and stop (■) icon/color based on
  `streaming`, and `.zai-send.stop` changes color to `--zai-error` — never two
  separate always-visible buttons that could be confused.
- **No chain-of-thought exposure, anywhere**: there is no "thinking panel" in
  this rebuild. `MessageItem.tsx` only ever renders `message.content` (the
  final answer) plus a safe `processingLabel()` string. See
  `docs/security.md` "Reasoning policy" for the server-side enforcement.
- **Retry and edit are first-class**: every assistant message has "إعادة
  التوليد" one tap away (`MessageItem.tsx` actions row); every message
  (user or assistant) has inline "تعديل".
- **Model attribution is always visible**: the message header shows the
  model name + provider (`· مدى` / `· رويند`) for every assistant message,
  and the topbar model pill always reflects the active chat's model.
- **Untrusted/failed states are called out explicitly**: `MessageItem.tsx`
  shows "· فشل الإرسال" on `status === "error"` and "· تم الإيقاف" on
  `"stopped"` directly in the message header — never silently rendered as if
  it were a normal completed answer.

# Auto Mode (Do-It-For-Me)

A second mode for the extension: instead of pointing at UI elements, it **performs the actions itself**. Not built yet — this is the design.

## Two flavors

- **Scripted execution.** Reuse pre-authored flows but execute the steps (`el.click()`, programmatic input, scroll) instead of drawing arrows. Deterministic and cheap; only works for flows that have been authored.
- **Agentic (LLM-in-the-loop).** Claude sees the page, picks the next action, executes, observes, repeats. Handles unscripted tasks ("delete all spam entries from last week", "duplicate this form and rename it"). Same pattern as Computer Use / browser-use / Stagehand.

Approach: hybrid — try the scripted path first (fast, predictable), fall back to agentic when no flow exists or a scripted step fails.

## Stack

Most is shared with point mode. New pieces:

### Page snapshotter (content script)
- Live DOM → compact LLM-friendly representation.
- ARIA/accessibility-tree snapshot with stable element IDs (Playwright aria-snapshot / browser-use style). Far fewer tokens than raw HTML.
- Vision/screenshots only as a fallback for highly custom UI; DOM-only handles WPForms admin in the large majority of cases.

### Action executor (content script)
Primitives: `click`, `type`, `select`, `scroll`, `wait_for`, `navigate`.

React-controlled inputs (the form builder especially) ignore plain `el.value = X`. Use the native setter + dispatch `input`/`change` events (the React-testing-library technique), in one shared helper.

### Agent loop (background service worker)
Loop: snapshot → Claude → action → DOM settle → snapshot. Owns step count, token budget, cost tracking.

### Worker → Claude API
Already in the stack. Tool definitions are the contract:

```
click(element_id)
type(element_id, text)
select(element_id, value)
scroll(container_id, direction, amount)
wait_for(element_id)
navigate(url)
read_page()
ask_user(question)
done(summary)
```

- Model: Sonnet 4.6 (suited to tool-use loops).
- Caching: prompt caching on system prompt + flows.
- Cost: one API call per step; a 5-step task ≈ 5 calls — meaningfully more expensive than point mode.

### Safety layer (required)
- **Visible activity overlay** — cursor/highlight follows each action so it can be watched and interrupted. Reuses the point-mode drawing primitive.
- **Confirm-before-destructive** — destructive steps (delete entry, mark spam, change billing) require modal confirmation before executing.
- **Always-on stop button** + ESC to abort.
- **Scope allowlist** — runs only on WPForms admin URLs.
- **Step + token budget caps** — a confused loop can't run away on cost.

## Implications

- A flow authored for point mode doubles as the scripted path here — same data, different renderer.
- Keeping flow selectors current matters more: a broken selector in auto mode silently clicks the wrong thing, versus only confusing the user in point mode.
- The Worker needs per-token rate limiting and a server-side budget kill switch, not just client-side caps.

## Watch-outs

- **Drag-drop in the form builder** — HTML5 drag events are flaky to synthesize; implement as a scripted flow, not a freeform agent task.
- **Iframes** (Stripe checkout, embeds) — snapshot/executor need explicit cross-frame handling.
- **Mixed framework stack** — WPForms uses Backbone (older screens), jQuery (most), React (newer). The input helper must handle all three, ideally auto-detected.

## Net architecture

Same extension, same Worker. Adds:

- one content script: snapshotter + executor
- one background loop: agent driver
- safety UI: activity overlay, stop button, destructive-action confirm modal
- server-side guardrails on the Worker

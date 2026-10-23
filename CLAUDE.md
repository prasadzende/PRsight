# PRsight

(Formerly "PR Graph": internal IDs such as the data folder, `pr-graph.sqlite`, `prgraph.*` localStorage keys and `PRGRAPH_*` variables keep the old name on purpose.)

Electron desktop app (macOS HIG layout, adapted for Windows) that builds an evidence-backed file dependency graph and review report for a set of open GitHub PRs.

## Stack
Electron + electron-vite, TypeScript strict, React, Tailwind + Radix UI (dialog, popover, switch), React Flow, TanStack Query, Zustand, SQLite (better-sqlite3) + Drizzle, Zod, MSAL (Entra ID), electron-builder. Package manager: pnpm.

## Layout
- src/main/        main process: window, menus, IPC handlers, GitHub client, boards, AI providers, safeStorage, SQLite, host allow-list (net.ts)
- src/preload/     contextBridge API; the only surface the renderer sees (no dependencies: sandboxed)
- src/renderer/    React UI: sidebar, PR list, PR details, report (Start Here, Story, Files, links, findings), inspector, settings
- src/worker/      utilityProcess entry that runs the analysis
- src/shared/      domain model, Zod IPC schemas, channel names
- src/analysis/    rule engine: diff, classify, tickets, links, findings, teamRules, report
- tests/golden/    invented fixtures (acme-org: config#14, lib#18, gateway#34, acme-platform#50, ticket 424242) and expected results; regenerate with scripts/make-golden-fixtures.py. Never commit snapshots of real company PRs.

## Rules
- GitHub writes are limited to the comment, reply and create-review endpoints (allow-listed in github.ts ghSend) and the resolveReviewThread / unresolveReviewThread mutations, each called only from an explicit Reply, Comment, Submit Review or Resolve click. No other write, ever.
- All network calls from the main process go through net.ts safeFetch (host allow-list). The renderer has no network: CSP plus a request blocker.
- Renderer: contextIsolation and sandbox on, nodeIntegration off, strict CSP, no remote content.
- Every IPC channel is declared in src/shared/ipc.ts and validated with Zod in main; keep src/shared/channelNames.ts in step (a unit test checks it).
- Every Link and Finding carries evidence {path, line, snippet}. Drop AI output that cites a path not in the PRs.
- AI replies are typed data models in src/main/ai/schema.ts (Zod, the TypeScript counterpart of Pydantic): the same model gives the JSON Schema sent to the provider and the strict validation of the reply, with one repair retry. Change the model there, never parse AI output ad hoc.
- Every prompt sent to a model lives in src/main/ai/prompts.config.ts (system prompts, repair prompt, tool name and description, CLI schema wrapper, Test Connection). Never write prompt text inline in code; use PROMPTS and fill() for {{placeholders}}.
- Parsers decide links; AI only explains and ranks. Mark AI text with the AI badge in the UI. AI is off by default; every report must be complete without it.
- Run src/main/ai/redact.ts on all text before any AI call. Never log tokens, keys or file contents.
- Never build a Claude.ai login or read Claude Code's stored credentials; the subscription path runs the unmodified `claude` CLI.
- Tokens and keys go in safeStorage only. Never commit .env files or real IDs in fixtures.
- No notifications or toasts: results appear in place.
- Commands: pnpm lint, pnpm typecheck, pnpm test, pnpm test:golden, pnpm e2e, pnpm package. All must pass before you finish a task.
- Show a plan before changing files; keep PRs under ~400 lines where possible.

# Design notes

What v1 includes, and where it takes a simpler route than a full build would.

## Done in v1
- Phase 0: electron-vite + TS + React + Tailwind/Radix, typed IPC with Zod, CSP and renderer network block, macOS hiddenInset + vibrancy / Windows title bar overlay + Mica, SQLite + Drizzle, safeStorage, lint/test/CI, electron-builder.
- Phase 1: GitHub device flow (+ gh CLI and token sign-in for testing), PR list with All / Assigned to Me / My Team / Opened by Me / Drafts, Open/Closed and search, PR details with review threads (code from `diff_hunk`, Outdated tag), replies, comments, Review (Comment / Approve / Request changes, disabled on your own and closed PRs), Select Related (enabled only when a PR is ticked).
- Phase 2: snapshots with ETag caching, rule engine (renames, old names still in use, record contracts, config feeding modules, shared limits and names, docs), findings from Copilot/Wiz and rules, team rules from AGENTS.md / CLAUDE.md / copilot-instructions.md, ticket fit, impact type, risk (commit history), hygiene, golden tests from four invented PRs.
- Phase 3: Start Here, Story view with tour, Files view (React Flow) with file-type filter, overlays (Tests, Change Type, Since Last Review, Risk, Ticket Fit), grouped findings (Blocking / Should fix / Nice to have / Verified), links with impact, checklist with Person only items, tickets, inspector with diffs, review memory.
- Phase 4/4b: AI providers (Claude Code CLI, Foundry and Azure OpenAI via Entra ID, Anthropic, OpenAI, Gemini, Bedrock, Vertex), redaction, cited-path check, AI badges; Azure DevOps (Entra) and Jira (API token) read-only connectors.
- Phase 5: Settings (General, Accounts, Boards, AI, Privacy & Data), host allow-list, data age pruning, per-store clear, Delete All Local Data, update check setting.

## Simpler choices in v1
- GitHub: `fetch` for REST and GraphQL instead of Octokit (same ETag caching; keeps the main process free of ESM-only packages).
- Parsing: in-house diff and token extractors instead of tree-sitter, yaml, ajv and fast-xml-parser. They cover the golden tests; add a real parser per file type when a rule needs structure.
- Diff view: a small built-in renderer instead of Monaco (Monaco needs web workers and would fight the strict CSP).
- Files map: a fixed column layout in data-flow order instead of ELK.
- Jira: Atlassian API token instead of OAuth 3LO; Azure DevOps via REST instead of azure-devops-node-api.
- AI: plain `fetch` for Anthropic, OpenAI, Gemini, Azure OpenAI and Foundry; SDKs only for Bedrock and Vertex (optional dependencies).

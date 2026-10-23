# Contributing to PRsight

Thanks for helping. This guide covers how to set up the project, how the code is organised, and what a pull request needs before it can be merged.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug:** open an issue with the bug report form. Steps to reproduce help most.
- **Suggest a feature:** open an issue with the feature request form. Describe the problem before the solution.
- **Improve the docs:** typos and unclear steps are worth a PR on their own.
- **Write code:** look for issues labelled `good first issue` or `help wanted`. For anything large, open an issue first so we can agree on the approach before you spend time on it.

Found a security problem? Don't open a public issue. Follow [SECURITY.md](SECURITY.md) instead.

## Set up

You need Node 22 or later (see `.nvmrc`), and pnpm, which you get with `corepack enable`.

```bash
git clone https://github.com/<you>/prsight.git
cd prsight
pnpm install      # also rebuilds better-sqlite3 for Electron
pnpm dev          # runs the app with hot reload
```

To sign in during development, the quickest route is **Use My GitHub CLI Sign-In** (after `gh auth login`), or a fine-grained personal access token.

## Before you open a pull request

All of these must pass. CI runs them on macOS and Windows.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

UI changes should also pass `pnpm e2e`.

## How the code is organised

| Folder | What lives there |
|---|---|
| `src/main/` | Electron main process: window, menus, IPC handlers, GitHub client, boards, AI providers, settings and secrets, SQLite, network allow-list (`net.ts`) |
| `src/preload/` | The bridge the window uses. It's sandboxed and has no dependencies. |
| `src/renderer/` | The React UI |
| `src/worker/` | The background process that runs the analysis |
| `src/analysis/` | The rule engine. It's pure TypeScript with no Electron and no network, so it's easy to test. |
| `src/shared/` | The domain model (`model.ts`) and the typed IPC channels (`ipc.ts`) |
| `tests/` | Unit tests, golden tests and the e2e smoke test |

## Rules the code follows

These protect users' data and accounts, so PRs that break them can't be merged.

- **Network:** every request from the main process goes through `safeFetch` in `src/main/net.ts`, which checks a host allow-list. The renderer has no network at all, enforced by CSP and a request blocker. Don't add remote content to the window.
- **IPC:** every channel is declared in `src/shared/ipc.ts` and validated with Zod in the main process. Keep `src/shared/channelNames.ts` in step; a unit test checks it.
- **GitHub writes:** only comments, replies, reviews and resolving or unresolving review threads. Each one runs only after an explicit click. Don't add other write calls.
- **Secrets:** tokens and keys are stored only through `safeStorage`, which uses the system keychain. Never log tokens, keys or file contents.
- **AI is optional:** every report must be complete without it.
  - Run text through `src/main/ai/redact.ts` before any AI call.
  - Prompts live in `src/main/ai/prompts.config.ts`, not inline in code.
  - AI replies are validated against the Zod models in `src/main/ai/schema.ts`.
  - Mark AI text in the UI with the AI badge.
- **Evidence:** parsers decide links; AI only explains them. Every link and finding carries evidence (path, line, snippet).
- **Renderer settings:** `contextIsolation` and `sandbox` stay on, `nodeIntegration` stays off, and the strict CSP stays.

## Tests

- **Unit tests** (`tests/*.test.ts`) cover the analysis, settings, schemas and redaction.
- **Golden tests** (`tests/golden/`) run the full report on four PRs and pin the links and findings a reviewer relies on.
  - The fixtures are **invented** (`acme-org`, ticket 424242). Never add snapshots of real PRs from your employer or anyone else's private repos.
  - To change a fixture, edit `scripts/make-golden-fixtures.py` and regenerate: `python3 scripts/make-golden-fixtures.py tests/golden/fixtures`.
- If you add a rule to `src/analysis/`, add a test that shows it firing and one that shows it staying quiet.

## Style

- TypeScript in strict mode. Prettier settings are in `.prettierrc`: single quotes, 160 columns. Run `pnpm format` before committing.
- Keep PRs focused, and under about 400 changed lines where you can. Split big changes.
- **UI text** should be plain and short:
  - Sentence-case headings, Title Case buttons and menu items.
  - Results appear in place. No pop-up notifications.
- Commit messages: a short summary line in the imperative mood ("Add Jira ticket links"), then any detail below it.

## Pull request checklist

- [ ] Lint, typecheck, test and build pass
- [ ] Tests added or updated for the change
- [ ] Docs or README updated if behaviour changed
- [ ] No secrets, tokens, real company data or personal paths in the diff
- [ ] Screenshots for UI changes

## Licence

By contributing, you agree that your contributions are licensed under the [MIT Licence](LICENSE).

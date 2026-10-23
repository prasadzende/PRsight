<p align="center">
  <img src="build/icon.svg" width="96" height="96" alt="PRsight icon">
</p>

<h1 align="center">PRsight</h1>

<p align="center">
  Review related pull requests together: see how changes across PRs and repos connect,<br>
  what must ship together, and what to check before you approve.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-blue.svg"></a>
  <img alt="macOS and Windows" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg">
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg">
</p>

---

A single change often spans several pull requests: a config repo, a library, a service and a doc. GitHub shows each PR on its own, so the connections between them live in the reviewer's head. PRsight puts them side by side.

Pick the PRs that belong together and PRsight builds a report from rules, with no AI needed. AI explanations are optional and off by default.

## Features

- **Report:** a verdict and progress bar, a summary of what changes, risks grouped by severity, and a review checklist with blockers first.
- **File Map:** a graph of the changed files across all PRs, with the cross-PR links drawn between them.
- **Cross-PR links**, each backed by the exact file and line:
  - the same rename in two PRs, which must ship together
  - an old name still in use somewhere else
  - record contracts between a writer and a reader
  - config that feeds a module
  - limits and names that are shared
  - docs that describe the change
- **Findings:** comments from Copilot and other AI reviewers, scanner results (Wiz, Snyk, Sonar and others) and the app's own rules, such as large limit changes or logic changed without a test.
- **Team rules:** checks drawn from `AGENTS.md`, `CLAUDE.md` and `.github/copilot-instructions.md` in each repo.
- **PR hygiene:** empty or template-only descriptions, unticked checklists, descriptions that are out of date, and titles that break the repo's style.
- **Changes tab:** a GitHub-style diff with line comments, pending reviews, Reply and Resolve.
- **Tickets:** finds Azure DevOps (`AB#123`) and Jira (`KEY-123`) tickets in titles, branches and commits, and can show their details.
- **Optional AI:** plain-language explanations from your choice of provider, clearly labelled as AI.

## Install

There are no prebuilt downloads yet. Build it from source:

```bash
git clone https://github.com/<your-username>/prsight.git
cd prsight
corepack enable      # gives you pnpm
pnpm install         # also rebuilds the native SQLite module for Electron
pnpm dev             # starts the app with hot reload
```

You need Node 22 or later. To build an installer, run `pnpm package:mac` or `pnpm package:win`. Builds are unsigned unless you set up code signing (see below), so macOS and Windows will warn the first time you open them.

## Sign in

**GitHub**, any one of:
- **Use My GitHub CLI Sign-In:** reuses `gh auth login`. This is the quickest way to start.
- **A personal access token.** A fine-grained token with read access to the repos, plus Pull requests: read & write if you want to comment.
- **Sign In with GitHub (device flow):** needs a GitHub App client ID (see [Your own GitHub App](#your-own-github-app)).

Set an organisation in **Settings › Accounts** to list its PRs and repos. Leave it blank to use your own account.

**Tickets (optional)**, in **Settings › Boards**:
- **Azure DevOps:** your Azure CLI sign-in (`az login`), a personal access token, or an Entra app registration.
- **Jira:** your site and an API token.

**AI (optional)**, in **Settings › AI**. Choose one provider:

| Provider | What it needs |
|---|---|
| Claude subscription (Claude Code) | The `claude` CLI, signed in. No API key. |
| Anthropic API, OpenAI, Google Gemini | Your API key |
| Claude in Microsoft Foundry, Azure OpenAI | Your endpoint and API key |
| Amazon Bedrock | Your AWS credentials (profile or SSO) |
| Google Vertex AI | Google Cloud application default credentials |

## Privacy and security

- **Your data stays on your computer.** Reports, cache and settings are kept in a local SQLite database. Tokens and keys are encrypted with the macOS Keychain or Windows DPAPI.
- **Network calls are limited.** Only the main process makes requests, and only to an allow-list of hosts: GitHub, your boards and your chosen AI provider. The window itself can't reach the network at all.
- **AI is off by default.** When you turn it on, tokens, keys, IDs and email addresses are removed before anything is sent. Every report is complete without AI.
- **GitHub writes happen only when you click.** The app posts comments, replies and reviews and resolves threads only when you press that button. It never writes anything else.
- **No telemetry.** Update checks are off unless you set an update feed.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Your own GitHub App

To use **Sign In with GitHub**, register a GitHub App and turn on device flow. It needs these permissions:

- **Read:** Contents, Metadata, Checks and Members
- **Read & write:** Pull requests and Issues

Put its client ID in **Settings › Accounts**, or in the `PRGRAPH_GITHUB_CLIENT_ID` environment variable. Installing the App on an organisation needs an owner of that organisation to approve it.

## Development

| Command | What it does |
|---|---|
| `pnpm dev` | Run the app with hot reload |
| `pnpm test` | Unit tests and golden tests |
| `pnpm typecheck` | TypeScript, for the main process and the renderer |
| `pnpm lint` | ESLint |
| `pnpm e2e` | Build, then run the Playwright smoke test |
| `pnpm package:mac` / `pnpm package:win` | Build an installer |

```
src/main/       main process: window, menus, IPC, GitHub client, boards, AI providers, storage, network allow-list
src/preload/    the bridge the window uses (the only API it can see)
src/renderer/   React UI: sidebar, PR list, PR details, report, file map, changes, settings
src/worker/     background process that runs the analysis
src/analysis/   the rule engine: diff parsing, classification, tickets, links, findings, team rules, report
src/shared/     domain model and typed IPC schemas
tests/          unit tests and golden tests (with invented fixtures)
```

[docs/design.md](docs/design.md) explains how the app is built and the choices behind it.

### Code signing

- **macOS:** an Apple Developer ID. Set `notarize: true` in `electron-builder.yml`.
- **Windows:** an Authenticode certificate.

## Contributing

Bug reports, ideas and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) to get started, and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

[MIT](LICENSE) © 2026 Prasad Zende

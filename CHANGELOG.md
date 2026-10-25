# Changelog

Notable changes to PRsight. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Setup wizard:** after you sign in, PRsight walks you through AI (provider, model and a connection test), then a ticket board (Azure DevOps or Jira). You can skip any step, or skip setup. Run it again from Settings › General or **Set Up PRsight…** in the menu.
- **Model lists update by themselves:** they reload when you save a key or change an endpoint, region or project, each time Settings or setup opens, and every 30 minutes. Microsoft Foundry now loads its list from your endpoint when it can. A saved model the provider no longer offers is flagged.
- **Report tab, redesigned:** a card per PR with a Review button; findings grouped as Blocking, Should fix, Check and FYI, each opening with its code, why it matters, file risk, tests and ticket fit; a checklist per PR built from its open issues (including failing checks), ending with Request changes or Approve, pre-filled.
- **Prebuilt downloads:** for macOS (Apple Silicon and Intel) and Windows, published to GitHub Releases on every push to `main`.
- **In-app updates:**
  - The app checks for new versions at launch and on a schedule, and shows a bar when one is available.
  - On Windows it downloads and installs with one click. On a Mac it opens the new release for download.
  - **Check for Updates…** is in the app menu, and Settings › Privacy & Data shows your version and has a Check Now button.

## [0.1.0] - 2026-10-24

First public release.

### Added
- **Pull requests:** pick related PRs across repos and build a rule-based report: a verdict, what changes, risks and a review checklist.
- **Analysis:** a File Map of changed files, with cross-PR links backed by file and line evidence.
- **Findings:** from AI reviewers, scanners, rules, team rule files and PR hygiene checks.
- **Changes tab:** a GitHub-style diff with line comments, pending reviews, replies, and Resolve / Unresolve Conversation.
- **Tickets:** Azure DevOps and Jira ticket detection and details.
- **Optional AI explanations:** Claude Code, Anthropic, OpenAI, Gemini, Microsoft Foundry, Azure OpenAI, Bedrock and Vertex.
- **Security:** a local-first design with encrypted secrets, a network allow-list and a renderer with no network access.

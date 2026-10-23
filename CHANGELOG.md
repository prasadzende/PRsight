# Changelog

Notable changes to PRsight. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

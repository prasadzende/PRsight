# Security policy

PRsight handles GitHub tokens and, when you turn them on, Azure DevOps, Jira and AI provider credentials. Security reports are taken seriously.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through GitHub's private vulnerability reporting: go to the **Security** tab of this repository, then **Report a vulnerability**, or use [this link](../../security/advisories/new).

Please include:

- what the problem is and what an attacker could do with it
- steps to reproduce, or a proof of concept
- the PRsight version (or commit) and your operating system

You'll get a reply within 7 days. Once the problem is confirmed, a fix will be prepared and released, and you'll be credited in the advisory unless you'd rather not be.

## Supported versions

Only the latest release gets security fixes. Until there's a 1.0, that means the latest `0.x` release and `main`.

## How PRsight protects your data

These are the controls a report might show to be broken:

- **Secrets:** tokens and keys are encrypted with the system keychain (Electron `safeStorage`: the macOS Keychain or Windows DPAPI). They're never written to plain files or logs.
- **Network:** only the main process makes requests, through `safeFetch` in `src/main/net.ts`, which checks a host allow-list. The window has no network access, enforced by a strict CSP and a request blocker.
- **Renderer isolation:** `contextIsolation` and `sandbox` are on and `nodeIntegration` is off. The window can only call the typed IPC channels in `src/shared/ipc.ts`, and every one of them is validated with Zod.
- **GitHub writes:** only comments, replies, reviews and resolving or unresolving review threads, each run only after an explicit click.
- **AI:** off by default. When it's on, text is redacted before sending (tokens, keys, IDs and email addresses are removed), and replies are validated against strict schemas.
- **Updates:** the app reads the latest GitHub Release of this repository. On Windows, electron-updater checks the downloaded installer against the SHA-512 in the release's `latest.yml` before running it. Nothing downloads or installs without a click.
- **Local data:** reports and cache are kept in a local SQLite database. You can clear them in **Settings › Privacy & Data**.

## Out of scope

- Problems that need an attacker to already control your computer or your user account
- Vulnerabilities in GitHub, Azure DevOps, Jira or AI providers themselves (report those to the vendor)
- Unsigned development builds showing operating-system warnings

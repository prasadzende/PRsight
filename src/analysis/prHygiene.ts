// Checks on a PR's title and description: empty or template-only descriptions, unticked checklists,
// descriptions not edited since new commits, and titles that break the team's rules.
// Pure: the caller fetches the template, rule files, recent titles and commit dates.

export interface HygieneInput {
  title: string;
  body: string;
  branch: string;
  draft: boolean;
  /** The repo's pull request template, if it has one. */
  template: { path: string; text: string } | null;
  /** Team rule files (AGENTS.md, CLAUDE.md, .github/copilot-instructions.md). */
  rules: Array<{ path: string; text: string }>;
  /** Titles of recent PRs in the repo, to learn its title style. */
  recentTitles: string[];
  /** When the description was last edited (null: never edited since the PR was opened). */
  lastEditedAt: string | null;
  createdAt: string;
  commits: Array<{ date: string; message: string }>;
  ticketInTitle: boolean;
  ticketAnywhere: boolean;
}

export interface HygieneCheck {
  id: string;
  area: 'title' | 'description';
  level: 'warn' | 'info';
  text: string;
  source: string;
}

export const CONVENTIONAL_RE = /^(feat|fix|chore|docs|refactor|test|tests|ci|build|perf|style|revert)(\([^)]+\))?!?:\s+\S/i;
const GENERIC_RE = /^(wip|update[sd]?|fix(es|ed)?|changes?|minor|misc|tests?|tmp|temp|draft|stuff|tweaks?|cleanup|pr)\b[\s.:!-]*$/i;
const WIP_RE = /^\s*(\[?wip\]?|\[?draft\]?|do not merge|dnm)\b/i;

/** Text a reader sees: no HTML comments, tags or extra whitespace. */
export function visibleText(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\r/g, '');
}
const norm = (s: string) => visibleText(s).toLowerCase().replace(/[`*_>#\-[\]()]/g, ' ').replace(/\s+/g, ' ').trim();

/** Lines of the description that are not just copied from the template. */
function addedText(body: string, template: string): string {
  const t = new Set(visibleText(template).split('\n').map(norm).filter(Boolean));
  return visibleText(body).split('\n').map(norm).filter((l) => l && !t.has(l) && !/^\s*(x|\s)?\s*$/.test(l)).join(' ');
}

/** Template headings whose section is still empty in the description. */
function emptySections(body: string, template: string): string[] {
  const heads = [...visibleText(template).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim());
  if (!heads.length) return [];
  const tLines = new Set(visibleText(template).split('\n').map(norm).filter(Boolean));
  const lines = visibleText(body).split('\n');
  const out: string[] = [];
  for (const h of heads) {
    const i = lines.findIndex((l) => /^#{1,6}\s+/.test(l) && norm(l) === norm(`# ${h}`));
    if (i < 0) continue;
    let j = i + 1;
    let content = '';
    while (j < lines.length && !/^#{1,6}\s+/.test(lines[j])) {
      const n = norm(lines[j]);
      if (n && !tLines.has(n)) content += n;
      j++;
    }
    if (content.replace(/\b(n\/?a|none|tbc|tbd)\b/g, '').trim().length < 3) out.push(h);
  }
  return out;
}

/** What the team rules say about titles and descriptions. */
export function rulesAbout(rules: HygieneInput['rules']): { conventional?: string; ticketInTitle?: string; ticketLinked?: string } {
  const out: { conventional?: string; ticketInTitle?: string; ticketLinked?: string } = {};
  for (const r of rules) {
    const t = r.text;
    if (!out.conventional && (/conventional[\s-]commits?/i.test(t) || /(pr|pull request)\s+titles?[^.\n]{0,80}(feat|fix)(\(|:)/i.test(t))) out.conventional = r.path;
    if (!out.ticketInTitle && (/(pr|pull request)\s+titles?[^.\n]{0,100}(ticket|work item|AB#|jira|story)/i.test(t) || /(ticket|work item|AB#|jira)[^.\n]{0,60}\b(in|to)\s+the\s+(pr\s+|pull request\s+)?title/i.test(t))) out.ticketInTitle = r.path;
    if (!out.ticketLinked && /(link|reference|include)[^.\n]{0,40}(ticket|work item|AB#|jira|story)/i.test(t)) out.ticketLinked = r.path;
  }
  return out;
}

export function checkPrHygiene(i: HygieneInput): HygieneCheck[] {
  const out: HygieneCheck[] = [];
  const add = (c: HygieneCheck) => out.push(c);
  const body = i.body ?? '';
  const seen = visibleText(body).replace(/\s+/g, ' ').trim();
  const rules = rulesAbout(i.rules);

  // ---- Description ----
  if (!seen) {
    add({ id: 'desc-empty', area: 'description', level: 'warn', text: 'No description. Reviewers have nothing to go on but the diff.', source: 'PR hygiene' });
  } else {
    let templated = false;
    if (i.template) {
      const extra = addedText(body, i.template.text);
      if (extra.length < 30) {
        templated = true;
        add({ id: 'desc-template', area: 'description', level: 'warn', text: 'Still the PR template: nothing has been filled in.', source: i.template.path });
      } else {
        const empty = emptySections(body, i.template.text);
        if (empty.length) add({ id: 'desc-sections', area: 'description', level: 'warn', text: `Template sections left empty: ${empty.join(', ')}.`, source: i.template.path });
      }
    }
    if (!templated && seen.length < 40) add({ id: 'desc-short', area: 'description', level: 'warn', text: 'The description is very short. Say what changes, why, and how it was tested.', source: 'PR hygiene' });
    const open = (body.match(/^\s*[-*]\s+\[ \]/gm) ?? []).length;
    const done = (body.match(/^\s*[-*]\s+\[[xX]\]/gm) ?? []).length;
    if (open > 0) add({ id: 'desc-checklist', area: 'description', level: done === 0 ? 'warn' : 'info', text: done === 0 ? `None of the ${open} checklist items are ticked.` : `${open} of ${open + done} checklist items are not ticked.`, source: i.template?.path ?? 'PR description' });
  }
  if (!i.ticketAnywhere && rules.ticketLinked) add({ id: 'desc-ticket', area: 'description', level: 'warn', text: 'No ticket is linked, and the team rules ask for one.', source: rules.ticketLinked });

  const edited = Date.parse(i.lastEditedAt ?? i.createdAt);
  const after = i.commits.filter((c) => Date.parse(c.date) > edited + 60_000 && !/^Merge (branch|remote-tracking|pull request)/.test(c.message));
  if (seen && after.length) {
    const when = new Date(edited).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    add({ id: 'desc-stale', area: 'description', level: after.length >= 3 ? 'warn' : 'info', text: `${after.length} commit${after.length === 1 ? '' : 's'} pushed since the description was ${i.lastEditedAt ? 'last edited' : 'written'} (${when}). Check it still matches the changes.`, source: 'Commit history' });
  }

  // ---- Title ----
  const title = i.title.trim();
  const bare = title.replace(CONVENTIONAL_RE, (m) => m.replace(/^[^:]+:\s*/, '')).replace(/\b(AB#\d+|[A-Z][A-Z0-9]+-\d+)\b/g, '').replace(/[[\]():\s-]+/g, ' ').trim();
  if (GENERIC_RE.test(bare) || bare.length < 8) add({ id: 'title-generic', area: 'title', level: 'warn', text: 'The title is too short or generic to say what the change does.', source: 'PR hygiene' });
  const branchTail = i.branch.split('/').pop() ?? i.branch;
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (branchTail && (flat(title) === flat(branchTail) || flat(title) === flat(i.branch))) add({ id: 'title-branch', area: 'title', level: 'warn', text: 'The title is just the branch name. Describe the change instead.', source: 'PR hygiene' });
  if (WIP_RE.test(title) && !i.draft) add({ id: 'title-wip', area: 'title', level: 'warn', text: 'The title says WIP / draft, but the PR is open for review. Mark it as a draft or update the title.', source: 'PR hygiene' });
  if (rules.ticketInTitle && !i.ticketInTitle) add({ id: 'title-ticket', area: 'title', level: 'warn', text: 'The team rules ask for the ticket number in the title.', source: rules.ticketInTitle });

  const conv = i.recentTitles.filter((t) => CONVENTIONAL_RE.test(t)).length;
  const repoStyle = i.recentTitles.length >= 5 && conv / i.recentTitles.length >= 0.6;
  if ((rules.conventional || repoStyle) && !CONVENTIONAL_RE.test(title)) {
    add({ id: 'title-conventional', area: 'title', level: 'warn', text: `The title doesn’t follow the “type: summary” style (for example “feat: …” or “fix(api): …”)${rules.conventional ? ' the team rules ask for' : ` used by ${conv} of the last ${i.recentTitles.length} PRs in this repo`}.`, source: rules.conventional ?? 'Recent PR titles' });
  }
  if (title.length > 100) add({ id: 'title-long', area: 'title', level: 'info', text: `The title is ${title.length} characters. Keep it under about 72 so it reads well in lists and merge commits.`, source: 'PR hygiene' });
  return out;
}

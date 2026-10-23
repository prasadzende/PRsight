import { describe, expect, it } from 'vitest';
import { checkPrHygiene, type HygieneInput } from '../src/analysis/prHygiene';

const base: HygieneInput = {
  title: 'feat(gateway): add per-project token limits',
  body: '## What\nAdds token and call limits to the gateway entitlement module so every project gets a cap.\n\n## Testing\nterraform test passes for all fixtures.',
  branch: 'feature/token-limits',
  draft: false,
  template: { path: '.github/pull_request_template.md', text: '## What\n<!-- describe the change -->\n\n## Testing\n<!-- how did you test it -->\n\n- [ ] Docs updated' },
  rules: [],
  recentTitles: [],
  lastEditedAt: null,
  createdAt: '2026-10-20T10:00:00Z',
  commits: [{ date: '2026-10-20T09:00:00Z', message: 'Add limits' }],
  ticketInTitle: false,
  ticketAnywhere: true,
};
const ids = (i: Partial<HygieneInput>) => checkPrHygiene({ ...base, ...i }).map((c) => c.id);

describe('PR title and description checks', () => {
  it('passes a filled-in description and a clear title', () => {
    expect(ids({})).toEqual([]);
  });
  it('flags an empty description and an untouched template', () => {
    expect(ids({ body: '' })).toContain('desc-empty');
    expect(ids({ body: base.template!.text })).toContain('desc-template');
  });
  it('flags template sections left empty and unticked checklists', () => {
    const r = ids({ body: '## What\nAdds token and call limits to the gateway entitlement module for every project.\n\n## Testing\n<!-- how did you test it -->\n\n- [ ] Docs updated' });
    expect(r).toContain('desc-sections');
    expect(r).toContain('desc-checklist');
  });
  it('flags commits pushed after the description was last edited', () => {
    const r = checkPrHygiene({ ...base, commits: [1, 2, 3].map((d) => ({ date: `2026-10-2${d}T12:00:00Z`, message: 'more' })) });
    expect(r.find((c) => c.id === 'desc-stale')?.level).toBe('warn');
  });
  it('flags generic titles, branch-name titles and WIP titles on open PRs', () => {
    expect(ids({ title: 'Update' })).toContain('title-generic');
    expect(ids({ title: 'feature/token-limits', branch: 'feature/token-limits' })).toContain('title-branch');
    expect(ids({ title: 'WIP: add per-project token limits' })).toContain('title-wip');
    expect(ids({ title: 'WIP: add per-project token limits', draft: true })).not.toContain('title-wip');
  });
  it('follows the team rules and the repo title style', () => {
    const rules = [{ path: 'AGENTS.md', text: 'PR titles must use Conventional Commits and include the ticket number (AB#123).' }];
    const r = checkPrHygiene({ ...base, title: 'Add per-project token limits', rules });
    expect(r.find((c) => c.id === 'title-conventional')?.source).toBe('AGENTS.md');
    expect(r.find((c) => c.id === 'title-ticket')?.source).toBe('AGENTS.md');
    const recent = ['feat: a', 'fix: b', 'chore: c', 'feat(x): d', 'docs: e'];
    expect(ids({ title: 'Add per-project token limits', recentTitles: recent })).toContain('title-conventional');
  });
});

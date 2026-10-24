// The Report tab's model: open issues, merge rule, per-PR checklists. Uses the invented golden fixtures.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReport } from '../src/analysis/report';
import { countsFor, humanFor, issuesFor, issuesOf, mergeRule, reviewBody, verifiedFor } from '../src/analysis/review';
import type { PrSnapshot } from '../src/shared/model';

const dir = join(__dirname, 'golden', 'fixtures');
const snaps: PrSnapshot[] = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const r = buildReport(snaps, { now: '2026-10-22T00:00:00Z' });
const id = (repo: string, n: number) => `acme-org/${repo}#${n}`;
const GW = id('acme-platform-gateway', 34);
const LIB = id('acme-platform-lib', 18);
const CFG = id('acme-platform-config', 14);

describe('review model', () => {
  const issues = issuesOf(r);

  it('puts Blocking first and keeps the review comment it came from', () => {
    expect(issues[0].sev).toBe('Blocking');
    const master = issues.find((i) => /master/.test(i.title))!;
    expect(master.sev).toBe('Blocking');
    expect(master.aiReviewer).toBe(true);
    expect(master.commentId).toBe(1801);
    expect(master.prIds).toEqual([LIB]);
  });

  it('gives the ship-together rule to both PRs, with the link’s reason', () => {
    const rule = issues.find((i) => i.src === 'Rule' && /requestsPerMinute/.test(i.title) && i.sev === 'Blocking')!;
    expect(rule.prIds.sort()).toEqual([CFG, LIB].sort());
    expect(rule.why).toMatch(/must change at the same time/);
  });

  it('turns links to check into Check issues', () => {
    const c = issues.filter((i) => i.sev === 'Check');
    expect(c.length).toBe(1);
    expect(c[0].title).toBe('Old name still in use');
    expect(c[0].prIds).toEqual(expect.arrayContaining([GW]));
  });

  it('adds failing checks and conflicts from GitHub as Blocking', () => {
    const live = issuesOf(r, { [GW]: { state: 'open', review: 'changes', approvals: 0, checks: 'failing', conflicts: true } });
    const s = live.find((i) => i.id === `S-${GW}`)!;
    expect(s.sev).toBe('Blocking');
    expect(s.title).toBe('Checks failing and merge conflicts');
  });

  it('counts open issues per PR and skips the done ones', () => {
    const c = countsFor(issues, LIB);
    expect(c.Blocking).toBe(2);
    const master = issues.find((i) => /master/.test(i.title))!;
    expect(countsFor(issues, LIB, (x) => x === master.id).Blocking).toBe(1);
  });

  it('words the merge rule from the merge order', () => {
    expect(mergeRule(r)).toMatch(/^Merge acme-platform-config #14 and acme-platform-lib #18 together; .*acme-platform #50 can merge any time\.$/);
  });

  it('lists what was verified and what only a person can judge', () => {
    expect(verifiedFor(r, GW).length).toBeGreaterThanOrEqual(4);
    expect(humanFor(r, GW).map((h) => h.id)).toEqual(expect.arrayContaining(['H-right-change', 'H-prod']));
  });

  it('writes the Request changes summary from the open issues', () => {
    const body = reviewBody(r, LIB, issuesFor(issues, LIB));
    expect(body).toMatch(/^Before acme-platform-lib #18 can merge:/);
    expect(body).toMatch(/\*\*Blocking:\*\* .*master/);
    expect(body).toMatch(/must merge together with acme-platform-config #14/);
    expect(reviewBody(r, LIB, [])).toBe('');
  });
});

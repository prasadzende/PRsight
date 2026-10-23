// Golden tests: four invented PRs for made-up ticket 424242 in a made-up "acme-org" (see fixtures/).
// Config and a Terraform module rename rpm to requestsPerMinute, a gateway policy reads the module's
// usage record and still uses rpm, and a design doc describes it. They pin the cross-PR links and
// findings a reviewer relies on.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/analysis/report';
import type { PrSnapshot } from '../../src/shared/model';

const dir = join(__dirname, 'fixtures');
const snaps: PrSnapshot[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const r = buildReport(snaps, { now: '2026-10-22T00:00:00Z' });
const label = (id: string) => id.replace('acme-org/acme-platform-', '').replace('acme-org/', '');

describe('golden: ticket 424242', () => {
  it('finds the ticket in titles and branches', () => {
    expect(r.tickets[0].key).toBe('424242');
    expect(r.tickets[0].prIds.length).toBe(4);
  });

  it('flags the shared rename as must-ship-together', () => {
    const l = r.links.find((x) => x.tone === 'bad');
    expect(l).toBeTruthy();
    expect(l!.shared).toEqual(['rpm', 'requestsPerMinute']);
    expect(l!.prIds.map(label).sort()).toEqual(['config#14', 'lib#18']);
    expect(r.findings.some((f) => f.sev === 'High' && f.src === 'Rule' && /requestsPerMinute/.test(f.text))).toBe(true);
  });

  it('finds the record contract between the module and the gateway policy', () => {
    const l = r.links.find((x) => x.title === 'Record contract');
    expect(l).toBeTruthy();
    expect(l!.shared).toEqual(expect.arrayContaining(['monthlyBudget', 'usagePlanTier']));
    expect(l!.prIds.map(label).sort()).toEqual(['gateway#34', 'lib#18']);
  });

  it('notices the old name rpm is still read by the gateway', () => {
    const l = r.links.find((x) => x.kind === 'differs');
    expect(l).toBeTruthy();
    expect(l!.prIds.map(label)).toEqual(expect.arrayContaining(['gateway#34']));
  });

  it('links the design doc to the rename', () => {
    expect(r.links.some((x) => x.kind === 'docs' && x.prIds.map(label).includes('acme-platform#50'))).toBe(true);
  });

  it('marks Copilot as an AI reviewer and keeps the master key finding Blocking', () => {
    const f = r.findings.find((x) => /master/.test(x.text));
    expect(f?.sev).toBe('High');
    expect(f?.aiReviewer).toBe(true);
    expect(r.findings.filter((x) => x.src === 'Copilot' && x.sev === 'Medium').length).toBe(3);
  });

  it('flags the 20x cut to the alpha dev daily limit as operational impact', () => {
    expect(r.findings.some((f) => /Operational impact: dailyLimit cut from 2,000,000 to 100,000/.test(f.text))).toBe(true);
  });

  it('passes the gateway team rules that apply', () => {
    const gw = r.teamRules.filter((t) => label(t.prId) === 'gateway#34');
    expect(gw.length).toBeGreaterThanOrEqual(3);
    expect(gw.every((t) => t.passed)).toBe(true);
  });

  it('orders the story by data flow with the doc on its own row', () => {
    expect(r.story.boxes.map((b) => label(b.prId))).toEqual(['config#14', 'lib#18', 'gateway#34', 'acme-platform#50']);
    expect(r.story.boxes[3].row).toBe(1);
    expect(r.story.arrows[0].flag).toBe('must ship together');
  });

  it('puts the coupled PRs first in the merge order and the doc last', () => {
    expect(r.order[0].prIds.map(label).sort()).toEqual(['config#14', 'lib#18']);
    expect(r.order[r.order.length - 1].what).toMatch(/any time/);
  });
});

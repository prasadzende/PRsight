// Select Related: ticket keys from the ticked PRs, and matching across repos.
import { describe, expect, it } from 'vitest';
import { relatedPrs, ticketKeysOf, DEFAULT_DETECT } from '../src/analysis/tickets';

const pr = (id: string, title: string, branch = 'main', body = '', state = 'open') => ({ id, title, branch, body, state });

describe('select related', () => {
  it('collects each ticket key once, with a label', () => {
    const keys = ticketKeysOf([pr('a', '424242 - Rename rpm', 'feature/424242-rpm'), pr('b', 'PLAT-311: Retry webhooks', 'x', 'See AB#77')], DEFAULT_DETECT);
    expect(keys.map((k) => k.label).sort()).toEqual(['AB#424242', 'AB#77', 'PLAT-311']);
  });

  it('finds open PRs in other repos that share the ticket, and skips closed ones', () => {
    const selected = [pr('acme/config#14', '424242 - Rename rpm')];
    const all = [
      pr('acme/config#14', '424242 - Rename rpm'),
      pr('acme/lib#18', 'Usage quota module', 'feature/424242-usage-record'),
      pr('acme/gateway#34', 'Gateway quotas', 'x', 'Part of AB#424242'),
      pr('acme/old#3', '424242 - an old attempt', 'x', '', 'closed'),
      pr('acme/web#212', 'Fix the login loop'),
    ];
    const r = relatedPrs(selected, all, DEFAULT_DETECT, {}, (p) => p.id);
    expect(r.map((x) => x.pr.id).sort()).toEqual(['acme/gateway#34', 'acme/lib#18']);
    expect(r[0].reason).toMatch(/same ticket AB#424242/);
  });

  it('finds nothing when the ticked PRs have no ticket number', () => {
    expect(ticketKeysOf([pr('a', 'Fix the login loop', 'fix/login')], DEFAULT_DETECT)).toEqual([]);
  });

  it('on the Closed list, matches closed and merged PRs instead', () => {
    const selected = [pr('acme/config#14', '424242 - Rename rpm', 'x', '', 'merged')];
    const all = [pr('acme/lib#18', '424242 - Module', 'x', '', 'merged'), pr('acme/hub#34', '424242 - Gateway', 'x', '', 'closed'), pr('acme/doc#50', '424242 - ADR')];
    expect(relatedPrs(selected, all, DEFAULT_DETECT, {}, (p) => p.id, ['closed', 'merged']).map((x) => x.pr.id).sort()).toEqual(['acme/hub#34', 'acme/lib#18']);
  });
});

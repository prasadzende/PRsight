import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildReport } from '../src/analysis/report';
const dir = join(__dirname, '../tests/golden/fixtures');
const snaps = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const r = buildReport(snaps, { now: '2026-10-22T00:00:00Z' });
// Drop the owner from "owner/repo#12" so the dump is easier to read.
const short = (s: string) => s.replace(/\b[\w.-]+\/([\w.-]+#\d+)/g, '$1');
console.log('TLDR', r.summary.tldr);
console.log('NODES', r.nodes.length, r.nodes.map((n) => `${short(n.prId)} | ${n.name} | ${n.path} | ${n.sub}${n.key ? ' *' : ''}`).join('\n  '));
console.log('LINKS'); for (const l of r.links) console.log(`  ${l.n} [${l.kind}/${l.tone}/${l.impact}] ${l.title} :: ${l.text}\n     nodes=${l.nodes.map(short).join(', ')}`);
console.log('FINDINGS'); for (const f of r.findings) console.log(`  ${f.sev} ${f.src}${f.aiReviewer?'(AI)':''} ${f.status} | ${f.where} | ${f.text}`);
console.log('VERIFIED'); for (const v of r.verified) console.log(`  ${v.src} | ${v.where} | ${v.text}`);
console.log('CARDS'); for (const c of r.cards) console.log(`  ${short(c.prId)} ${c.role} | ${c.head} | ${c.fit.label}: ${c.fit.why} | ${c.hygiene.ticketIn}`);
console.log('STORY', r.story.boxes.map((b) => `${b.step}.${short(b.prId)}(${b.role},row${b.row})`).join(' '), '\n ', r.story.arrows.map((a) => `${short(a.from)}->${short(a.to)} ${a.label} [${a.flag}]`).join('\n  '));
console.log('ORDER'); r.order.forEach((o) => console.log(`  ${o.n}. ${o.what} — ${o.why}`));
console.log('TOUR'); r.tour.forEach((t, i) => console.log(`  ${i + 1}. ${t.text}`));
console.log('CHECK'); r.checklist.forEach((c) => console.log(`  ${c.human ? '[person] ' : ''}${c.label}`));
console.log('TICKETS', r.tickets.map((t) => `${t.key} ${t.foundIn}`));
console.log('RISK/FIT'); for (const n of r.nodes) { const o = r.overlays[n.id]; console.log(`  ${n.name}: ${o.risk.level} (${o.risk.why}) | tests: ${o.tests} | fit: ${o.fit ?? '-'}`); }
console.log('WATCH', r.summary.watch);

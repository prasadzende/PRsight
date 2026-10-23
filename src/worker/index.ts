// Analysis runs in an Electron utilityProcess so parsing large PRs never blocks the UI.
import { buildReport, type BuildOptions } from '../analysis/report';
import type { PrSnapshot } from '../shared/model';

type Msg = { id: number; snaps: PrSnapshot[]; opts: BuildOptions };

process.parentPort.on('message', (e: { data: Msg }) => {
  const { id, snaps, opts } = e.data;
  try {
    const report = buildReport(snaps, opts);
    process.parentPort.postMessage({ id, report });
  } catch (err) {
    process.parentPort.postMessage({ id, error: (err as Error).message });
  }
});

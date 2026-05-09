// fixture — synthetic source for end-to-end testing of the worker
// pipeline before any real plugin is wired up. Returns N hardcoded
// postings tagged with the current run timestamp so dedup is easy to
// reason about during smoke tests.
import type { Source, RecommendedRoleInput } from './types.ts';

interface FixtureConfig {
  count?: number;     // how many synthetic rows to emit
}

export const fixtureSource: Source<FixtureConfig> = {
  type: 'fixture',
  async pull(cfg) {
    const count = Math.max(1, Math.min(10, cfg.count ?? 3));
    const stamp = new Date().toISOString().slice(0, 16);
    const rows: RecommendedRoleInput[] = [];
    for (let i = 0; i < count; i++) {
      rows.push({
        source:      'fixture',
        sourceId:    `fixture-${stamp}-${i}`,
        sourceLabel: 'Fixture',
        url:         `https://example.com/jobs/${stamp}-${i}`,
        company:     'Acme Co',
        title:       `Synthetic Role ${i + 1}`,
        location:    'Remote',
        salary:      '$200k – $250k',
        postedAt:    new Date().toISOString(),
        description: 'This is a fixture posting used to validate the worker pipeline.',
      });
    }
    return rows;
  },
};

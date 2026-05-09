// Source registry — the worker looks plugins up by `type` here.
// Adding a source = import the plugin and add it to this map.
import type { Source } from './types.ts';
import { fixtureSource } from './fixture.ts';
import { trackedAtsSource } from './tracked-ats.ts';

export const SOURCES: Record<string, Source> = {
  [fixtureSource.type]:     fixtureSource,
  [trackedAtsSource.type]:  trackedAtsSource,
};

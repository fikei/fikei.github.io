// Source registry — the worker looks plugins up by `type` here.
// Adding a source = import the plugin and add it to this map.
import type { Source } from './types.ts';
import { fixtureSource } from './fixture.ts';
import { trackedAtsSource } from './tracked-ats.ts';
import { linkedinRssSource } from './linkedin-rss.ts';
import { rssSource } from './rss.ts';
import { theirstackSource } from './theirstack.ts';
import { gmailJobsSource } from './gmail-jobs.ts';
import { companyWatchSource } from './company-watch.ts';
import { atsRadarSource } from './ats-radar.ts';

export const SOURCES: Record<string, Source> = {
  [atsRadarSource.type]:    atsRadarSource,
  [companyWatchSource.type]: companyWatchSource,
  [fixtureSource.type]:     fixtureSource,
  [trackedAtsSource.type]:  trackedAtsSource,
  [linkedinRssSource.type]: linkedinRssSource as unknown as Source,
  [rssSource.type]:         rssSource as unknown as Source,
  [theirstackSource.type]:  theirstackSource as unknown as Source,
  [gmailJobsSource.type]:   gmailJobsSource as unknown as Source,
};

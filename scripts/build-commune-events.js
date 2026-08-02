#!/usr/bin/env node
// Builds communes/events.json — the unified co-op/commune events feed.
// Run after editing communes/data.js:  node scripts/build-commune-events.js
// Consumed by /events (source type: json feed) and anyone else at
// https://ctrl.rodeo/communes/events.json
const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'communes', 'data.js');
const outPath = path.join(__dirname, '..', 'communes', 'events.json');

const src = fs.readFileSync(dataPath, 'utf8');
const sandbox = {};
// data.js assigns to window.COMMUNE_DATA; give it a window to land on.
new Function('window', src)(sandbox);
const houses = sandbox.COMMUNE_DATA.houses;

const version = (src.match(/dataset v([\d.]+)/) || [])[1] || '0.0.0';

const events = [];
for (const h of houses) {
  for (const ev of h.events || []) {
    events.push({
      id: `${h.id}:${ev.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      house_id: h.id,
      house_name: h.name,
      house_status: h.status,
      house_url: `https://ctrl.rodeo/communes/?house=${h.id}`,
      neighborhood: h.neighborhood,
      lat: h.lat,
      lng: h.lng,
      coords_approx: !!h.coordsApprox,
      title: ev.title,
      date: ev.date,       // ISO date, year, or recurrence text ("monthly", "every Monday")
      kind: ev.kind,       // event | update | press | open room
      detail: ev.detail,
      url: ev.url || null,
    });
  }
}

const feed = {
  feed: 'sf-commune-atlas-events',
  version,
  generated: new Date().toISOString(),
  source: 'https://ctrl.rodeo/communes/',
  count: events.length,
  events,
};

fs.writeFileSync(outPath, JSON.stringify(feed, null, 2) + '\n');
console.log(`[build-commune-events] wrote ${events.length} events from ${houses.length} houses (dataset v${version}) -> ${path.relative(process.cwd(), outPath)}`);

/* Agape recruiting — settings schema (Sassy: Settings pattern).
 *
 * The point of this file: adding a setting is one object literal. The Settings
 * view renders from this array, and `setting(key)` reads through it, so a
 * field's default lives in exactly one place and is both the UI default and
 * the code default. That is what lets a knob ship configurable without a
 * migration or a seed row — no row means the schema default.
 *
 * `scope` decides the store, so callers never learn where a value lives:
 *   house    → recruit_settings   (key/value JSONB, admin-writable)
 *   profile  → recruit_profiles   (per-user)
 *   local    → localStorage       (per-browser)
 *
 * Four field types cover every knob in the app: bool · number · text · enum.
 * A key can exist here without appearing in any section's `fields` — then it
 * is a named, documented constant in one place instead of a magic number in
 * three, and exposing it later is a one-line change.
 *
 * Classic script, not a module: it runs before app.js and hands over globals.
 */
const SETTINGS_VERSION = '1.0.0';
console.log(`[settings-schema] v${SETTINGS_VERSION}`);

/* Every knob, exposed or not. `section: null` means "routed through setting()
   but deliberately not in the UI yet". */
const SETTING_DEFS = {
  /* --- House ------------------------------------------------------------ */
  food_monthly: {
    scope: 'house', type: 'number', section: 'house', default: 250,
    label: 'Food', unit: '/mo per person', min: 0, max: 2000, step: 5,
    hint: 'Groceries, split evenly. Feeds the all-in number on every listing.',
  },
  dues_monthly: {
    scope: 'house', type: 'number', section: 'house', default: 450,
    label: 'Communal dues', unit: '/mo per person', min: 0, max: 5000, step: 5,
    hint: 'Everything that isn’t rent or food.',
  },
  open_to_couples: {
    scope: 'house', type: 'bool', section: 'house', default: true,
    label: 'Open to couples',
    hint: 'Off hides couple applications from placement suggestions.',
  },

  /* --- Funnel ----------------------------------------------------------- */
  followup_stale_days: {
    scope: 'house', type: 'number', section: 'funnel', default: 3,
    label: 'Follow-up goes amber after', unit: 'days', min: 1, max: 30, step: 1,
    hint: 'A thread this quiet is worth another email.',
  },
  movein_flex_months: {
    scope: 'house', type: 'number', section: 'funnel', default: 1,
    label: 'Flexible move-in stretches by', unit: 'months', min: 0, max: 3, step: 1,
    hint: 'How far a “flexible” date reaches on each side when matching listings.',
  },
  trial_checkin_months: {
    scope: 'house', type: 'number', section: 'funnel', default: 1,
    label: 'Trial check-in lands after', unit: 'months', min: 0, max: 6, step: 1,
    hint: 'Measured from the day they move in. #recruiting-automation gets a reminder a week ahead.',
  },
  trial_decision_months: {
    scope: 'house', type: 'number', section: 'funnel', default: 1,
    label: 'Trial decision lands before the end by', unit: 'months', min: 0, max: 6, step: 1,
    hint: 'Enough runway to say yes, or for them to find somewhere else.',
  },
  update_email_default: {
    scope: 'house', type: 'bool', section: 'funnel', default: true,
    label: 'Offer an update email by default',
    hint: 'When someone is marked not a fit — you can still change it per person.',
  },

  /* --- Automations ------------------------------------------------------ */
  discord_auto_post: {
    scope: 'house', type: 'bool', section: 'automations', default: false,
    label: 'Auto-post coverage asks',
    hint: 'Off means a human sees the message before the house does.',
  },

  /* --- You -------------------------------------------------------------- */
  display_name: {
    scope: 'profile', column: 'display_name', type: 'text', section: 'you', default: '',
    label: 'Display name', maxlength: 60,
    hint: 'Shown on your reviews, comments, and the emails you send.',
  },
  theme: {
    scope: 'local', storageKey: 'agape:theme', type: 'enum', section: 'you', default: 'dark',
    label: 'Theme', options: [['dark', 'Dark'], ['light', 'Light']],
    hint: 'This browser only.',
  },

  /* --- Routed, not exposed ---------------------------------------------- *
   * Real defaults with real names, one line from being a setting the day
   * someone asks. Nobody has argued about these. */
  gap_min_days: {
    scope: 'house', type: 'number', section: null, default: 7,
    label: 'Shortest gap worth listing', unit: 'days', min: 1, max: 60, step: 1,
    hint: 'Uncovered stretches shorter than this stay off the timeline.',
  },
  screener_slot_minutes: {
    scope: 'house', type: 'number', section: null, default: 30,
    label: 'Screening call length', unit: 'minutes', min: 15, max: 90, step: 15,
    hint: 'Also the spacing between offered slots.',
  },
  screener_max_slots: {
    scope: 'house', type: 'number', section: null, default: 8,
    label: 'Slots offered per ask', unit: 'slots', min: 3, max: 20, step: 1,
    hint: 'More slots is more choice and a longer Discord post.',
  },
  trial_length_months: {
    scope: 'house', type: 'number', section: null, default: 3,
    label: 'A resident trial runs', unit: 'months', min: 1, max: 12, step: 1,
    hint: 'Also how long a listing is assumed to run when it states no end date.',
  },
  save_for_future_months: {
    scope: 'house', type: 'number', section: null, default: 3,
    label: 'Save for future brings them back in', unit: 'months', min: 1, max: 12, step: 1,
    hint: 'The default return date when someone is parked rather than passed on.',
  },
};

/* Sections, in the order they appear. Titles borrow the rail's vocabulary on
   purpose — House and Funnel already mean something in this app. `rows` marks
   a section that renders status objects (automations, connections) rather than
   fields; those aren't settings and don't belong in the field renderer. */
const SETTING_SECTIONS = [
  { id: 'you', title: 'You', hint: 'Only affects your account.' },
  { id: 'house', title: 'House', hint: 'The building and the money. Everyone sees these.' },
  { id: 'funnel', title: 'Funnel', hint: 'How applicants move. Everyone sees these.' },
  { id: 'automations', title: 'Automations', hint: 'Things that run without you.', rows: 'automations' },
  { id: 'connections', title: 'Connections', hint: 'Where recruiting reaches outside the app.', rows: 'connections' },
  { id: 'data', title: 'Data', hint: 'Take it with you.', rows: 'data' },
];

/* The cron jobs Settings → Automations reports on, and what each one is for in
   plain language. `jobname` matches pg_cron and recruit_cron_status(). */
const SETTING_AUTOMATIONS = [
  {
    jobname: 'recruit_gmail_scan_tick',
    label: 'Scan the shared inbox',
    hint: 'Pulls new applications, replies, and availability out of Gmail.',
  },
  {
    jobname: 'recruit_screening_reminder_tick',
    label: 'Remind screeners before a call',
    hint: 'DMs whoever claimed the call about an hour ahead, and posts trial milestones.',
  },
  {
    jobname: 'recruit_application_ingest_tick',
    label: 'Ingest new applications',
    hint: 'Sweeps the application form for submissions the inbox scan missed.',
  },
  {
    jobname: 'pipeline-invariants-6h',
    label: 'Check the pipeline for contradictions',
    hint: 'Catches someone in two rooms, or in none, before a human notices.',
  },
];

window.SETTING_DEFS = SETTING_DEFS;
window.SETTING_SECTIONS = SETTING_SECTIONS;
window.SETTING_AUTOMATIONS = SETTING_AUTOMATIONS;

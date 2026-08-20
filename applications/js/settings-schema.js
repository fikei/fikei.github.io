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
const SETTINGS_VERSION = '1.3.0';
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
  house_address: {
    scope: 'house', type: 'text', section: 'house', default: '', maxlength: 200,
    label: 'House address',
    hint: 'Sent in the auto-confirmation when a house-tour poll clears. Tours don’t confirm without it.',
  },
  tour_confirm_votes: {
    scope: 'house', type: 'number', section: 'house', default: 4,
    label: 'Tour confirms past', unit: 'housemates', min: 1, max: 12, step: 1,
    hint: 'A poll slot with MORE than this many reactions auto-emails the confirmation. Tue–Thu 5–7pm is preferred so the most roommates are around without touching family dinner — tour guests don’t join dinner.',
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
    hint: 'Measured from the day they move in. The ballot closes at the Monday meeting before it — the house is nudged four days out and bumped that morning.',
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

  /* --- Move-in ----------------------------------------------------------- *
   * Everything the welcome email, the agreement, and the day-of email merge
   * in. The acceptance flow shows these prefilled so a stale value gets
   * caught at the moment it matters. */
  deposit_amount: {
    scope: 'house', type: 'number', section: 'movein', default: 500,
    label: 'Deposit', unit: 'held throughout', min: 0, max: 5000, step: 50,
    hint: 'Returned at the end of the stay if the room comes back as it went out.',
  },
  finance_contact_1_name: {
    scope: 'house', type: 'text', section: 'movein', default: 'Charles', maxlength: 60,
    label: 'Finance contact 1', hint: 'Named in the rent-setup section and cc’d on the welcome email.',
  },
  finance_contact_1_email: {
    scope: 'house', type: 'text', section: 'movein', default: '', maxlength: 120,
    label: 'Finance contact 1 email', hint: 'Cc’d on the welcome email so the apartments.com invite follows.',
  },
  finance_contact_2_name: {
    scope: 'house', type: 'text', section: 'movein', default: 'Gavin', maxlength: 60,
    label: 'Finance contact 2', hint: 'Second finance name; leave empty if there’s only one.',
  },
  finance_contact_2_email: {
    scope: 'house', type: 'text', section: 'movein', default: '', maxlength: 120,
    label: 'Finance contact 2 email', hint: 'Also cc’d when set.',
  },
  onboarding_hosts: {
    scope: 'house', type: 'text', section: 'movein', default: 'Sam or Colin', maxlength: 120,
    label: 'Onboarding chat hosts', hint: 'Who a new housemate books their onboarding chat with.',
  },
  discord_invite_url: {
    scope: 'house', type: 'text', section: 'movein', default: '', maxlength: 300,
    label: 'Discord invite link', hint: 'The invite that goes in every welcome email.',
  },
  notion_guide_url: {
    scope: 'house', type: 'text', section: 'movein', default: '', maxlength: 300,
    label: 'Notion guide link', hint: 'The “good place to start” page linked from the welcome email.',
  },
  master_tenant_name: {
    scope: 'house', type: 'text', section: 'movein', default: '', maxlength: 80,
    label: 'Master tenant', hint: 'Named on the housemate agreement.',
  },
  master_rent_monthly: {
    scope: 'house', type: 'number', section: 'movein', default: 19500,
    label: 'Master lease rent', unit: '/mo', min: 0, max: 100000, step: 100,
    hint: 'Disclosed on the agreement under SF Rent Ordinance 6.15C.',
  },
  agreement_template_doc_id: {
    scope: 'house', type: 'text', section: 'movein', default: '', maxlength: 120,
    label: 'Agreement template (Doc ID)', hint: 'The Google Doc the housemate agreement is generated from. Placeholders: {{housemate_name}}, {{move_in}}, {{move_out}}, {{rent}}, {{dues}}, {{food}}, {{total}}, {{deposit}}, {{master_tenant}}, {{master_rent}}, {{today}}.',
  },
  agreement_folder_id: {
    scope: 'house', type: 'text', section: 'movein', default: '', maxlength: 120,
    label: 'Agreements folder (Drive ID)', hint: 'Where each person’s generated agreement lands.',
  },
  wifi_name: {
    scope: 'house', type: 'text', section: 'movein', default: '', maxlength: 80,
    label: 'WiFi network', hint: 'Goes in the day-of email.',
  },
  wifi_password: {
    scope: 'house', type: 'text', section: 'movein', default: '', maxlength: 80,
    label: 'WiFi password', hint: 'Goes in the day-of email.',
  },
  door_note: {
    scope: 'house', type: 'text', section: 'movein', default: '', maxlength: 300,
    label: 'Door / entry note', hint: 'Codes or key instructions for the day-of email.',
  },
  arrival_note: {
    scope: 'house', type: 'text', section: 'movein', default: '', maxlength: 300,
    label: 'Arrival note', hint: '“Reach out to …” — who meets them and how, for both emails.',
  },

  /* --- Automations ------------------------------------------------------ */
  discord_auto_post: {
    scope: 'house', type: 'bool', section: 'automations', default: false,
    label: 'Auto-post coverage asks',
    hint: 'Off means a human sees the message before the house does.',
  },
  society_scheduling_posts: {
    scope: 'house', type: 'bool', section: 'automations', default: true,
    label: 'Scheduling asks reach #recruiting-society',
    hint: 'House-visit polls and screener schedulers post to the members channel. Test applicants never do — they stay in #recruiting-automation.',
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
  { id: 'movein', title: 'Move-in', hint: 'What the welcome email, agreement, and day-of email say.' },
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

// Rodeo Extension — Privacy settings and domain blocklist
// Loaded via importScripts() in background.js
// Source of truth: chrome.storage.sync
// Mirrors to Supabase extension_settings table on change (best-effort)

// ============================================
// Default Domain Blocklist (hardcoded)
// ============================================
const DEFAULT_BLOCKLIST = new Set([
  // Email
  'mail.google.com',
  'outlook.live.com',
  'mail.yahoo.com',
  // Banking
  'chase.com',
  'bankofamerica.com',
  'wellsfargo.com',
  // Health
  'mychart.com',
  'myhealth.kaiserpermanente.org',
  // Government
  'irs.gov',
  'ssa.gov',
  'usa.gov',
  // Work SaaS
  'okta.com',
  'workday.com',
  'adp.com'
]);

// ============================================
// Sensitive Query Params (stripped before hashing)
// ============================================
const SENSITIVE_PARAMS = new Set([
  'token', 'access_token', 'refresh_token', 'id_token', 'session',
  'auth', 'key', 'apikey', 'api_key', 'secret', 'password', 'pwd',
  'code', 'state', 'nonce', 'csrf', 'sig', 'signature', 'hmac',
  'jwt', 'bearer', 'oauth_token', 'oauth_verifier',
  'email', 'username', 'user', 'phone', 'ssn', 'dob',
  'samlresponse', 'samlrequest'
]);

// ============================================
// Settings Cache
// ============================================
const PRIVACY_SETTINGS_KEY = 'rodeo_privacy_settings';
let _privacySettingsCache = null;

const DEFAULT_PRIVACY_SETTINGS = {
  historyEnabled: true,
  userBlocklist: [],
  backfillDays: 30
};

async function getPrivacySettings() {
  if (_privacySettingsCache) return _privacySettingsCache;
  try {
    const data = await chrome.storage.sync.get(PRIVACY_SETTINGS_KEY);
    _privacySettingsCache = data[PRIVACY_SETTINGS_KEY] || { ...DEFAULT_PRIVACY_SETTINGS };
  } catch {
    _privacySettingsCache = { ...DEFAULT_PRIVACY_SETTINGS };
  }
  return _privacySettingsCache;
}

async function savePrivacySettings(settings) {
  _privacySettingsCache = { ...DEFAULT_PRIVACY_SETTINGS, ...settings };
  try {
    await chrome.storage.sync.set({ [PRIVACY_SETTINGS_KEY]: _privacySettingsCache });
  } catch (e) {
    console.warn('[rodeo] failed to save privacy settings:', e.message);
  }
  // Best-effort mirror to Supabase
  syncSettingsToSupabase(_privacySettingsCache);
}

// Invalidate in-memory cache when storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[PRIVACY_SETTINGS_KEY]) {
    _privacySettingsCache = changes[PRIVACY_SETTINGS_KEY].newValue || { ...DEFAULT_PRIVACY_SETTINGS };
  }
});

// ============================================
// Domain Blocking
// ============================================

// Returns true if the domain should be excluded from history capture
function isDomainBlocked(domain) {
  if (!domain) return true;
  const d = domain.toLowerCase().replace(/^www\./, '');

  // Check hardcoded blocklist (exact + suffix match)
  if (DEFAULT_BLOCKLIST.has(d)) return true;
  for (const blocked of DEFAULT_BLOCKLIST) {
    if (d.endsWith('.' + blocked)) return true;
  }

  // Check user blocklist
  if (_privacySettingsCache && _privacySettingsCache.userBlocklist) {
    for (const userDomain of _privacySettingsCache.userBlocklist) {
      const ud = userDomain.toLowerCase().replace(/^www\./, '');
      if (d === ud || d.endsWith('.' + ud)) return true;
    }
  }

  return false;
}

// ============================================
// URL Sanitization
// ============================================

// Canonicalize a URL for hashing:
// - Only http/https
// - Strip fragment
// - Strip sensitive query params
// - Hash numeric path segments >5 digits (e.g. /users/123456789 → /users/:id)
// Returns null if URL should be excluded
function canonicalizeForHash(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;

  // Strip fragment
  u.hash = '';

  // Strip sensitive query params
  const toDelete = [];
  for (const [key] of u.searchParams) {
    if (SENSITIVE_PARAMS.has(key.toLowerCase())) toDelete.push(key);
  }
  toDelete.forEach(k => u.searchParams.delete(k));

  // Hash numeric path segments longer than 5 digits
  u.pathname = u.pathname
    .split('/')
    .map(seg => /^\d{6,}$/.test(seg) ? ':id' : seg)
    .join('/');

  // Lowercase hostname
  u.hostname = u.hostname.toLowerCase();

  return u.toString();
}

// SHA-256 hash of a URL (Web Crypto API — available in service workers)
async function hashUrl(url) {
  const data = new TextEncoder().encode(url);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================
// Supabase Settings Sync (best-effort)
// ============================================
async function syncSettingsToSupabase(settings) {
  try {
    const session = await getSession();
    if (!session || !session.access_token || !session.user) return;

    const payload = {
      user_id: session.user.id,
      history_enabled: settings.historyEnabled !== false,
      domain_blocklist: settings.userBlocklist || [],
      backfill_days: settings.backfillDays || 30
    };

    await supabasePost('/rest/v1/extension_settings', payload, session.access_token, {
      'Prefer': 'resolution=merge-duplicates'
    });
  } catch (e) {
    console.warn('[rodeo] settings sync failed:', e.message);
  }
}

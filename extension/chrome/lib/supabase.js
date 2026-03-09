// Rodeo Extension — Minimal Supabase REST client
// Matches raw fetch pattern from boards/index.html:12435

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI';

async function supabasePost(path, body, accessToken, extraHeaders = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
}

async function supabaseGet(path, accessToken) {
  return fetch(`${SUPABASE_URL}${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`
    }
  });
}

async function supabaseDelete(path, accessToken) {
  return fetch(`${SUPABASE_URL}${path}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`
    }
  });
}

// Fire-and-forget enrichment trigger
// Uses anon key auth (matches boards/index.html:10477-10481)
async function triggerEnrichment({ url, title, description, linkId }) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/create-pin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ url, title, description, linkId })
    });
  } catch (e) {
    // Enrichment is best-effort from extension — swallow errors
    console.warn('[rodeo] enrichment trigger failed:', e.message);
  }
}

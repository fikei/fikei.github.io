/**
 * Cloudflare Worker - Google AI Imagen Proxy
 *
 * Proxies requests to Google's Imagen API with server-side API key.
 *
 * SETUP:
 * 1. Go to https://dash.cloudflare.com/
 * 2. Workers & Pages > Create Worker
 * 3. Paste this code
 * 4. Go to Settings > Variables > Add variable:
 *    - Name: GOOGLE_AI_API_KEY
 *    - Value: [your API key]
 *    - Click "Encrypt"
 * 5. Deploy and note your worker URL
 * 6. Update PROXY_URL in app.js
 */

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Only allow POST
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Get API key from environment
    const apiKey = env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    try {
      const body = await request.json();
      const { prompt } = body;

      if (!prompt) {
        return new Response(JSON.stringify({ error: 'Prompt is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Call Google AI Imagen API
      const googleResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:generateImages?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: prompt,
            config: {
              numberOfImages: 1,
              aspectRatio: '1:1',
              outputMimeType: 'image/png',
            },
          }),
        }
      );

      const data = await googleResponse.json();

      if (!googleResponse.ok) {
        return new Response(JSON.stringify({ error: data.error?.message || 'Google AI API error' }), {
          status: googleResponse.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};

import { resolveKommoSubdomain } from '../utils/helpers.js';

const TOKEN_KEY = 'kommo_oauth_tokens';
const EXPIRY_BUFFER_MS = 60_000;

async function exchangeToken(env, body) {
  const subdomain = resolveKommoSubdomain(env);
  const res = await fetch(`https://${subdomain}/oauth2/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kommo OAuth error: ${res.status} ${text}`);
  }

  return res.json();
}

async function saveTokens(env, tokens, redirectUri) {
  const record = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000 - EXPIRY_BUFFER_MS,
    redirect_uri: redirectUri,
  };
  await env.KOMMO_OAUTH.put(TOKEN_KEY, JSON.stringify(record));
  return record;
}

export async function exchangeCodeForTokens(env, code, redirectUri) {
  const tokens = await exchangeToken(env, {
    client_id: env.KOMMO_INTEGRATION_ID,
    client_secret: env.KOMMO_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  return saveTokens(env, tokens, redirectUri);
}

export async function getValidAccessToken(env) {
  const raw = await env.KOMMO_OAUTH.get(TOKEN_KEY);
  if (!raw) {
    throw new Error('No hay token de Kommo autorizado todavía. Visita /oauth/start para autorizarlo.');
  }

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    throw new Error('Token almacenado en KV está corrupto. Visita /oauth/start para reautorizar.');
  }

  if (Date.now() < record.expires_at) {
    return record.access_token;
  }

  const redirectUri = record.redirect_uri || `https://${resolveKommoSubdomain(env).replace('.kommo.com', '')}.kommo.com/oauth/callback`;
  const tokens = await exchangeToken(env, {
    client_id: env.KOMMO_INTEGRATION_ID,
    client_secret: env.KOMMO_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: record.refresh_token,
    redirect_uri: redirectUri,
  });
  const refreshed = await saveTokens(env, tokens, redirectUri);
  return refreshed.access_token;
}

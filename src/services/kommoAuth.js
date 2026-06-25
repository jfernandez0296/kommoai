const TOKEN_KEY = 'kommo_oauth_tokens';
const EXPIRY_BUFFER_MS = 60_000;

function tokenSubdomain(env) {
  const rawSubdomain = env.KOMMO_SUBDOMAIN;
  if (!rawSubdomain) throw new Error('Falta configurar KOMMO_SUBDOMAIN');
  return rawSubdomain.includes('.') ? rawSubdomain : `${rawSubdomain}.kommo.com`;
}

async function exchangeToken(env, body) {
  const subdomain = tokenSubdomain(env);
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

async function saveTokens(env, tokens) {
  const record = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000 - EXPIRY_BUFFER_MS,
  };
  await env.KOMMO_OAUTH.put(TOKEN_KEY, JSON.stringify(record));
  return record;
}

/**
 * Intercambia el código de autorización (paso único, manual) por el primer
 * par access_token/refresh_token y lo guarda en KV.
 */
export async function exchangeCodeForTokens(env, code, redirectUri) {
  const tokens = await exchangeToken(env, {
    client_id: env.KOMMO_INTEGRATION_ID,
    client_secret: env.KOMMO_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  return saveTokens(env, tokens);
}

/**
 * Devuelve un access_token vigente, renovándolo con el refresh_token
 * guardado si ya venció. Lanza un error si nunca se hizo la autorización inicial.
 */
export async function getValidAccessToken(env) {
  const raw = await env.KOMMO_OAUTH.get(TOKEN_KEY);
  if (!raw) {
    throw new Error('No hay token de Kommo autorizado todavía. Visita /oauth/start para autorizarlo.');
  }

  const record = JSON.parse(raw);
  if (Date.now() < record.expires_at) {
    return record.access_token;
  }

  const tokens = await exchangeToken(env, {
    client_id: env.KOMMO_INTEGRATION_ID,
    client_secret: env.KOMMO_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: record.refresh_token,
  });
  const refreshed = await saveTokens(env, tokens);
  return refreshed.access_token;
}

import { getValidAccessToken } from './kommoAuth.js';

/**
 * Obtiene una sesión de chats via /ajax/v1/chats/session.
 * Este endpoint solo acepta un access_token OAuth (no un Long-Lived Token),
 * porque internamente es el mismo que usa la web de Kommo cuando un agente
 * humano escribe un mensaje.
 */
async function getChatSession(accountUrl, token) {
  const url = `${accountUrl}/ajax/v1/chats/session`;
  const body = new URLSearchParams({ 'request[chats][session][action]': 'create' });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) throw new Error(`session error: ${res.status} ${await res.text()}`);
  const data = await res.json();

  const session = data?.response?.chats?.session;
  if (!session?.access_token) throw new Error('access_token de sesión no encontrado');
  return session;
}

/**
 * El endpoint /ajax/v1/chats/session solo es accesible desde el dominio
 * .kommo.com de la cuenta (el mismo dominio donde vive la sesión OAuth),
 * no desde el dominio público .amocrm.com del panel de ventas.
 * Si `accountSelfLink` llega con dominio amocrm.com (como lo manda Kommo en
 * cada webhook), extraemos el subdominio y reconstruimos con kommo.com.
 */
function resolveAccountUrl(env, accountSelfLink) {
  if (accountSelfLink) {
    const host = accountSelfLink.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const sub = host.split('.')[0];
    return `https://${sub}.kommo.com`;
  }

  const rawSubdomain = env.KOMMO_SUBDOMAIN;
  if (!rawSubdomain) throw new Error('Falta configurar KOMMO_SUBDOMAIN');
  const subdomain = rawSubdomain.includes('.') ? rawSubdomain : `${rawSubdomain}.kommo.com`;
  return `https://${subdomain}`;
}

/**
 * Envía mensaje de respuesta vía Kommo Chat API:
 * 1. POST /ajax/v1/chats/session → obtiene access_token de sesión (requiere OAuth)
 * 2. POST amojo.kommo.com/v1/chats/{account_id}/{chat_id}/messages
 *
 * `accountSelfLink` es el campo `account[_links][self]` que Kommo manda en
 * cada webhook (ej. https://miempresa.amocrm.com); de ahí se extrae el
 * subdominio para construir la URL .kommo.com usada en getChatSession.
 */
export async function sendKommoReply(message, chatId, env, accountSelfLink) {
  if (!chatId) {
    console.warn('[kommo] Falta chatId. Saltando envío.');
    return { ok: false, error: 'chatId vacío' };
  }

  try {
    const accountUrl = resolveAccountUrl(env, accountSelfLink);
    const token = await getValidAccessToken(env);
    const session = await getChatSession(accountUrl, token);
    const chatAccessToken = session.access_token;
    const accountId = session.account?.id;
    const userName = session.user?.name || 'Asistente AI';
    const userAvatar = session.user?.avatar || '';

    console.log(`[kommo] chat session OK, accountId: ${accountId}, chatId: ${chatId}`);

    const url = `https://amojo.kommo.com/v1/chats/${accountId}/${chatId}/messages`;

    const bodyParams = new URLSearchParams({
      silent: 'false',
      priority: 'low',
      persona_name: userName,
      persona_avatar: userAvatar,
      text: message,
      skip_link_shortener: 'false',
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Auth-Token': chatAccessToken,
        'chatId': chatId,
      },
      body: bodyParams.toString(),
    });

    const responseText = await response.text();
    console.log(`[kommo] status: ${response.status}, body: ${responseText}`);

    if (!response.ok) {
      return { ok: false, status: response.status, details: responseText };
    }

    return { ok: true };
  } catch (error) {
    console.error('[kommo] Fallo:', error);
    return { ok: false, error: String(error) };
  }
}

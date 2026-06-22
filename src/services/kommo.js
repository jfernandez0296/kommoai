/**
 * Obtiene una sesión de chats via /ajax/v1/chats/session
 * Devuelve { access_token, account_id, user }
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
  console.log('[kommo] session response:', JSON.stringify(data).substring(0, 300));

  const session = data?.response?.chats?.session;
  if (!session?.access_token) throw new Error('access_token de sesión no encontrado');
  return session;
}

/**
 * Envía mensaje de respuesta vía Kommo Chat API.
 * Replica exactamente el flujo del workflow n8n:
 * 1. POST /ajax/v1/chats/session → obtiene access_token de sesión
 * 2. POST amojo.kommo.com/v1/chats/{account_id}/{chat_id}/messages
 */
export async function sendKommoReply(message, chatId, env, webhookParams) {
  const token = env.KOMMO_ACCESS_TOKEN;
  const rawSubdomain = env.KOMMO_SUBDOMAIN;

  if (!token || !rawSubdomain || !chatId) {
    console.warn('[kommo] Faltan variables o chatId.');
    return { ok: false, error: 'Configuración incompleta' };
  }

  const subdomain = rawSubdomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  // Kommo usa amocrm.com para la API
  const domain = subdomain.includes('amocrm.com') ? subdomain :
                 subdomain.replace('kommo.com', 'amocrm.com');
  const accountUrl = `https://${domain}`;

  try {
    // 1) Obtener sesión de chats
    const session = await getChatSession(accountUrl, token);
    const chatAccessToken = session.access_token;
    const accountId = session.account?.id;
    const userName = session.user?.name || 'Asistente AI';
    const userAvatar = session.user?.avatar || '';

    console.log(`[kommo] chat session OK, accountId: ${accountId}, chatId: ${chatId}`);

    // 2) Enviar mensaje
    const url = `https://amojo.kommo.com/v1/chats/${accountId}/${chatId}/messages`;
    console.log(`[kommo] URL: ${url}`);

    const bodyParams = new URLSearchParams({
      silent: 'false',
      priority: 'low',
      persona_name: userName,
      persona_avatar: userAvatar,
      text: message,
      skip_link_shortener: 'false',
    });

    // Añadir campos del webhook si están disponibles
    if (webhookParams) {
      if (webhookParams.entity_id) bodyParams.set('crm_entity[id]', webhookParams.entity_id);
      if (webhookParams.element_type) bodyParams.set('crm_entity[type]', webhookParams.element_type);
      if (webhookParams.author_id) bodyParams.set('recipient_id', webhookParams.author_id);
      if (webhookParams.talk_id) bodyParams.set('crm_dialog_id', webhookParams.talk_id);
      if (webhookParams.contact_id) bodyParams.set('crm_contact_id', webhookParams.contact_id);
      if (webhookParams.account_id) bodyParams.set('crm_account_id', webhookParams.account_id);
    }

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

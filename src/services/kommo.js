export async function sendKommoReply(message, talkId, env) {
  const token = env.KOMMO_ACCESS_TOKEN;
  const rawSubdomain = env.KOMMO_SUBDOMAIN;

  console.log(`[kommo] token presente: ${Boolean(token)}`);
  console.log(`[kommo] talkId: ${talkId}`);

  if (!token || !rawSubdomain || !talkId) {
    console.warn('[kommo] Faltan variables o talkId. Saltando envío.');
    return { ok: false, error: 'Configuración incompleta o talkId vacío' };
  }

  const subdomain = rawSubdomain
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');

  // Endpoint correcto para enviar mensajes en una conversación de Kommo
  const url = `https://${subdomain}/api/v4/talks/${talkId}/messages`;

  console.log(`[kommo] URL: ${url}`);

  const body = JSON.stringify({
    text: message,
    type: 'text',
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body,
    });

    const responseText = await response.text();
    console.log(`[kommo] status: ${response.status}, body: ${responseText}`);

    if (!response.ok) {
      console.error(`[kommo] Error al enviar (${response.status}):`, responseText);
      return { ok: false, status: response.status, details: responseText };
    }

    return { ok: true };
  } catch (error) {
    console.error('[kommo] Fallo de red:', error);
    return { ok: false, error: String(error) };
  }
}

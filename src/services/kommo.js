export async function sendKommoReply(message, payload = {}) {
  return {
    ok: true,
    message,
    payload,
    sentAt: new Date().toISOString(),
  };
}

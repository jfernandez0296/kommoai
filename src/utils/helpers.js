export function normalizeText(value) {
  return String(value || '').trim();
}

export function sanitizeInput(text, maxLength = 1000) {
  if (!text) return '';
  const sanitized = String(text).replace(/<[^>]*>?/gm, '');
  return sanitized.substring(0, maxLength);
}

export function removeAccents(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function resolveKommoSubdomain(env) {
  const raw = env.KOMMO_SUBDOMAIN;
  if (!raw) throw new Error('Falta configurar KOMMO_SUBDOMAIN');
  return raw.includes('.') ? raw : `${raw}.kommo.com`;
}

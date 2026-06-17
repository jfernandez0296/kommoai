export function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * Sanitiza la entrada del usuario eliminando etiquetas HTML y limitando la longitud.
 */
export function sanitizeInput(text, maxLength = 1000) {
  if (!text) return '';
  // Eliminar etiquetas HTML
  const sanitized = String(text).replace(/<[^>]*>?/gm, '');
  // Limitar longitud
  return sanitized.substring(0, maxLength);
}

/**
 * Elimina acentos y diacríticos de un texto.
 */
export function removeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function formatAnswer(text) {
  return normalizeText(text).replace(/\s+/g, ' ');
}

export function isPlanQuestion(text) {
  return /plan|precio|servicio|cobertura|distrito/i.test(String(text || '').toLowerCase());
}

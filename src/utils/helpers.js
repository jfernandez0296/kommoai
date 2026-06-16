export function normalizeText(value) {
  return String(value || '').trim();
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

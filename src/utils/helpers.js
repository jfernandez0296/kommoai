export function normalizeText(value) {
  return String(value || '').trim();
}

export function formatAnswer(text) {
  return normalizeText(text).replace(/\s+/g, ' ');
}

export function isPlanQuestion(text) {
  return /plan|precio|servicio|cobertura|distrito/i.test(String(text || '').toLowerCase());
}

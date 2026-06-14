export const config = {
  businessName: 'Kommo AI',
  defaultLanguage: 'es',
  defaultModel: 'openai/gpt-4o-mini',
  memoryLimit: 8,
  defaultPlanTopic: 'planes',
  envKeys: {
    openrouter: 'OPENROUTER_API_KEY',
    openai: 'OPENAI_API_KEY',
    kommo: 'KOMMO_TOKEN',
    workerUrl: 'WORKER_URL',
  },
};

export function getEnv(env, key) {
  return env?.[key] || '';
}

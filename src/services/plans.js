export function getPlanSummary(planName) {
  return `Resumen del plan: ${planName}`;
}

export function getPlanFeatures(planName) {
  return {
    planName,
    includes: ['Soporte', 'Acceso web', 'Atención prioritaria'],
  };
}

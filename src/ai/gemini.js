export async function askGemini(prompt, env) {
  const hasGeminiKey = Boolean(env?.GEMINI_API_KEY);
  console.log(`GEMINI_API_KEY presente: ${hasGeminiKey}`);

  if (!hasGeminiKey) {
    throw new Error('Falta configurar GEMINI_API_KEY');
  }

  const model = env?.GEMINI_MODEL ?? 'gemini-2.0-flash-exp';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response from Gemini.';
}

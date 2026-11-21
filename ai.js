let KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
export const aiModel = MODEL;
export const setKey = k => { KEY = k || ''; };
export const aiReady = () => !!KEY;
export const keyHint = () => (KEY ? '••••' + KEY.slice(-4) : '');

export async function ask(history, system, opts = {}) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.key || KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] }, contents: history,
      generationConfig: { maxOutputTokens: opts.maxTokens || 1024, temperature: 0.8, ...(opts.json ? { responseMimeType: 'application/json' } : {}) },
    }),
    signal: AbortSignal.timeout(opts.json ? 90000 : 25000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || 'HTTP ' + res.status);
  return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
}

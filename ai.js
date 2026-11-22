let KEY = process.env.GEMINI_API_KEY || '';
const FORCED = process.env.GEMINI_MODEL || '';
let model = FORCED || 'gemini-3.1-flash';
export const aiModel = model;
export const setKey = k => { KEY = k || ''; };
export const aiReady = () => !!KEY;
export const keyHint = () => (KEY ? '••••' + KEY.slice(-4) : '');

async function call(m, history, system, opts) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.key || KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] }, contents: history,
      generationConfig: { maxOutputTokens: opts.maxTokens || 1024, temperature: 0.8, ...(opts.json ? { responseMimeType: 'application/json' } : {}) },
    }),
    signal: AbortSignal.timeout(opts.json ? 90000 : 25000),
  });
}

const BUSY = [404, 429, 500, 503];
export async function ask(history, system, opts = {}) {
  const models = FORCED ? [FORCED, FORCED] : [...new Set([model, 'gemini-flash-latest', 'gemini-flash-lite-latest'])];
  let res;
  for (let i = 0; i < models.length; i++) {
    res = await call(models[i], history, system, opts);
    if (res.ok || !BUSY.includes(res.status)) { if (res.ok && !FORCED) model = models[i]; break; }
    if (i < models.length - 1) await new Promise(r => setTimeout(r, 800));
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(j.error?.message || 'HTTP ' + res.status); e.status = res.status; throw e; }
  return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
}

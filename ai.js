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

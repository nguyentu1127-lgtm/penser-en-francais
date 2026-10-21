// Shared helper (files starting with "_" are not exposed as Vercel functions).
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

export async function askGemini({ system, prompt, history = [], json = true, temperature = 0.4 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('Chưa cấu hình GEMINI_API_KEY trên Vercel.'), { status: 500 });

  const contents = [
    ...history.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text: prompt }] }
  ];

  const body = {
    contents,
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    generationConfig: {
      temperature,
      ...(json ? { responseMimeType: 'application/json' } : {})
    }
  };

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body)
    }
  );
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.error?.message || `Gemini lỗi ${r.status}`;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!json) return text;
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw Object.assign(new Error('AI trả về dữ liệu không hợp lệ.'), { status: 502 });
  }
}

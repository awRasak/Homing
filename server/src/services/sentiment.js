/**
 * Sentiment analysis via Groq LLM.
 * Analyzes text and returns { sentiment: 'positive'|'negative'|'neutral', score: -1..1 }.
 */

const GROQ_BASE = 'https://api.groq.com/openai/v1';

export async function analyzeSentiment(text, { model = 'meta-llama/llama-4-scout-17b-16e-instruct', apiKey } = {}) {
  const key = apiKey || process.env.GROQ_API_KEY;
  if (!key || !text) return { sentiment: 'neutral', score: 0 };

  const truncated = text.slice(0, 1000);

  try {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: 'Analyze the sentiment of the text. Return ONLY a JSON object: {"sentiment":"positive|negative|neutral","score":0.0} where score ranges from -1.0 (very negative) to 1.0 (very positive). Be concise.',
          },
          { role: 'user', content: truncated },
        ],
      }),
    });

    if (!res.ok) return { sentiment: 'neutral', score: 0 };
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[^}]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        sentiment: ['positive', 'negative', 'neutral'].includes(parsed.sentiment) ? parsed.sentiment : 'neutral',
        score: typeof parsed.score === 'number' ? Math.max(-1, Math.min(1, parsed.score)) : 0,
      };
    }
    return { sentiment: 'neutral', score: 0 };
  } catch {
    return { sentiment: 'neutral', score: 0 };
  }
}

/**
 * Batch sentiment analysis — analyze multiple texts in a single LLM call
 * to save API credits.
 */
export async function batchSentiment(texts, opts = {}) {
  const key = opts.apiKey || process.env.GROQ_API_KEY;
  if (!key || texts.length === 0) return texts.map(() => ({ sentiment: 'neutral', score: 0 }));

  const prompt = texts.map((t, i) => `[${i}] ${t.slice(0, 300)}`).join('\n');

  try {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: opts.model || 'meta-llama/llama-4-scout-17b-16e-instruct',
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: `Analyze the sentiment of each numbered text. Return a JSON array of objects: [{"sentiment":"positive|negative|neutral","score":0.0}] in the same order. Score: -1.0 to 1.0.`,
          },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!res.ok) return texts.map(() => ({ sentiment: 'neutral', score: 0 }));
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const match = content.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return texts.map((_, i) => {
        const r = parsed[i] || {};
        return {
          sentiment: ['positive', 'negative', 'neutral'].includes(r.sentiment) ? r.sentiment : 'neutral',
          score: typeof r.score === 'number' ? Math.max(-1, Math.min(1, r.score)) : 0,
        };
      });
    }
    return texts.map(() => ({ sentiment: 'neutral', score: 0 }));
  } catch {
    return texts.map(() => ({ sentiment: 'neutral', score: 0 }));
  }
}

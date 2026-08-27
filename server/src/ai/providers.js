import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';

const GENERATE_TOOL_SCHEMA = {
  name: 'submit_proposal_copy',
  description: 'Submit the tailored proposal copy sections.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'A short, punchy headline tailored to the recipient company.' },
      opening: { type: 'string', description: 'One opening paragraph that hooks the specific recipient.' },
      bodyParagraphs: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 3,
        description: '2-3 body paragraphs tailored to the recipient, distinct from the static sections.',
      },
      closing: { type: 'string', description: 'A closing paragraph with a clear call to action.' },
    },
    required: ['headline', 'opening', 'bodyParagraphs', 'closing'],
  },
};

const JSON_SCHEMA_FORMAT = `
Return your result as valid JSON with exactly these keys:
{
  "headline": "string",
  "opening": "string",
  "bodyParagraphs": ["string", "string", "string"],
  "closing": "string"
}`;

// Gemini structured output uses its own OpenAPI-subset Schema type
// (uppercase type names), declared natively so the model cannot emit prose.
const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING', description: 'A short, punchy headline tailored to the recipient company.' },
    opening: { type: 'STRING', description: 'One opening paragraph that hooks the specific recipient.' },
    bodyParagraphs: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      minItems: 2,
      maxItems: 3,
      description: '2-3 body paragraphs tailored to the recipient, distinct from the static sections.',
    },
    closing: { type: 'STRING', description: 'A closing paragraph with a clear call to action.' },
  },
  required: ['headline', 'opening', 'bodyParagraphs', 'closing'],
  propertyOrdering: ['headline', 'opening', 'bodyParagraphs', 'closing'],
};

function buildPrompt({ design, companyName, notes }) {
  const staticSections = JSON.parse(design.static_sections || '[]');
  const staticSummary = staticSections
    .map((s) => `- ${s.heading}: ${s.body.slice(0, 300)}`)
    .join('\n');
  const brandColors = JSON.parse(design.brand_colors || '[]');
  const brandColorHint = brandColors.length
    ? `BRAND PALETTE (secondary colors — you may reference them when describing visuals/design touches, do not force it): ${brandColors.join(', ')}. Accent color: ${design.accent_color}.`
    : '';

  return `You are ghostwriting a tailored B2B proposal on behalf of ${design.sender_name || 'the sender'}.

STYLE SAMPLE (match this voice/tone closely, do not imitate generic AI copy):
"""
${design.style_sample || '(no style sample provided; use a confident, warm, concise B2B tone)'}
"""

STATIC SECTIONS THAT ALREADY APPEAR ELSEWHERE IN THE DOCUMENT (do not duplicate this content in your output; the recipient will see it separately):
${staticSummary || '(none provided)'}
${brandColorHint ? `\n${brandColorHint}\n` : ''}
${design.detected_headline ? `STRUCTURAL HINT — the original design's headline pattern was: "${design.detected_headline}". Follow a similar structural rhythm for the new headline, but tailor it to the recipient.` : ''}

RECIPIENT: ${companyName}
ADDITIONAL CONTEXT ABOUT THIS RECIPIENT (may be empty): ${notes || '(none provided)'}

Write a tailored headline, one opening paragraph, 2-3 body paragraphs, and a closing/CTA paragraph for a proposal addressed to ${companyName}. Keep it specific to them, not generic.
${JSON_SCHEMA_FORMAT}`;
}

async function generateAnthropic({ prompt, apiKey, model }) {
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: model || 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    tools: [GENERATE_TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: 'submit_proposal_copy' },
    messages: [{ role: 'user', content: prompt }],
  });
  const toolUse = message.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Model did not return structured output');
  return toolUse.input;
}

async function generateOpenAI({ prompt, apiKey, model }) {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: model || 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are an expert B2B proposal writer. Always respond with valid JSON only, no markdown.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 1500,
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No content returned from OpenAI');
  const parsed = JSON.parse(content);
  if (!parsed.headline || !parsed.opening || !parsed.bodyParagraphs || !parsed.closing) {
    throw new Error('Invalid structured output from OpenAI');
  }
  return parsed;
}

async function generateGemini({ prompt, apiKey, model }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({
    model: model || 'gemini-2.0-flash',
    generationConfig: {
      temperature: 0.7,
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    },
  });
  const result = await generativeModel.generateContent(prompt);
  const text = result.response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Defensive only — native JSON mode should never hit this.
    parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
  }
  if (!parsed.headline || !parsed.opening || !parsed.bodyParagraphs || !parsed.closing) {
    throw new Error('Invalid structured output from Gemini');
  }
  return parsed;
}

async function generateGroq({ prompt, apiKey, model }) {
  const client = new Groq({ apiKey });
  const response = await client.chat.completions.create({
    // Kept in sync with the Groq models actually available to this account
    // (see GROQ_MODELS in routes/becca.js) — llama-3.3/llama-4 model IDs
    // that used to work here have since been removed from Groq's catalog.
    model: model || 'openai/gpt-oss-20b',
    messages: [
      {
        role: 'system',
        content: 'You are an expert B2B proposal writer. Always respond with valid JSON only, no markdown.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 1500,
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No content returned from Groq');
  const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed.headline || !parsed.opening || !parsed.bodyParagraphs || !parsed.closing) {
    throw new Error('Invalid structured output from Groq');
  }
  return parsed;
}

const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    generate: generateAnthropic,
  },
  openai: {
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    generate: generateOpenAI,
  },
  gemini: {
    name: 'Google Gemini',
    envKey: 'GEMINI_API_KEY',
    generate: generateGemini,
  },
  groq: {
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    generate: generateGroq,
  },
};

export function getAvailableProviders() {
  const result = {};
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    result[id] = {
      name: provider.name,
      configured: Boolean(process.env[provider.envKey]),
    };
  }
  return result;
}

export function getActiveProvider() {
  return process.env.AI_PROVIDER || 'anthropic';
}

export function generateProposal({ design, companyName, notes, provider: providerOverride, model }) {
  const providerId = providerOverride || getActiveProvider();
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Unknown AI provider: ${providerId}`);

  const apiKey = process.env[provider.envKey];
  if (!apiKey) throw new Error(`${provider.name} API key is not configured (set ${provider.envKey} in .env)`);

  const prompt = buildPrompt({ design, companyName, notes });
  return provider.generate({ prompt, apiKey, model });
}

export async function generateText(prompt, { provider: providerOverride, model } = {}) {
  const providerId = providerOverride || getActiveProvider();
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Unknown AI provider: ${providerId}`);

  const apiKey = process.env[provider.envKey];
  if (!apiKey) throw new Error(`${provider.name} API key is not configured (set ${provider.envKey} in .env)`);

  // Raw text generation — bypasses proposal-specific validation
  if (providerId === 'groq') {
    const { default: Groq } = await import('groq-sdk');
    const client = new Groq({ apiKey });
    const response = await client.chat.completions.create({
      model: model || 'openai/gpt-oss-20b',
      messages: [{ role: 'system', content: 'You are an expert content strategist. Return only valid JSON, no markdown.' }, { role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1500,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No content returned from Groq');
    return content;
  }
  return provider.generate({ prompt, apiKey, model });
}

import { useState } from 'react';

const STYLE_PRESETS = [
  { label: 'Photorealistic', value: 'photorealistic, high quality, detailed' },
  { label: 'Minimalist', value: 'minimalist, clean design, simple shapes, modern' },
  { label: 'Bold & Colorful', value: 'bold colors, vibrant, eye-catching, dynamic' },
  { label: 'Dark & Moody', value: 'dark theme, moody lighting, dramatic, cinematic' },
  { label: 'Corporate', value: 'professional, corporate, clean, business' },
  { label: 'Artistic', value: 'artistic, painterly, creative, abstract' },
  { label: 'Neon/Cyberpunk', value: 'neon lights, cyberpunk, futuristic, glowing' },
  { label: 'Watercolor', value: 'watercolor, soft edges, pastel colors, artistic' },
];

export default function AIGeneratePanel({ onGenerate, generating }) {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('');
  const [negative, setNegative] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  function handleGenerate() {
    if (!prompt.trim() || generating) return;
    const fullPrompt = style ? `${prompt.trim()}, ${style}` : prompt.trim();
    onGenerate(fullPrompt, negative.trim());
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleGenerate();
    }
  }

  return (
    <div className="ai-generate-panel">
      <div className="ai-gen-header">
        <span className="ai-gen-title">AI Generate</span>
      </div>

      <div className="ai-gen-body">
        <label className="ai-gen-label">Describe your design</label>
        <textarea
          className="ai-gen-textarea"
          placeholder="A modern tech startup hero banner with gradient background..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
        />

        <label className="ai-gen-label">Style preset</label>
        <div className="ai-gen-styles">
          {STYLE_PRESETS.map((s) => (
            <button
              key={s.value}
              className={`ai-gen-style-btn ${style === s.value ? 'active' : ''}`}
              onClick={() => setStyle(style === s.value ? '' : s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <button className="ai-gen-advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? '− Advanced' : '+ Advanced'}
        </button>

        {showAdvanced && (
          <div className="ai-gen-advanced">
            <label className="ai-gen-label">Negative prompt (what to avoid)</label>
            <textarea
              className="ai-gen-textarea"
              placeholder="blurry, low quality, text, watermark..."
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              rows={2}
            />
          </div>
        )}

        <button
          className="ai-gen-submit"
          onClick={handleGenerate}
          disabled={!prompt.trim() || generating}
        >
          {generating ? 'Generating...' : 'Generate Image'}
        </button>
        <div className="ai-gen-hint">Ctrl/Cmd+Enter to generate. Powered by Flux (free).</div>
      </div>
    </div>
  );
}

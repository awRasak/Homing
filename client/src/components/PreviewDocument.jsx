import { useEffect } from 'react';
import { ensureGoogleFontLoaded } from '../lib/googleFonts';

export default function PreviewDocument({ design, proposal, companyName }) {
  useEffect(() => {
    ensureGoogleFontLoaded(design.headlineFont);
    ensureGoogleFontLoaded(design.bodyFont);
  }, [design.headlineFont, design.bodyFont]);

  const headline = proposal?.headline || (companyName ? `A proposal for ${companyName}` : 'Your tailored headline will appear here');
  const opening = proposal?.opening || 'Generate a draft to see the opening paragraph, tailored to your recipient, appear here.';
  const bodyParagraphs = proposal?.bodyParagraphs?.length
    ? proposal.bodyParagraphs
    : ['Body paragraphs will appear here once you generate a draft.'];
  const closing = proposal?.closing || '';

  return (
    <div
      id="proposal-preview"
      className="proposal-doc"
      style={{ '--accent': design.accentColor, fontFamily: `"${design.bodyFont}", sans-serif` }}
    >
      <header className="proposal-doc-header">
        {design.logoDataUrl && <img src={design.logoDataUrl} alt="" className="proposal-logo" />}
        <div className="proposal-sender">
          <div className="proposal-sender-name">{design.senderName || 'Your name'}</div>
          <div className="proposal-tagline">{design.tagline}</div>
        </div>
      </header>

      {design.heroImageDataUrl && (
        <img src={design.heroImageDataUrl} alt="" className="proposal-hero" />
      )}

      <h1 className="proposal-headline" style={{ fontFamily: `"${design.headlineFont}", sans-serif` }}>
        {headline}
      </h1>

      <p className="proposal-opening">{opening}</p>

      {bodyParagraphs.map((p, i) => (
        <p key={i} className="proposal-body-paragraph">{p}</p>
      ))}

      {closing && <p className="proposal-closing">{closing}</p>}

      {(design.staticSections || []).filter((s) => s.heading || s.body).map((s, i) => (
        <section key={i} className="proposal-static-section">
          <h2 style={{ fontFamily: `"${design.headlineFont}", sans-serif` }}>{s.heading}</h2>
          <p>{s.body}</p>
        </section>
      ))}
    </div>
  );
}

import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    process.env.CHROME_PATH,
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function buildProposalHTML(design, proposal) {
  const staticSections = JSON.parse(design.static_sections || '[]');
  const bodyParagraphs = proposal.body_paragraphs
    ? JSON.parse(proposal.body_paragraphs)
    : [];

  const sectionsHTML = staticSections
    .map(
      (s) => `
    <div class="section">
      <h2>${escapeHtml(s.heading)}</h2>
      <p>${escapeHtml(s.body)}</p>
    </div>`
    )
    .join('');

  const bodyHTML = bodyParagraphs
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('');

  const logoImg = design.logo_data_url
    ? `<img src="${design.logo_data_url}" class="logo" />`
    : '';

  const heroImg = design.hero_image_data_url
    ? `<div class="hero"><img src="${design.hero_image_data_url}" /></div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=${encodeURIComponent(design.headline_font || 'Inter')}:wght@400;700&family=${encodeURIComponent(design.body_font || 'Inter')}:wght@400;700&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: '${design.body_font || 'Inter'}', sans-serif;
    color: #1a1a1a;
    line-height: 1.6;
    padding: 48px;
    max-width: 800px;
    margin: 0 auto;
  }
  .logo {
    max-height: 48px;
    margin-bottom: 24px;
  }
  .hero img {
    width: 100%;
    border-radius: 8px;
    margin-bottom: 32px;
  }
  h1 {
    font-family: '${design.headline_font || 'Inter'}', sans-serif;
    font-size: 28px;
    font-weight: 700;
    color: ${design.accent_color || '#1a1a1a'};
    margin-bottom: 16px;
    line-height: 1.2;
  }
  .sender {
    font-size: 14px;
    color: #666;
    margin-bottom: 32px;
  }
  h2 {
    font-family: '${design.headline_font || 'Inter'}', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: ${design.accent_color || '#1a1a1a'};
    margin: 24px 0 8px;
  }
  p {
    font-size: 15px;
    margin-bottom: 12px;
  }
  .closing {
    margin-top: 32px;
    padding-top: 16px;
    border-top: 1px solid #e5e5e5;
  }
  .footer {
    margin-top: 48px;
    padding-top: 16px;
    border-top: 1px solid #e5e5e5;
    font-size: 12px;
    color: #999;
  }
</style>
</head>
<body>
  ${logoImg}
  ${heroImg}
  <h1>${escapeHtml(proposal.headline || '')}</h1>
  ${design.sender_name ? `<div class="sender">Prepared by ${escapeHtml(design.sender_name)}${design.tagline ? ` · ${escapeHtml(design.tagline)}` : ''}</div>` : ''}
  <p>${escapeHtml(proposal.opening || '')}</p>
  ${sectionsHTML}
  ${bodyHTML}
  <div class="closing">
    <p>${escapeHtml(proposal.closing || '')}</p>
  </div>
  <div class="footer">Generated with Homing</div>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function generatePDF(design, proposal) {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error(
      'Chrome/Chromium not found. Install Google Chrome or set CHROME_PATH in .env'
    );
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    const html = buildProposalHTML(design, proposal);
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });

    return pdf;
  } finally {
    await browser.close();
  }
}

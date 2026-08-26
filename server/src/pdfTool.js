import { execFile } from 'child_process';

let fitzAvailable = null; // null = unknown (probe still running), true/false after boot probe
let probing = false;

// One-shot boot probe: is `python3 -c "import fitz"` working? The structural
// PDF export path needs PyMuPDF; without it we log once and fall back cleanly.
export function probePyMuPDF() {
  if (probing || fitzAvailable !== null) return;
  probing = true;
  execFile('python3', ['-c', 'import fitz'], (err) => {
    fitzAvailable = !err;
    if (err) {
      console.error('[PDF] PyMuPDF not available — structural export will fall back to Puppeteer. Install with: pip install pymupdf');
    } else {
      console.log('[PDF] PyMuPDF available — structural export enabled.');
    }
  });
}

export function isPyMuPDFAvailable() {
  return fitzAvailable;
}

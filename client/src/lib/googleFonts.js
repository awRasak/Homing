// Curated shortlist of Google Fonts for the headline/body dropdowns.
export const CURATED_GOOGLE_FONTS = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Source Sans 3',
  'Nunito Sans',
  'Work Sans',
  'Playfair Display',
  'Merriweather',
  'Lora',
  'PT Serif',
  'Arimo',
  'Tinos',
  'Gelasio',
  'Carlito',
  'Georgia',
  'DM Sans',
  'Space Grotesk',
];

// Common licensed/corporate fonts mapped to their metric-compatible Google Font.
export const METRIC_COMPATIBLE_MAP = {
  Arial: 'Arimo',
  'Arial,Bold': 'Arimo',
  Helvetica: 'Arimo',
  'Helvetica Neue': 'Arimo',
  'Times New Roman': 'Tinos',
  Times: 'Tinos',
  Georgia: 'Gelasio',
  Calibri: 'Carlito',
  Cambria: 'Georgia', // no direct metric twin bundled; falls back to a serif already on the list
};

const SANS_HEURISTIC_SHORTLIST = ['Inter', 'Roboto', 'Open Sans', 'Work Sans'];
const SERIF_HEURISTIC_SHORTLIST = ['Lora', 'PT Serif', 'Merriweather', 'Playfair Display'];

function normalizeFontName(raw) {
  if (!raw) return '';
  // PDF embedded font names often look like "ABCDEF+Calibri-Bold" or "Calibri,Bold"
  return raw
    .replace(/^[A-Z]{6}\+/, '')
    .replace(/-(Bold|Italic|BoldItalic|Regular|Medium|Light|SemiBold)$/i, '')
    .replace(/,(Bold|Italic|BoldItalic|Regular)$/i, '')
    .trim();
}

function looksSerif(fontName) {
  return /serif|times|georgia|garamond|cambria|book|minion|palatino/i.test(fontName);
}

/**
 * Resolve a raw PDF-embedded font name to a usable Google Font, and report
 * which of the three outcomes occurred so the UI can be honest about it.
 * @returns {{ family: string, outcome: 'exact' | 'metric-compatible' | 'heuristic', detectedName: string }}
 */
export function resolveFont(rawFontName, roleHint = 'body') {
  const cleaned = normalizeFontName(rawFontName);

  if (!cleaned) {
    const guess = roleHint === 'headline' ? SANS_HEURISTIC_SHORTLIST[4] || 'Inter' : 'Inter';
    return { family: guess, outcome: 'heuristic', detectedName: rawFontName || '(none detected)' };
  }

  const exactMatch = CURATED_GOOGLE_FONTS.find(
    (f) => f.toLowerCase() === cleaned.toLowerCase()
  );
  if (exactMatch) {
    return { family: exactMatch, outcome: 'exact', detectedName: cleaned };
  }

  const mapped = METRIC_COMPATIBLE_MAP[cleaned];
  if (mapped) {
    return { family: mapped, outcome: 'metric-compatible', detectedName: cleaned };
  }

  const shortlist = looksSerif(cleaned) ? SERIF_HEURISTIC_SHORTLIST : SANS_HEURISTIC_SHORTLIST;
  const guess = roleHint === 'headline' ? shortlist[0] : shortlist[1] || shortlist[0];
  return { family: guess, outcome: 'heuristic', detectedName: cleaned };
}

export function outcomeLabel(outcome) {
  switch (outcome) {
    case 'exact':
      return 'matched exactly on Google Fonts';
    case 'metric-compatible':
      return 'swapped for a metric-compatible Google Font equivalent';
    case 'heuristic':
      return "couldn't be resolved — guessed from a serif/sans-serif shortlist";
    default:
      return '';
  }
}

let loadedFonts = new Set();
export function ensureGoogleFontLoaded(family) {
  if (!family || loadedFonts.has(family)) return;
  loadedFonts.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family
  )}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

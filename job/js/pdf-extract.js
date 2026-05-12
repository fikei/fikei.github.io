// pdf-extract — shared client-side file-to-text helper.
//
// .md / .txt → UTF-8.
// .pdf       → pdfjs-dist v4, lazy-loaded from jsdelivr.
// other      → best-effort .text().
//
// Used by:
//   - job/js/components/job-career.js (Base resume / Work history uploads)
//   - job/js/components/job-onboarding.js (Stage 1 multi-doc bundle)

let _pdfLib = null;
async function getPdfLib() {
  if (_pdfLib) return _pdfLib;
  const PDFJS_VERSION = '4.7.76';
  const mod = await import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.mjs`);
  mod.GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.mjs`;
  _pdfLib = mod;
  return mod;
}

async function readPdfAsText(file) {
  const lib = await getPdfLib();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    // Re-flow text items into lines using their y coordinates so page order
    // matches reading order. Without this PDFs come out as a token soup.
    const lines = new Map();
    for (const item of tc.items) {
      const y = Math.round(item.transform[5]);
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push(item);
    }
    const ordered = Array.from(lines.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    pages.push(ordered.join('\n'));
  }
  return pages.join('\n\n').trim();
}

export async function readFileAsText(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return await readPdfAsText(file);
  }
  return await file.text();
}

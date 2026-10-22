// Comprobantes en PDF con PDF.js (Mozilla), incluido en vendor/pdfjs para que
// funcione sin internet. Se carga solo cuando se usa un PDF.

const LIB = 'vendor/pdfjs/pdf.min.js';
const WORKER = 'vendor/pdfjs/pdf.worker.min.js';
const MAX_SIDE = 4000; // límite de tamaño de canvas en iPhone

let libPromise = null;

function loadLib() {
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      if (window.pdfjsLib) return resolve(window.pdfjsLib);
      const s = document.createElement('script');
      s.src = LIB;
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER;
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { s.remove(); reject(new Error('No se pudo cargar el lector de PDF')); };
      document.head.appendChild(s);
    });
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

// PDF.js se queda con el buffer que recibe, por eso se le pasa una copia.
export async function openPdf(buffer) {
  const lib = await loadLib();
  return lib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
}

export async function renderPage(doc, number, width) {
  const page = await doc.getPage(number);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(width / base.width, MAX_SIDE / base.height);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // intent 'print' dibuja sin requestAnimationFrame, que se pausa si la app no
  // está en pantalla (y el PDF se quedaría "cargando" para siempre).
  await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
  page.cleanup();
  return canvas;
}

// Los PDF de los bancos traen el texto adentro: se lee directo, sin OCR.
export async function extractText(doc, maxPages = 5) {
  const lines = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let line = '';
    for (const item of content.items) {
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; } else line += ' ';
    }
    if (line.trim()) lines.push(line);
    page.cleanup();
  }
  return lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 1).join('\n');
}

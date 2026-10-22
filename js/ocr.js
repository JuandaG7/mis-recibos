// Lectura del texto de los recibos (para poder buscarlos) con Tesseract.js.
// Se carga solo cuando hace falta. La primera vez descarga el idioma español
// (unos MB) y después queda guardado en el celular.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let workerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error('Sin conexión para cargar el lector de texto')); };
    document.head.appendChild(s);
  });
}

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(TESSERACT_URL);
      return window.Tesseract.createWorker('spa');
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

export async function ensureOcrReady() {
  await getWorker();
}

export async function recognizeText(blob) {
  const worker = await getWorker();
  const { data } = await worker.recognize(blob);
  return (data.text || '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 1)
    .join('\n');
}

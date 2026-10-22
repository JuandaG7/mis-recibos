// Utilidades para procesar las fotos de los recibos con <canvas>.

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// Reduce la imagen para que su lado más largo no pase de maxSide.
// Se reduce por pasos a la mitad para que las miniaturas queden nítidas.
export function scaleToCanvas(src, maxSide) {
  let w = src.naturalWidth || src.width;
  let h = src.naturalHeight || src.height;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const tw = w * k, th = h * k;

  let current = src;
  while (w / 2 > tw * 1.2) {
    w /= 2; h /= 2;
    const step = newCanvas(w, h);
    const sctx = step.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(current, 0, 0, step.width, step.height);
    if (current !== src) freeCanvas(current);
    current = step;
  }

  const out = newCanvas(tw, th);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, out.width, out.height);
  if (current !== src) freeCanvas(current);
  return out;
}

// Gira 90° a la derecha.
export function rotateCanvas(src) {
  const out = newCanvas(src.height, src.width);
  const ctx = out.getContext('2d');
  ctx.translate(out.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(src, 0, 0);
  return out;
}

// rect en proporciones (0..1) del canvas.
export function cropCanvas(src, rect) {
  const sx = Math.round(rect.x * src.width);
  const sy = Math.round(rect.y * src.height);
  const sw = Math.round(rect.w * src.width);
  const sh = Math.round(rect.h * src.height);
  const out = newCanvas(sw, sh);
  out.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
}

// "Mejorar": estira el contraste para que el papel se vea blanco y la tinta oscura.
export function enhanceCanvas(src) {
  const out = newCanvas(src.width, src.height);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, out.width, out.height);
  const p = data.data;

  const hist = new Uint32Array(256);
  let samples = 0;
  for (let i = 0; i < p.length; i += 16) {
    hist[(p[i] * 77 + p[i + 1] * 150 + p[i + 2] * 29) >> 8]++;
    samples++;
  }
  const pick = (fraction) => {
    let acc = 0;
    const target = samples * fraction;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
    return 255;
  };
  const lo = pick(0.02);
  const hi = Math.max(pick(0.92), lo + 20);

  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    lut[v] = Math.round(Math.pow(t, 1.15) * 255);
  }
  for (let i = 0; i < p.length; i += 4) {
    p[i] = lut[p[i]];
    p[i + 1] = lut[p[i + 1]];
    p[i + 2] = lut[p[i + 2]];
  }
  ctx.putImageData(data, 0, 0);
  return out;
}

// toBlob a veces no responde (el navegador lo deja para cuando esté desocupado);
// si tarda, se convierte con toDataURL, que es más lento pero siempre termina.
export function canvasToBlob(canvas, quality = 0.8) {
  return new Promise((resolve, reject) => {
    let done = false;
    const fallback = () => {
      if (done) return;
      done = true;
      try {
        const data = canvas.toDataURL('image/jpeg', quality);
        const bin = atob(data.slice(data.indexOf(',') + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        resolve(new Blob([bytes], { type: 'image/jpeg' }));
      } catch (err) {
        reject(err);
      }
    };
    const timer = setTimeout(fallback, 3000);
    canvas.toBlob((b) => {
      if (done) return;
      clearTimeout(timer);
      if (b) { done = true; resolve(b); } else fallback();
    }, 'image/jpeg', quality);
  });
}

// iOS limita la memoria total de los canvas; liberarlos evita errores.
export function freeCanvas(c) {
  if (c && c.width !== undefined && c.getContext) { c.width = 0; c.height = 0; }
}

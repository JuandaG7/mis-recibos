# Mis Recibos

App web para guardar fotos de recibos y comprobantes en carpetas y subcarpetas, y encontrarlos rápido.
Todo se guarda **en el iPhone** (IndexedDB). No hay servidor ni cuentas.

La primera vez que se abre muestra una explicación en 5 pantallas (se puede volver a ver con el botón **Ayuda**) y una guía de "Primeros pasos" en el inicio que desaparece cuando ya creó una carpeta, guardó un recibo e hizo su primera copia.

## Comprobantes en PDF

El botón **Fotos o PDF** acepta fotos de la galería y PDF (por ejemplo, comprobantes del banco guardados en la app Archivos). Del PDF se guarda el archivo original (para compartirlo tal cual), una imagen de la primera página y el texto que trae adentro, así se puede buscar al instante. Se ven todas las páginas al tocarlo. Límite: 20 MB por PDF. Usa PDF.js de Mozilla, incluido en `vendor/pdfjs` (v3.11.174) para que funcione sin internet.

Para un PDF que llegó por WhatsApp: abrirlo en WhatsApp → Compartir → **Guardar en Archivos**, y luego subirlo desde la app.

## Pagos del mes

En **Pagos del mes** se anotan los pagos que se repiten cada mes: lo que le pagan a ella (arriendos) y lo que paga ella (servicios, impuestos). Cada pago queda "listo" cuando se guarda su recibo de ese mes (al guardar un recibo aparecen botones para elegir a qué pago corresponde) o cuando se marca a mano ("Ya me pagaron, no tengo recibo"). Si tiene día del mes y ya pasó, aparece como **atrasado**. En el inicio hay una tarjeta con el resumen del mes actual.

## Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub (por ejemplo `mis-recibos`) y sube todos los archivos de esta carpeta:
   ```bash
   git init && git add . && git commit -m "Mis Recibos v1"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/mis-recibos.git
   git push -u origin main
   ```
2. En GitHub: **Settings → Pages → Branch: `main` / `(root)` → Save**.
3. En 1–2 minutos queda en `https://TU_USUARIO.github.io/mis-recibos/`.

Para probar en tu Mac: `python3 -m http.server 8765` y abre `http://localhost:8765`.

## Instalarla en el iPhone de tu mamá

1. Abre el enlace en **Safari** (no en Chrome).
2. Toca **Compartir** (el cuadrito con la flecha) → **Agregar a inicio** → **Agregar**.
3. Desde ahora, ábrela **siempre desde ese ícono**. Lo guardado en Safari y lo guardado en la app instalada son cosas separadas.

## Cosas importantes que debe saber ella

- **No borrar el ícono de la app**: si lo borra, se borran los recibos.
- **Copia de seguridad cada semana**: botón **Copia** → *Hacer copia de seguridad* → *Guardar copia* → *Guardar en Archivos* → **iCloud Drive**. La app le recuerda si pasan 7 días.
- Cada copia guarda **solo lo nuevo** desde la anterior (si es mucho, se divide en partes de máx. 60 MB que se guardan una por una). Por eso **no hay que borrar las copias anteriores**. Antes de cambiar de celular conviene hacer una **copia completa**; después de eso las anteriores se pueden borrar.
- Si cambia de celular: instala la app, **Copia** → *Recuperar copia* y **elige todos** los archivos `mis-recibos-copia-….zip` de iCloud Drive (se pueden marcar varios). No se borra nada de lo que ya haya en la app.

## Cómo funciona

| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura de la página |
| `css/styles.css` | Diseño (modo claro y oscuro) |
| `js/app.js` | Pantallas, carpetas, cámara/recorte, búsqueda, copia de seguridad |
| `js/db.js` | Guardado local (IndexedDB) |
| `js/image.js` | Recortar, girar, mejorar y comprimir fotos |
| `js/pdf.js` | Abre los PDF: primera página, todas las páginas y su texto |
| `js/ocr.js` | Lee el texto de las fotos con Tesseract.js (en español) para poder buscar |
| `js/zip.js` | Crea y lee el archivo de copia de seguridad |
| `icons/` | Logo al óleo (`logo.jpg`) e íconos del iPhone. `logo.svg` es la versión plana original |
| `sw.js` | Permite abrirla sin internet y que las actualizaciones lleguen solas |

- Las fotos se comprimen a ~1800 px (≈150–400 KB cada una). Los PDF se guardan tal cual.
- La lectura de texto necesita internet la primera vez (descarga el idioma español, unos MB) y corre en el celular; nada se envía a otros servidores.
- **Al publicar una actualización**, sube el número en `CACHE` de `sw.js` (`mis-recibos-v7`, …) para que la versión sin internet también se actualice.

## Ideas para la siguiente versión

- Varias fotos por recibo.
- Guardar directo desde WhatsApp ("Compartir → Mis Recibos") — requiere app nativa.
- Respaldo automático en iCloud — requiere app nativa (Swift).
- Exportar una carpeta completa en PDF para el contador.

import * as db from './db.js';
import {
  loadImageFromFile, scaleToCanvas, rotateCanvas, cropCanvas,
  enhanceCanvas, canvasToBlob, freeCanvas,
} from './image.js';
import { makeZip, readZip } from './zip.js';
import { recognizeText, ensureOcrReady } from './ocr.js';
import { openPdf, renderPage, extractText } from './pdf.js';

const APP_VERSION = '1.3.0';
const BACKUP_REMINDER_DAYS = 7;
const FOLDER_COLORS = ['#F2A81D', '#0B8996', '#E66A5A', '#5B7FD0', '#8B65C2', '#2F9E6E', '#D4628A', '#7D8C2E'];

const state = {
  folders: [],
  receipts: [],
  query: '',
  currentFolderId: null,
  lastFolderId: null,
  lastBackupAt: null,
  backup: null,
  ocrRunning: false,
  recurring: [],
  marks: [],
  payPeriod: null,
  pendingLink: null,
};

const thumbUrls = new Map();

/* ---------- utilidades ---------- */

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtDate(s) {
  return s ? parseISO(s).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}
function fmtDateLong(s) {
  return s ? parseISO(s).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
}
function fmtMonth(s) {
  const t = parseISO(s).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function fmtMoney(n) {
  return n == null ? '' : '$\u00a0' + n.toLocaleString('es-CO');
}
function fmtBytes(n) {
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2).replace('.', ',') + ' GB';
}
function plural(n, one, many) {
  return `${n.toLocaleString('es-CO')} ${n === 1 ? one : many}`;
}
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function daysSince(ts) {
  return Math.floor((Date.now() - ts) / 86400000);
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}
function go(path) {
  if (location.hash === '#' + path) render();
  else location.hash = path;
}

/* ---------- íconos ---------- */

const I = {
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.2A2.2 2.2 0 0 1 5.2 5h4.1c.6 0 1.1.2 1.5.6L12.3 7h6.5A2.2 2.2 0 0 1 21 9.2v8.6a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 17.8z" fill="currentColor"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13.5 6.2 6.3A2 2 0 0 1 8.1 5h7.8a2 2 0 0 1 1.9 1.3L20 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 13.5h4.5l1 2h5l1-2H20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="18.5" cy="12" r="2" fill="currentColor"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11M8 7.5l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  move: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.2A2.2 2.2 0 0 1 5.2 5h4.1c.6 0 1.1.2 1.5.6L12.3 7h6.5A2.2 2.2 0 0 1 21 9.2v8.6a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 17.8z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 13.5h6.5M13 11l2.5 2.5L13 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" stroke="currentColor" stroke-width="1.8"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.8 12a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8l.8-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  rotate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 2.5v4.2h-4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z" fill="currentColor"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  install: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5v7M9 11.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  receipt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 8h6M9 11.5h6M9 15h3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17" r="1.1" fill="currentColor"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.2-1.8A1.5 1.5 0 0 1 10.5 3.5h3a1.5 1.5 0 0 1 1.2.7L15.9 6h1.6A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8.5 14.5l2.2 2.2 4.3-4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrowIn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19.5h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  arrowOut: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 19.5h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7.5v5.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="16.8" r="1.4" fill="currentColor"/></svg>',
  palette: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.5-1-2.6 0-1 .8-1.7 1.8-1.7h2.1a3.8 3.8 0 0 0 3.8-3.8c0-4-3.8-7.2-8.5-7.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="7.8" cy="11" r="1.3" fill="currentColor"/><circle cx="10.5" cy="7.4" r="1.3" fill="currentColor"/><circle cx="15" cy="7.6" r="1.3" fill="currentColor"/></svg>',
};

/* ---------- datos ---------- */

const folderById = (id) => state.folders.find((f) => f.id === id);
const receiptById = (id) => state.receipts.find((r) => r.id === id);

function childrenOf(parentId) {
  return state.folders
    .filter((f) => (f.parentId || null) === (parentId || null))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}
function pathOf(id) {
  const out = [];
  let f = folderById(id);
  for (let guard = 0; f && guard < 50; guard++) { out.unshift(f); f = folderById(f.parentId); }
  return out;
}
function pathText(id) {
  return id && folderById(id) ? pathOf(id).map((f) => f.name).join(' › ') : 'Sin carpeta';
}
function descendantIds(id) {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) for (const c of childrenOf(ids[i])) ids.push(c.id);
  return ids;
}
function countsByFolder() {
  const direct = new Map();
  for (const r of state.receipts) direct.set(r.folderId || null, (direct.get(r.folderId || null) || 0) + 1);
  const memo = new Map();
  const total = (id) => {
    if (memo.has(id)) return memo.get(id);
    let n = direct.get(id) || 0;
    for (const c of childrenOf(id)) n += total(c.id);
    memo.set(id, n);
    return n;
  };
  return { total, unfiled: direct.get(null) || 0 };
}
function sortReceipts(list) {
  return list.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
}

/* ---------- búsqueda ---------- */

function joinDigits(s) {
  return s.replace(/(\d)[.,'\s](?=\d{3}\b)/g, '$1');
}
function searchReceipts(query) {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return sortReceipts(state.receipts.filter((r) => {
    const hay = norm([
      r.note, r.ocrText, pathText(r.folderId), fmtDateLong(r.date), r.date,
      r.amount != null ? String(r.amount) + ' ' + fmtMoney(r.amount) : '',
    ].join(' \n '));
    const hayDigits = joinDigits(hay);
    return tokens.every((t) => {
      if (/^\$?[\d.,]+$/.test(t)) {
        const digits = t.replace(/[^\d]/g, '');
        return digits && hayDigits.replace(/[.,]/g, ' ').includes(digits);
      }
      return hay.includes(t);
    });
  }));
}
function searchFolders(query) {
  const q = norm(query.trim());
  if (!q) return [];
  return state.folders.filter((f) => norm(f.name).includes(q));
}

/* ---------- piezas de interfaz ---------- */

function folderCard(f, counts) {
  const n = counts.total(f.id);
  const subs = childrenOf(f.id).length;
  const sub = [plural(n, 'recibo', 'recibos'), subs ? plural(subs, 'carpeta', 'carpetas') : ''].filter(Boolean).join(' · ');
  return `<button class="folder-card" data-action="open-folder" data-id="${f.id}" style="--fc:${f.color}">
    <span class="folder-ico" style="color:${f.color}">${I.folder}</span>
    <span class="folder-name">${esc(f.name)}</span>
    <span class="folder-count">${sub}</span>
  </button>`;
}
function newFolderCard(parentId, label) {
  return `<button class="folder-card folder-new" data-action="new-folder" data-parent="${parentId || ''}">
    <span class="folder-ico">${I.plus}</span>
    <span class="folder-name">${label}</span>
  </button>`;
}
function receiptRow(r, showPath = true) {
  const title = r.note || 'Recibo';
  const sub = [fmtDate(r.date), fmtMoney(r.amount)].filter(Boolean).join(' · ');
  return `<button class="receipt-row" data-action="open-receipt" data-id="${r.id}">
    <span class="thumb"><img data-thumb="${r.id}" alt="">${r.fileType === 'pdf' ? '<span class="badge-pdf badge-sm">PDF</span>' : ''}</span>
    <span class="r-main">
      <span class="r-title">${esc(title)}</span>
      <span class="r-sub">${esc(sub)}</span>
      ${showPath ? `<span class="r-path">${esc(pathText(r.folderId))}</span>` : ''}
    </span>
    <span class="r-chev">${I.chevron}</span>
  </button>`;
}
function topbar({ back, backLabel = 'Atrás', title, right = '' }) {
  return `<header class="topbar">
    <button class="back-btn" data-action="nav" data-to="${esc(back)}">${I.back}<span>${esc(backLabel)}</span></button>
    <span class="topbar-right">${right}</span>
  </header>
  ${title ? `<h1 class="page-title">${esc(title)}</h1>` : ''}`;
}
function emptyState(icon, title, text) {
  return `<div class="empty"><span class="empty-ico">${icon}</span><p class="empty-title">${title}</p><p class="empty-text">${text}</p></div>`;
}

async function hydrateThumbs(root = document) {
  const imgs = root.querySelectorAll('img[data-thumb]:not([src])');
  for (const img of imgs) {
    const id = img.dataset.thumb;
    let url = thumbUrls.get(id);
    if (!url) {
      const rec = await db.get('images', id);
      if (!rec) continue;
      url = URL.createObjectURL(new Blob([rec.thumb], { type: 'image/jpeg' }));
      thumbUrls.set(id, url);
    }
    img.src = url;
  }
}

/* ---------- pantallas ---------- */

function render() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [, kind, id] = hash.split('/');
  let showBar = false;
  if (kind !== 'pagos') state.payPeriod = null;

  if (kind === 'f' && folderById(id)) { renderFolder(id); showBar = true; }
  else if (kind === 'sin-carpeta') { renderFolder(null); showBar = true; }
  else if (kind === 'r' && receiptById(id)) renderReceipt(id);
  else if (kind === 'ajustes') renderSettings();
  else if (kind === 'pagos') renderPayments();
  else { renderHome(); showBar = true; }

  $('#capture-bar').hidden = !showBar;
  document.body.classList.toggle('has-bar', showBar);
  hydrateThumbs(view);
}

function installBanner() {
  if (!isIOS() || isStandalone()) return '';
  return `<div class="banner banner-warn">
    <span class="banner-ico">${I.install}</span>
    <div><p class="banner-title">Primero instálala en tu iPhone</p>
    <p class="banner-text">Toca el botón <b>Compartir</b> de Safari y luego <b>“Agregar a inicio”</b>. Usa siempre el ícono que aparece en tu pantalla: lo que guardes aquí en Safari no aparece en la app instalada.</p></div>
  </div>`;
}
// Solo avisa cuando ya hubo una copia antes; la primera copia la pide la guía de "Primeros pasos".
function backupBanner() {
  if (!state.receipts.length || !state.lastBackupAt) return '';
  const days = daysSince(state.lastBackupAt);
  if (days < BACKUP_REMINDER_DAYS) return '';
  return `<button class="banner banner-backup" data-action="nav" data-to="/ajustes">
    <span class="banner-ico">${I.shield}</span>
    <div><p class="banner-title">Es hora de hacer una copia</p><p class="banner-text">Tu última copia fue hace ${plural(days, 'día', 'días')}. Toca aquí para hacerla.</p></div>
  </button>`;
}

function startGuide() {
  const steps = [
    { done: state.folders.length > 0, action: 'new-folder', title: 'Crea tu primera carpeta', text: 'Una por cada negocio, por ejemplo “Arriendos”.' },
    { done: state.receipts.length > 0, action: 'capture-camera', title: 'Guarda tu primer recibo', text: 'Toca el botón <b>Tomar foto</b> de abajo.' },
    { done: !!state.lastBackupAt, action: 'nav', to: '/ajustes', title: 'Haz tu primera copia', text: 'Así no pierdes nada si se daña el celular.' },
  ];
  if (steps.every((s) => s.done)) return '';
  const next = steps.findIndex((s) => !s.done);
  return `<section class="guide" aria-label="Primeros pasos">
    <p class="guide-title">Primeros pasos</p>
    <ol class="guide-list">
      ${steps.map((s, i) => `<li>
        <button class="guide-step ${s.done ? 'done' : ''} ${i === next ? 'next' : ''}" data-action="${s.action}" ${s.to ? `data-to="${s.to}"` : ''} ${s.done ? 'disabled' : ''}>
          <span class="guide-num">${s.done ? I.check : i + 1}</span>
          <span class="guide-body"><b>${s.title}</b><span>${s.text}</span></span>
          ${!s.done ? `<span class="r-chev">${I.chevron}</span>` : ''}
        </button></li>`).join('')}
    </ol>
  </section>`;
}

function renderHome() {
  state.currentFolderId = null;
  view.innerHTML = `
    <header class="home-head">
      <div class="brand"><img class="brand-logo" src="icons/logo.jpg" alt=""><h1 class="app-title">Mis Recibos</h1></div>
      <div class="head-actions">
        <button class="head-btn" data-action="help">${I.help}<span>Ayuda</span></button>
        <button class="head-btn" data-action="nav" data-to="/ajustes">${I.shield}<span>Copia</span></button>
      </div>
    </header>
    ${installBanner()}
    ${backupBanner()}
    ${startGuide()}
    <label class="search">
      ${I.search}
      <input id="search" type="search" placeholder="Buscar: nombre, valor o mes" value="${esc(state.query)}" autocomplete="off" autocorrect="off" enterkeyhint="search">
      <button class="search-clear" data-action="clear-search" aria-label="Borrar búsqueda" ${state.query ? '' : 'hidden'}>${I.close}</button>
    </label>
    <div id="home-body"></div>`;
  const input = $('#search');
  input.addEventListener('input', () => {
    state.query = input.value;
    $('.search-clear').hidden = !state.query;
    renderHomeBody();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  renderHomeBody();
}

function renderHomeBody() {
  const body = $('#home-body');
  if (!body) return;
  const counts = countsByFolder();

  if (state.query.trim()) {
    const folders = searchFolders(state.query);
    const receipts = searchReceipts(state.query);
    const pending = state.receipts.filter((r) => r.ocrStatus !== 'done').length;
    body.innerHTML = `
      ${folders.length ? `<h2 class="section-title">Carpetas</h2><div class="folder-grid">${folders.map((f) => folderCard(f, counts)).join('')}</div>` : ''}
      <h2 class="section-title">${receipts.length ? plural(receipts.length, 'recibo encontrado', 'recibos encontrados') : 'Recibos'}</h2>
      ${receipts.length ? `<div class="list">${receipts.slice(0, 100).map((r) => receiptRow(r)).join('')}</div>`
        : (folders.length ? '' : emptyState(I.search, 'No encontré nada', 'Prueba con otra palabra, un valor como <b>350.000</b> o un mes como <b>marzo</b>.'))}
      ${pending ? `<p class="hint">Todavía estoy leyendo el texto de ${plural(pending, 'recibo', 'recibos')}. Puede que aparezcan más resultados en un rato.</p>` : ''}`;
    hydrateThumbs(body);
    return;
  }

  const roots = childrenOf(null);
  const recent = state.receipts.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  body.innerHTML = `
    ${paymentsCard()}
    <h2 class="section-title">Carpetas</h2>
    <div class="folder-grid">
      ${roots.map((f) => folderCard(f, counts)).join('')}
      ${counts.unfiled ? `<button class="folder-card" data-action="nav" data-to="/sin-carpeta">
        <span class="folder-ico folder-ico-muted">${I.inbox}</span>
        <span class="folder-name">Sin carpeta</span>
        <span class="folder-count">${plural(counts.unfiled, 'recibo', 'recibos')}</span></button>` : ''}
      ${newFolderCard(null, 'Nueva carpeta')}
    </div>
    ${roots.length === 1 && !childrenOf(roots[0].id).length ? '<p class="hint">Toca una carpeta para abrirla. Adentro puedes crear más carpetas, por ejemplo una por edificio o por local.</p>' : ''}
    <h2 class="section-title">Últimos guardados</h2>
    ${recent.length ? `<div class="list">${recent.map((r) => receiptRow(r)).join('')}</div>`
      : emptyState(I.receipt, 'Aún no hay recibos', 'Toca <b>Tomar foto</b> abajo para guardar el primero.')}`;
  hydrateThumbs(body);
}

function renderFolder(id) {
  state.currentFolderId = id;
  const folder = id ? folderById(id) : null;
  const counts = countsByFolder();
  const parentPath = folder && folder.parentId ? '/f/' + folder.parentId : '/';
  const parentName = folder && folder.parentId ? folderById(folder.parentId)?.name : 'Inicio';
  const subs = id ? childrenOf(id) : [];
  const receipts = sortReceipts(state.receipts.filter((r) => (r.folderId || null) === id));

  let groups = '';
  let lastMonth = '';
  for (const r of receipts) {
    const m = r.date ? fmtMonth(r.date) : 'Sin fecha';
    if (m !== lastMonth) {
      if (lastMonth) groups += '</div>';
      groups += `<h3 class="month-title">${m}</h3><div class="list">`;
      lastMonth = m;
    }
    groups += receiptRow(r, false);
  }
  if (lastMonth) groups += '</div>';

  const crumbs = folder ? pathOf(id).slice(0, -1) : [];
  view.innerHTML = `
    ${topbar({
      back: parentPath,
      backLabel: parentName,
      title: folder ? folder.name : 'Sin carpeta',
      right: folder ? `<button class="options-btn" data-action="folder-menu" data-id="${id}">${I.more}<span>Opciones</span></button>` : '',
    })}
    ${folder && !subs.length && !receipts.length ? `<div class="tip">${I.help}<p>Esta carpeta está vacía. Puedes <b>guardar recibos aquí</b> con el botón <b>Tomar foto</b>, o <b>crear carpetas adentro</b> (por ejemplo, una por edificio o por local).</p></div>` : ''}
    ${crumbs.length > 1 ? `<p class="crumbs">${crumbs.map((c) => `<button data-action="open-folder" data-id="${c.id}">${esc(c.name)}</button>`).join(' › ')} › <span>${esc(folder.name)}</span></p>` : ''}
    ${folder ? `
      <h2 class="section-title">Carpetas adentro</h2>
      <div class="folder-grid">${subs.map((f) => folderCard(f, counts)).join('')}${newFolderCard(id, subs.length ? 'Nueva carpeta' : 'Crear carpeta aquí')}</div>` : ''}
    ${folder && !subs.length && !receipts.length ? '' : `<h2 class="section-title">${receipts.length ? plural(receipts.length, 'recibo', 'recibos') : 'Recibos'}</h2>`}
    ${receipts.length ? groups : (folder && !subs.length ? '' : emptyState(I.receipt, 'No hay recibos aquí', folder ? 'Toca <b>Tomar foto</b> abajo y se guardará en esta carpeta.' : 'Todos tus recibos están en carpetas.'))}`;
  window.scrollTo(0, 0);
}

function renderReceipt(id) {
  const r = receiptById(id);
  const back = r.folderId && folderById(r.folderId) ? '/f/' + r.folderId : (r.folderId ? '/' : '/sin-carpeta');
  const backLabel = r.folderId && folderById(r.folderId) ? folderById(r.folderId).name : 'Sin carpeta';
  const ocr = r.ocrStatus === 'done'
    ? (r.ocrText ? `<pre class="ocr-text">${esc(r.ocrText)}</pre>` : '<p class="hint">No se encontró texto en esta foto.</p>')
    : `<p class="hint">${state.ocrRunning ? 'Leyendo el texto de este recibo…' : 'El texto se leerá cuando haya internet.'}</p>`;

  view.innerHTML = `
    ${topbar({ back, backLabel })}
    <h1 class="page-title">${esc(r.note || 'Recibo')}</h1>
    <button class="receipt-image" data-action="view-image" data-id="${id}" aria-label="Ver en grande">
      <img id="receipt-full" alt="Foto del recibo">
      ${r.fileType === 'pdf' ? `<span class="badge-pdf">PDF · ${plural(r.pages || 1, 'página', 'páginas')}</span>` : ''}
      <span class="zoom-hint">${r.fileType === 'pdf' ? 'Toca para ver el PDF completo' : 'Toca para ver en grande'}</span>
    </button>
    <dl class="details">
      <div><dt>Fecha</dt><dd>${esc(fmtDateLong(r.date)) || '—'}</dd></div>
      <div><dt>Valor</dt><dd>${esc(fmtMoney(r.amount)) || '—'}</dd></div>
      <div><dt>Carpeta</dt><dd>${esc(pathText(r.folderId))}</dd></div>
      ${recurringById(r.recurringId) ? `<div><dt>Pago mensual</dt><dd>${esc(recurringById(r.recurringId).name)} · ${esc(monthName(periodOf(r.date)))}</dd></div>` : ''}
      ${r.note ? `<div><dt>Nota</dt><dd>${esc(r.note)}</dd></div>` : ''}
    </dl>
    <button class="btn btn-primary btn-block" data-action="share-receipt" data-id="${id}">${I.share} Enviar o compartir</button>
    <div class="action-row">
      <button class="btn btn-secondary" data-action="edit-receipt" data-id="${id}">${I.edit} Editar</button>
      <button class="btn btn-secondary" data-action="move-receipt" data-id="${id}">${I.move} Mover</button>
      <button class="btn btn-secondary btn-danger-text" data-action="delete-receipt" data-id="${id}">${I.trash} Borrar</button>
    </div>
    <details class="ocr">
      <summary>Texto leído del recibo</summary>
      ${ocr}
    </details>`;
  window.scrollTo(0, 0);

  db.get('images', id).then((rec) => {
    const img = $('#receipt-full');
    if (!rec || !img) return;
    prepareShare(r, rec);
    const url = URL.createObjectURL(imageBlob(rec));
    img.onload = () => URL.revokeObjectURL(url);
    img.src = url;
  });
}

function renderSettings() {
  const pending = state.receipts.filter((r) => r.ocrStatus !== 'done').length;
  const sinCopia = state.receipts.filter((r) => !r.backedUp).length;
  const last = state.lastBackupAt
    ? `Última copia: <b>${new Date(state.lastBackupAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}</b>`
    : '<b>Aún no has hecho ninguna copia.</b>';
  const b = state.backup;
  let action;
  if (b && b.busy) {
    action = `<button class="btn btn-primary btn-block" disabled><span class="spinner"></span> Preparando${b.parts.length > 1 ? ` parte ${b.index + 1} de ${b.parts.length}` : ' la copia'}…</button>`;
  } else if (b && b.file) {
    const multi = b.parts.length > 1;
    action = `<div class="backup-ready">
        <p><b>${multi ? `Parte ${b.index + 1} de ${b.parts.length} lista` : 'La copia está lista'}</b> (${fmtBytes(b.file.size)}).</p>
        <p class="muted">Toca el botón, elige <b>“Guardar en Archivos”</b> y luego <b>iCloud Drive</b>.${multi ? ' Después aparecerá la siguiente parte.' : ''}</p>
        <button class="btn btn-primary btn-block" data-action="backup-save">${I.share} ${multi ? `Guardar parte ${b.index + 1} de ${b.parts.length}` : 'Guardar copia'}</button>
      </div>`;
  } else {
    action = `<button class="btn btn-primary btn-block" data-action="backup-make" ${!state.receipts.length && !state.folders.length ? 'disabled' : ''}>${I.shield} Hacer copia de seguridad</button>`;
  }

  view.innerHTML = `
    ${topbar({ back: '/', backLabel: 'Inicio', title: 'Copia de seguridad' })}
    <section class="card">
      <p>Tus recibos se guardan <b>solo en este iPhone</b>. Si se pierde o se daña el celular, o si borras el ícono de la app, se pierden. Por eso es importante hacer una copia cada semana y guardarla en <b>iCloud Drive</b>.</p>
      <p class="muted">${last}<br>${plural(state.receipts.length, 'recibo', 'recibos')} en ${plural(state.folders.length, 'carpeta', 'carpetas')}.${state.lastBackupAt ? `<br>${sinCopia ? `<b>${plural(sinCopia, 'recibo nuevo', 'recibos nuevos')}</b> sin copia.` : 'Todos tus recibos tienen copia.'}` : ''}</p>
      ${action}
    </section>
    <div class="tip">${I.help}<p>Cada copia guarda <b>solo lo nuevo</b>, para que sea rápida. Guarda todas en la misma carpeta de iCloud Drive y <b>no borres las anteriores</b>.</p></div>

    <h2 class="section-title">Recuperar una copia</h2>
    <section class="card">
      <p>Si cambias de celular o se borró la app, instálala de nuevo, toca el botón y <b>elige todos los archivos de copia</b> (puedes marcar varios). Lo que ya tengas en la app no se borra.</p>
      <button class="btn btn-secondary btn-block" data-action="restore">Recuperar copia</button>
    </section>

    <h2 class="section-title">Copia completa</h2>
    <section class="card">
      <p>Hace una copia con <b>todo</b> otra vez. Úsala antes de cambiar de celular: después de guardarla puedes borrar las copias anteriores.</p>
      <button class="btn btn-secondary btn-block" data-action="backup-full" ${state.backup || !state.receipts.length ? 'disabled' : ''}>Hacer copia completa</button>
    </section>

    <h2 class="section-title">Búsqueda</h2>
    <section class="card">
      <p>La app lee el texto de cada recibo para que puedas buscarlo por nombre, valor o fecha. Necesita internet la primera vez.</p>
      <p class="muted">${pending ? `${plural(pending, 'recibo pendiente', 'recibos pendientes')} por leer.${state.ocrRunning ? ' Leyendo ahora…' : ''}` : 'Todos los recibos están listos para buscar.'}</p>
      ${pending && !state.ocrRunning ? '<button class="btn btn-secondary btn-block" data-action="ocr-now">Leer ahora</button>' : ''}
    </section>

    <h2 class="section-title">Ayuda</h2>
    <section class="card">
      <p>¿Olvidaste cómo funciona algo? Vuelve a ver la explicación paso a paso.</p>
      <button class="btn btn-secondary btn-block" data-action="help">${I.help} Ver cómo se usa la app</button>
    </section>

    <p class="footer-note" id="storage-note">Mis Recibos · versión ${APP_VERSION}</p>`;
  window.scrollTo(0, 0);

  navigator.storage?.estimate?.().then((est) => {
    const note = $('#storage-note');
    if (note && est.usage) note.textContent = `Mis Recibos · versión ${APP_VERSION} · ${fmtBytes(est.usage)} usados`;
  }).catch(() => {});
}

/* ---------- ventanas emergentes ---------- */

function openSheet(html) {
  const root = $('#modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  root.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));
  document.body.classList.add('locked');
  const close = () => {
    backdrop.classList.remove('open');
    setTimeout(() => {
      backdrop.remove();
      if (!root.children.length && $('#editor-root').hidden && $('#viewer-root').hidden) document.body.classList.remove('locked');
    }, 220);
  };
  return { el: backdrop, close };
}

function askText({ title, placeholder = '', value = '', okText = 'Aceptar' }) {
  return new Promise((resolve) => {
    const s = openSheet(`
      <h2 class="sheet-title">${esc(title)}</h2>
      <input class="field" id="ask-input" placeholder="${esc(placeholder)}" value="${esc(value)}" maxlength="60" enterkeyhint="done" autocapitalize="sentences">
      <div class="sheet-actions">
        <button class="btn btn-secondary" data-m="cancel">Cancelar</button>
        <button class="btn btn-primary" data-m="ok">${esc(okText)}</button>
      </div>`);
    const input = $('#ask-input', s.el);
    input.focus();
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; s.close(); resolve(v); };
    const submit = () => { const v = input.value.trim(); if (v) finish(v); else input.focus(); };
    s.el.addEventListener('click', (e) => {
      if (e.target === s.el) return finish(null);
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (m === 'cancel') finish(null);
      if (m === 'ok') submit();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  });
}

function confirmBox({ title, message = '', okText = 'Aceptar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const s = openSheet(`
      <h2 class="sheet-title">${esc(title)}</h2>
      ${message ? `<p class="sheet-text">${message}</p>` : ''}
      <div class="sheet-actions">
        ${cancelText ? `<button class="btn btn-secondary" data-m="cancel">${esc(cancelText)}</button>` : ''}
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-m="ok">${esc(okText)}</button>
      </div>`);
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; s.close(); resolve(v); };
    s.el.addEventListener('click', (e) => {
      if (e.target === s.el) return finish(false);
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (m) finish(m === 'ok');
    });
  });
}

const alertBox = (title, message) => confirmBox({ title, message, okText: 'Entendido', cancelText: '' });

function actionSheet(title, options) {
  return new Promise((resolve) => {
    const s = openSheet(`
      <h2 class="sheet-title">${esc(title)}</h2>
      <div class="sheet-options">
        ${options.map((o) => o.forInput
          ? `<label class="sheet-option" for="${o.forInput}" data-m="${o.key}">${o.icon || ''}<span>${esc(o.label)}</span></label>`
          : `<button class="sheet-option ${o.danger ? 'danger' : ''}" data-m="${o.key}">${o.icon || ''}<span>${esc(o.label)}</span></button>`).join('')}
      </div>
      <button class="btn btn-secondary btn-block" data-m="">Cancelar</button>`);
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; s.close(); resolve(v); };
    s.el.addEventListener('click', (e) => {
      if (e.target === s.el) return finish(null);
      const b = e.target.closest('[data-m]');
      if (b) finish(b.dataset.m || null);
    });
  });
}

// Devuelve el id de la carpeta elegida, null para "Sin carpeta" o undefined si cancela.
function pickFolder({ title = '¿En qué carpeta?', selected = null } = {}) {
  return new Promise((resolve) => {
    const rows = [];
    const walk = (parentId, depth) => {
      for (const f of childrenOf(parentId)) {
        rows.push(`<div class="tree-row ${f.id === selected ? 'selected' : ''}" style="--depth:${depth}">
          <button class="tree-pick" data-pick="${f.id}"><span class="tree-ico" style="color:${f.color}">${I.folder}</span><span>${esc(f.name)}</span>${f.id === selected ? `<span class="tree-check">${I.check}</span>` : ''}</button>
          <button class="tree-add" data-add="${f.id}" aria-label="Crear carpeta dentro de ${esc(f.name)}">${I.plus}</button>
        </div>`);
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);

    const s = openSheet(`
      <h2 class="sheet-title">${esc(title)}</h2>
      <div class="tree">
        ${rows.join('') || '<p class="hint">Aún no tienes carpetas. Crea la primera.</p>'}
        <div class="tree-row ${selected === null ? 'selected' : ''}" style="--depth:0">
          <button class="tree-pick" data-pick=""><span class="tree-ico tree-ico-muted">${I.inbox}</span><span>Sin carpeta</span>${selected === null ? `<span class="tree-check">${I.check}</span>` : ''}</button>
        </div>
      </div>
      <button class="btn btn-secondary btn-block" data-add="">${I.plus} Nueva carpeta principal</button>
      <button class="btn btn-ghost btn-block" data-cancel>Cancelar</button>`);

    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; s.close(); resolve(v); };
    s.el.addEventListener('click', async (e) => {
      if (e.target === s.el || e.target.closest('[data-cancel]')) return finish(undefined);
      const pick = e.target.closest('[data-pick]');
      if (pick) return finish(pick.dataset.pick || null);
      const add = e.target.closest('[data-add]');
      if (add) {
        const f = await createFolder(add.dataset.add || null);
        if (f) finish(f.id);
      }
    });
  });
}

function pickColor(current) {
  return new Promise((resolve) => {
    const s = openSheet(`
      <h2 class="sheet-title">Elige un color</h2>
      <p class="sheet-text">Las carpetas de adentro también tendrán este color.</p>
      <div class="swatches">
        ${FOLDER_COLORS.map((c) => `<button class="swatch ${c === current ? 'selected' : ''}" data-color="${c}" style="--sw:${c}" aria-label="Color">${c === current ? I.check : ''}</button>`).join('')}
      </div>
      <button class="btn btn-secondary btn-block" data-cancel>Cancelar</button>`);
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; s.close(); resolve(v); };
    s.el.addEventListener('click', (e) => {
      if (e.target === s.el || e.target.closest('[data-cancel]')) return finish(null);
      const b = e.target.closest('[data-color]');
      if (b) finish(b.dataset.color);
    });
  });
}

/* ---------- bienvenida (explicación paso a paso) ---------- */

const WELCOME = [
  {
    art: '<img class="welcome-logo" src="icons/logo.jpg" alt="">',
    title: 'Bienvenida a Mis Recibos',
    text: 'Aquí guardas las fotos de tus recibos y comprobantes de pago, y los encuentras en segundos. Te explico cómo funciona en 5 pasos.',
  },
  {
    art: `<div class="mock mock-tree">
      <div class="mock-row" style="--fc:#F2A81D"><span style="color:#F2A81D">${I.folder}</span>Arriendos</div>
      <div class="mock-row sub" style="--fc:#F2A81D"><span style="color:#F2A81D">${I.folder}</span>Edificio Central</div>
      <div class="mock-row sub" style="--fc:#F2A81D"><span style="color:#F2A81D">${I.folder}</span>Local del centro</div>
      <div class="mock-row" style="--fc:#0B8996"><span style="color:#0B8996">${I.folder}</span>Servicios</div>
    </div>`,
    title: '1. Todo en carpetas',
    text: 'Crea una carpeta por cada negocio, como <b>Arriendos</b>. Adentro puedes crear otras, como <b>Edificio Central</b>.',
  },
  {
    art: `<div class="mock"><div class="btn btn-primary mock-btn">${I.camera} Tomar foto</div></div>`,
    title: '2. Toma la foto',
    text: 'Toca el botón <b>Tomar foto</b>, ajusta los círculos a las esquinas del recibo y elige la carpeta. Si el banco te mandó un <b>PDF</b>, súbelo con <b>Fotos o PDF</b>.',
  },
  {
    art: `<div class="mock"><div class="search mock-search">${I.search}<span>marzo</span></div></div>`,
    title: '3. Encuéntralo rápido',
    text: 'Escribe en el buscador una palabra del recibo: un nombre, un valor como <b>350.000</b> o un mes como <b>marzo</b>.',
  },
  {
    art: `<div class="mock mock-pay">
      <div class="mock-row"><span class="pay-status done">${I.check}</span>Arriendo Apto 301</div>
      <div class="mock-row"><span class="pay-status done">${I.check}</span>Arriendo Apto 302</div>
      <div class="mock-row"><span class="pay-status late">${I.alert}</span>Local del centro</div>
    </div>`,
    title: '4. Pagos del mes',
    text: 'Anota lo que te pagan o pagas cada mes, como los arriendos. La app te muestra <b>quién ya pagó y quién falta</b>.',
  },
  {
    art: `<div class="welcome-ico">${I.shield}</div>`,
    title: '5. Haz una copia cada semana',
    text: 'Tus recibos se guardan solo en este iPhone. Una vez por semana toca <b>Copia</b> y guárdala en iCloud Drive. La app te lo recordará.',
  },
];

function openWelcome() {
  const root = $('#welcome-root');
  let i = 0;
  const draw = () => {
    const step = WELCOME[i];
    const last = i === WELCOME.length - 1;
    root.innerHTML = `
      <div class="welcome">
        <div class="welcome-top">${last ? '' : '<button class="ed-link" data-w="skip">Saltar</button>'}</div>
        <div class="welcome-art">${step.art}</div>
        <h1 class="welcome-title">${step.title}</h1>
        <p class="welcome-text">${step.text}</p>
        <div class="dots" aria-label="Paso ${i + 1} de ${WELCOME.length}">${WELCOME.map((_, n) => `<span class="${n === i ? 'on' : ''}"></span>`).join('')}</div>
        <div class="welcome-actions">
          ${i > 0 ? '<button class="btn btn-secondary" data-w="prev">Atrás</button>' : ''}
          <button class="btn btn-primary btn-lg" data-w="next">${last ? 'Empezar' : 'Siguiente'}</button>
        </div>
      </div>`;
  };
  const close = () => {
    root.hidden = true;
    root.innerHTML = '';
    root.onclick = null;
    document.body.classList.remove('locked');
    db.setMeta('welcomed', true);
  };
  root.onclick = (e) => {
    const w = e.target.closest('[data-w]')?.dataset.w;
    if (w === 'skip') close();
    if (w === 'prev') { i--; draw(); }
    if (w === 'next') { if (i === WELCOME.length - 1) close(); else { i++; draw(); } }
  };
  draw();
  root.hidden = false;
  document.body.classList.add('locked');
}

let toastTimer = null;
function showToast(msg) {
  const t = $('#toast');
  t.innerHTML = `${I.check}<span>${esc(msg)}</span>`;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => { t.hidden = true; }, 250);
  }, 2600);
}

/* ---------- carpetas ---------- */

async function createFolder(parentId) {
  const name = await askText({
    title: parentId ? `Nueva carpeta dentro de “${folderById(parentId)?.name}”` : 'Nueva carpeta',
    placeholder: parentId ? 'Ej: Edificio Central' : 'Ej: Arriendos',
    okText: 'Crear',
  });
  if (!name) return null;
  const dup = childrenOf(parentId).find((f) => norm(f.name) === norm(name));
  if (dup) { await alertBox('Ya existe esa carpeta', `Ya tienes una carpeta llamada “${esc(dup.name)}” en este lugar.`); return null; }
  const color = parentId ? folderById(parentId).color : FOLDER_COLORS[childrenOf(null).length % FOLDER_COLORS.length];
  const f = { id: uid(), name, parentId: parentId || null, color, createdAt: Date.now() };
  await db.put('folders', f);
  state.folders.push(f);
  render();
  showToast(`Carpeta “${name}” creada`);
  return f;
}

async function folderMenu(id) {
  const f = folderById(id);
  const choice = await actionSheet(f.name, [
    { key: 'rename', label: 'Cambiar nombre', icon: I.edit },
    { key: 'color', label: 'Cambiar color', icon: I.palette },
    { key: 'delete', label: 'Borrar carpeta', icon: I.trash, danger: true },
  ]);
  if (choice === 'color') {
    const color = await pickColor(f.color);
    if (!color) return;
    // Las carpetas de adentro toman el mismo color, para reconocer cada negocio.
    for (const fid of descendantIds(id)) {
      const x = folderById(fid);
      x.color = color;
      await db.put('folders', x);
    }
    render();
  } else if (choice === 'rename') {
    const name = await askText({ title: 'Cambiar nombre', value: f.name, okText: 'Guardar' });
    if (!name || name === f.name) return;
    const dup = childrenOf(f.parentId).find((x) => x.id !== id && norm(x.name) === norm(name));
    if (dup) return alertBox('Ya existe esa carpeta', `Ya tienes una carpeta llamada “${esc(dup.name)}” en este lugar.`);
    f.name = name;
    await db.put('folders', f);
    render();
  } else if (choice === 'delete') {
    const subs = childrenOf(id).length;
    const recs = state.receipts.filter((r) => r.folderId === id).length;
    if (subs || recs) {
      const parts = [recs ? plural(recs, 'recibo', 'recibos') : '', subs ? plural(subs, 'carpeta', 'carpetas') : ''].filter(Boolean).join(' y ');
      return alertBox('Esta carpeta no está vacía', `Tiene ${parts}. Primero muévelos o bórralos, para no perder nada.`);
    }
    if (!(await confirmBox({ title: `¿Borrar “${f.name}”?`, message: 'La carpeta está vacía.', okText: 'Borrar', danger: true }))) return;
    await db.remove('folders', id);
    state.folders = state.folders.filter((x) => x.id !== id);
    go(f.parentId ? '/f/' + f.parentId : '/');
    showToast('Carpeta borrada');
  }
}

/* ---------- recibos ---------- */

function detailsFields({ note = '', date = todayISO(), amount = null } = {}) {
  return `
    <label class="field-label" for="d-note">¿Qué es? <span class="optional">(opcional)</span></label>
    <input class="field" id="d-note" value="${esc(note)}" placeholder="Ej: Arriendo apto 301, marzo" maxlength="80" autocapitalize="sentences">
    <div class="field-pair">
      <div>
        <label class="field-label" for="d-date">Fecha</label>
        <input class="field" id="d-date" type="date" value="${esc(date)}">
      </div>
      <div>
        <label class="field-label" for="d-amount">Valor <span class="optional">(opcional)</span></label>
        <input class="field" id="d-amount" inputmode="numeric" placeholder="$ 0" value="${amount != null ? esc(fmtMoney(amount)) : ''}">
      </div>
    </div>`;
}
function bindAmountInput(root) {
  const input = $('#d-amount', root);
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 13);
    input.value = digits ? fmtMoney(Number(digits)) : '';
  });
}
function readDetails(root) {
  const digits = $('#d-amount', root).value.replace(/\D/g, '');
  return {
    note: $('#d-note', root).value.trim(),
    date: $('#d-date', root).value || todayISO(),
    amount: digits ? Number(digits) : null,
  };
}

async function editReceipt(id) {
  const r = receiptById(id);
  const s = openSheet(`
    <h2 class="sheet-title">Editar recibo</h2>
    ${detailsFields(r)}
    ${state.recurring.length ? `
      <label class="field-label" for="d-rec">¿Es de un pago mensual?</label>
      <select class="field" id="d-rec">
        <option value="">No</option>
        ${sortRecurring(state.recurring).map((x) => `<option value="${x.id}" ${x.id === r.recurringId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
      </select>` : ''}
    <div class="sheet-actions">
      <button class="btn btn-secondary" data-m="cancel">Cancelar</button>
      <button class="btn btn-primary" data-m="ok">Guardar</button>
    </div>`);
  bindAmountInput(s.el);
  s.el.addEventListener('click', async (e) => {
    if (e.target === s.el) return s.close();
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m === 'cancel') s.close();
    if (m === 'ok') {
      if (s.saving) return;
      s.saving = true;
      Object.assign(r, readDetails(s.el));
      const rec = $('#d-rec', s.el);
      if (rec) r.recurringId = rec.value || null;
      await db.put('receipts', r);
      s.close();
      render();
      showToast('Cambios guardados');
    }
  });
}

async function moveReceipt(id) {
  const r = receiptById(id);
  const target = await pickFolder({ title: 'Mover a…', selected: r.folderId || null });
  if (target === undefined || target === (r.folderId || null)) return;
  r.folderId = target;
  await db.put('receipts', r);
  render();
  showToast(`Movido a ${pathText(target)}`);
}

async function deleteReceipt(id) {
  const r = receiptById(id);
  const ok = await confirmBox({
    title: '¿Borrar este recibo?',
    message: 'Se borrará la foto. Esto no se puede deshacer.',
    okText: 'Borrar', danger: true,
  });
  if (!ok) return;
  await db.deleteReceipt(id);
  state.receipts = state.receipts.filter((x) => x.id !== id);
  if (thumbUrls.has(id)) { URL.revokeObjectURL(thumbUrls.get(id)); thumbUrls.delete(id); }
  go(r.folderId && folderById(r.folderId) ? '/f/' + r.folderId : '/');
  showToast('Recibo borrado');
}

function fileName(r) {
  const base = norm(r.note || 'recibo').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'recibo';
  return `${base}-${r.date || todayISO()}.${r.fileType === 'pdf' ? 'pdf' : 'jpg'}`;
}

// El archivo se prepara al abrir el recibo: el iPhone solo deja abrir "Compartir"
// justo después del toque, sin esperas de por medio.
let shareCache = null;

function prepareShare(r, rec) {
  shareCache = { id: r.id, file: new File([rec.full], fileName(r), { type: rec.type || 'image/jpeg' }) };
}

async function shareReceipt(id) {
  const r = receiptById(id);
  if (!shareCache || shareCache.id !== id) {
    const rec = await db.get('images', id);
    if (!rec) return;
    prepareShare(r, rec);
  }
  // Solo el archivo: si se agrega texto, "Guardar en Archivos" crea un .txt aparte
  // y algunas apps descartan la foto.
  const file = shareCache.file;
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
  } else {
    downloadFile(file);
  }
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* ---------- pagos del mes ---------- */

const recurringById = (id) => (id ? state.recurring.find((x) => x.id === id) : null);

function periodOf(date) {
  return (date || todayISO()).slice(0, 7);
}
function currentPeriod() {
  return todayISO().slice(0, 7);
}
function shiftPeriod(p, n) {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthName(p) {
  return parseISO(p + '-01').toLocaleDateString('es-CO', { month: 'long' });
}
function sortRecurring(list) {
  return list.slice().sort((a, b) => (a.day || 99) - (b.day || 99) || a.name.localeCompare(b.name, 'es'));
}
// Un pago solo cuenta desde el mes en que se creó.
function itemsFor(period) {
  return sortRecurring(state.recurring.filter((x) => {
    const d = new Date(x.createdAt);
    const created = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return created <= period;
  }));
}
function paymentStatus(item, period) {
  const receipt = state.receipts.find((r) => r.recurringId === item.id && periodOf(r.date) === period);
  const marked = state.marks.some((m) => m.id === `${item.id}|${period}`);
  if (receipt || marked) return { done: true, receipt, marked: !receipt && marked };
  const cur = currentPeriod();
  const late = period < cur || (period === cur && item.day && new Date().getDate() > item.day);
  return { done: false, late };
}
function statusText(item, st) {
  const cobro = item.kind === 'cobro';
  if (st.done) return st.receipt ? (cobro ? 'Ya te pagaron · recibo guardado' : 'Ya pagaste · recibo guardado') : (cobro ? 'Ya te pagaron (sin recibo)' : 'Ya pagaste (sin recibo)');
  if (st.late) return cobro ? 'Atrasado: no te han pagado' : 'Atrasado: no has pagado';
  return item.day ? `Pendiente · ${cobro ? 'te pagan' : 'pagas'} el día ${item.day}` : 'Pendiente';
}
function statusIcon(st) {
  return `<span class="pay-status ${st.done ? 'done' : st.late ? 'late' : 'pending'}">${st.done ? I.check : st.late ? I.alert : I.clock}</span>`;
}

function paymentsCard() {
  if (!state.recurring.length) {
    if (!state.folders.length) return '';
    return `<a class="pay-invite" href="#/pagos">
      <span class="pay-invite-ico">${I.calendar}</span>
      <span class="guide-body"><b>Pagos del mes</b><span>Lleva el control de arriendos y pagos que se repiten cada mes.</span></span>
      <span class="r-chev">${I.chevron}</span>
    </a>`;
  }
  const period = currentPeriod();
  const items = itemsFor(period);
  const list = items.map((i) => ({ i, st: paymentStatus(i, period) }));
  const done = list.filter((x) => x.st.done).length;
  const pending = list.filter((x) => !x.st.done).sort((a, b) => (b.st.late ? 1 : 0) - (a.st.late ? 1 : 0));
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  return `<a class="pay-card" href="#/pagos">
    <span class="pay-card-head">
      <span class="pay-card-title">${I.calendar} Pagos de ${monthName(period)}</span>
      <span class="pay-count ${pending.length ? '' : 'all'}">${done} de ${items.length} listos</span>
    </span>
    <span class="progress"><span style="width:${pct}%"></span></span>
    ${pending.length
      ? `<span class="pay-pending">${pending.slice(0, 3).map(({ i, st }) => `<span class="${st.late ? 'late' : ''}">${st.late ? I.alert : I.clock}<span>${st.late ? 'Atrasado' : 'Falta'}: <b>${esc(i.name)}</b></span></span>`).join('')}
         ${pending.length > 3 ? `<span class="more">y ${pending.length - 3} más… toca para ver todos</span>` : ''}</span>`
      : `<span class="pay-ok">${I.check} Todo al día este mes</span>`}
  </a>`;
}

function renderPayments() {
  const cur = currentPeriod();
  const period = state.payPeriod || cur;
  const items = itemsFor(period);
  const list = items.map((i) => ({ i, st: paymentStatus(i, period) }));
  const done = list.filter((x) => x.st.done).length;
  const money = (kind) => {
    const xs = list.filter((x) => x.i.kind === kind);
    const value = (x) => (x.st.receipt && x.st.receipt.amount != null ? x.st.receipt.amount : x.i.amount);
    const expected = xs.reduce((s, x) => s + (x.i.amount || 0), 0);
    const got = xs.filter((x) => x.st.done).reduce((s, x) => s + (value(x) || 0), 0);
    return { any: xs.length > 0, expected, got };
  };
  const cobros = money('cobro');
  const pagos = money('pago');
  const row = ({ i, st }) => `<button class="pay-row" data-action="pay-item" data-id="${i.id}">
      ${statusIcon(st)}
      <span class="r-main">
        <span class="r-title">${esc(i.name)}</span>
        <span class="r-sub">${esc([i.amount != null ? fmtMoney(i.amount) : '', pathText(i.folderId)].filter(Boolean).join(' · '))}</span>
        <span class="pay-state ${st.done ? 'done' : st.late ? 'late' : ''}">${statusText(i, st)}</span>
      </span>
      <span class="r-chev">${I.chevron}</span>
    </button>`;
  const group = (kind, title, icon) => {
    const xs = list.filter((x) => x.i.kind === kind);
    return xs.length ? `<h2 class="section-title section-icon">${icon}${title}</h2><div class="list">${xs.map(row).join('')}</div>` : '';
  };

  view.innerHTML = `
    ${topbar({ back: '/', backLabel: 'Inicio', title: 'Pagos del mes' })}
    <div class="month-nav">
      <button class="icon-btn" data-action="pay-month" data-n="-1" aria-label="Mes anterior">${I.back}</button>
      <span class="month-label">${esc(fmtMonth(period + '-01'))}</span>
      <button class="icon-btn" data-action="pay-month" data-n="1" aria-label="Mes siguiente" ${period >= shiftPeriod(cur, 1) ? 'disabled' : ''}>${I.chevron}</button>
    </div>
    ${!state.recurring.length ? `
      <div class="tip">${I.help}<p>Aquí anotas lo que <b>te pagan</b> o <b>pagas</b> cada mes, por ejemplo el arriendo de cada apartamento o la luz del local. Cada mes la app te muestra qué ya está listo y qué falta.</p></div>`
    : items.length ? `
      <section class="card pay-summary">
        <p class="pay-big">${done} de ${items.length} <span>listos</span></p>
        <span class="progress"><span style="width:${Math.round((done / items.length) * 100)}%"></span></span>
        ${cobros.any && cobros.expected ? `<p class="muted">Te han pagado <b>${fmtMoney(cobros.got)}</b> de ${fmtMoney(cobros.expected)}</p>` : ''}
        ${pagos.any && pagos.expected ? `<p class="muted">Has pagado <b>${fmtMoney(pagos.got)}</b> de ${fmtMoney(pagos.expected)}</p>` : ''}
      </section>`
    : '<p class="hint">Este mes todavía no tenías pagos anotados.</p>'}
    ${group('cobro', 'Me pagan a mí', I.arrowIn)}
    ${group('pago', 'Yo pago', I.arrowOut)}
    <button class="btn btn-primary btn-block btn-lg pay-add" data-action="pay-add">${I.plus} Agregar pago mensual</button>
    ${state.recurring.length ? '<p class="hint">Toca un pago para guardar su recibo, marcarlo como hecho o cambiarlo.</p>' : ''}`;
  window.scrollTo(0, 0);
}

async function paymentMenu(id) {
  const item = recurringById(id);
  if (!item) return;
  const period = state.payPeriod || currentPeriod();
  const st = paymentStatus(item, period);
  const cobro = item.kind === 'cobro';
  const opts = [];
  if (!st.done) {
    opts.push({ key: 'scan', label: 'Tomar foto del recibo', icon: I.camera, forInput: 'camera-input' });
    opts.push({ key: 'photo', label: 'Elegir de Fotos o un PDF', icon: I.receipt, forInput: 'photos-input' });
    opts.push({ key: 'mark', label: cobro ? 'Ya me pagaron, no tengo recibo' : 'Ya pagué, no tengo recibo', icon: I.check });
  } else if (st.receipt) {
    opts.push({ key: 'view', label: 'Ver el recibo', icon: I.receipt });
  } else {
    opts.push({ key: 'unmark', label: 'Desmarcar (no está listo)', icon: I.close });
  }
  opts.push({ key: 'edit', label: 'Cambiar datos de este pago', icon: I.edit });
  opts.push({ key: 'delete', label: 'Dejar de seguir este pago', icon: I.trash, danger: true });

  // La foto se abre desde un <label> para que el iPhone permita abrir la cámara.
  state.pendingLink = { recurringId: id, period };
  const choice = await actionSheet(`${item.name} · ${monthName(period)}`, opts);
  if (choice !== 'scan' && choice !== 'photo') state.pendingLink = null;

  if (choice === 'mark') {
    const mark = { id: `${id}|${period}`, recurringId: id, period, createdAt: Date.now() };
    await db.put('marks', mark);
    state.marks.push(mark);
    render();
    showToast('Marcado como listo');
  } else if (choice === 'unmark') {
    await db.remove('marks', `${id}|${period}`);
    state.marks = state.marks.filter((m) => m.id !== `${id}|${period}`);
    render();
  } else if (choice === 'view') {
    go('/r/' + st.receipt.id);
  } else if (choice === 'edit') {
    recurringForm(item);
  } else if (choice === 'delete') {
    const ok = await confirmBox({
      title: `¿Dejar de seguir “${item.name}”?`,
      message: 'Ya no aparecerá en los pagos del mes. Los recibos que guardaste <b>no se borran</b>.',
      okText: 'Dejar de seguir', danger: true,
    });
    if (!ok) return;
    await db.remove('recurring', id);
    for (const m of state.marks.filter((x) => x.recurringId === id)) await db.remove('marks', m.id);
    state.recurring = state.recurring.filter((x) => x.id !== id);
    state.marks = state.marks.filter((x) => x.recurringId !== id);
    render();
  }
}

function recurringForm(item = null) {
  let kind = item ? item.kind : 'cobro';
  let folderId = item ? item.folderId : (state.currentFolderId || null);
  let saving = false;
  const s = openSheet(`
    <h2 class="sheet-title">${item ? 'Cambiar pago mensual' : 'Nuevo pago mensual'}</h2>
    ${item ? '' : '<p class="sheet-text">Algo que se repite cada mes, como un arriendo o la luz.</p>'}
    <label class="field-label" for="p-name">¿Qué es?</label>
    <input class="field" id="p-name" value="${esc(item ? item.name : '')}" placeholder="Ej: Arriendo Apto 301" maxlength="60" autocapitalize="sentences">
    <label class="field-label">¿Quién paga?</label>
    <div class="kind-pick">
      <button type="button" data-kind="cobro">${I.arrowIn}<b>Me pagan a mí</b><small>Arriendos, cuotas…</small></button>
      <button type="button" data-kind="pago">${I.arrowOut}<b>Yo pago</b><small>Servicios, impuestos…</small></button>
    </div>
    <label class="field-label">Carpeta de sus recibos</label>
    <button type="button" class="folder-select" data-p="folder"></button>
    <div class="field-pair">
      <div>
        <label class="field-label" for="d-amount">Valor <span class="optional">(opcional)</span></label>
        <input class="field" id="d-amount" inputmode="numeric" placeholder="$ 0" value="${item && item.amount != null ? esc(fmtMoney(item.amount)) : ''}">
      </div>
      <div>
        <label class="field-label" for="p-day">Día del mes <span class="optional">(opcional)</span></label>
        <input class="field" id="p-day" inputmode="numeric" placeholder="Ej: 5" maxlength="2" value="${item && item.day ? item.day : ''}">
      </div>
    </div>
    <p class="field-help">Con el día, la app te avisa cuando un pago está atrasado.</p>
    <div class="sheet-actions">
      <button class="btn btn-secondary" data-p="cancel">Cancelar</button>
      <button class="btn btn-primary" data-p="ok">Guardar</button>
    </div>`);
  const paint = () => {
    s.el.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
    const f = folderId && folderById(folderId);
    const btn = $('[data-p="folder"]', s.el);
    btn.classList.toggle('empty', !f);
    btn.innerHTML = `<span class="tree-ico" style="color:${f ? f.color : 'var(--text-2)'}">${f ? I.folder : I.inbox}</span>
      <span class="folder-select-name">${esc(f ? pathText(folderId) : 'Elegir carpeta')}</span><span class="folder-select-change">Cambiar</span>`;
  };
  paint();
  bindAmountInput(s.el);
  const name = $('#p-name', s.el);
  if (!item) name.focus();

  s.el.addEventListener('click', async (e) => {
    if (e.target === s.el) return s.close();
    const k = e.target.closest('[data-kind]');
    if (k) { kind = k.dataset.kind; paint(); return; }
    const p = e.target.closest('[data-p]')?.dataset.p;
    if (p === 'cancel') s.close();
    if (p === 'folder') {
      const t = await pickFolder({ title: '¿Dónde se guardan sus recibos?', selected: folderId });
      if (t !== undefined) { folderId = t; paint(); }
    }
    if (p === 'ok') {
      const n = name.value.trim();
      if (!n) { name.focus(); name.classList.add('invalid'); return; }
      if (saving) return;
      saving = true;
      const digits = $('#d-amount', s.el).value.replace(/\D/g, '');
      const day = Math.min(31, Math.max(0, Number($('#p-day', s.el).value.replace(/\D/g, '')) || 0)) || null;
      const x = item || { id: uid(), createdAt: Date.now() };
      Object.assign(x, { name: n, kind, folderId: folderId || null, amount: digits ? Number(digits) : null, day });
      await db.put('recurring', x);
      if (!item) state.recurring.push(x);
      s.close();
      render();
      showToast(item ? 'Cambios guardados' : `“${n}” agregado`);
    }
  });
}

// Botones para enlazar el recibo que se está guardando con un pago mensual.
function linkChips() {
  if (!state.recurring.length) return '';
  const period = periodOf(ed.details?.date || todayISO());
  let items = state.recurring;
  if (ed.folderId && folderById(ed.folderId)) {
    const inFolder = new Set(descendantIds(ed.folderId));
    items = items.filter((x) => inFolder.has(x.folderId) || x.id === ed.recurringId);
  }
  if (!items.length) return '';
  items = sortRecurring(items).sort((a, b) => (paymentStatus(a, period).done ? 1 : 0) - (paymentStatus(b, period).done ? 1 : 0));
  return `
    <label class="field-label">¿Es de un pago mensual? <span class="optional">(opcional)</span></label>
    <div class="chips-row">
      ${items.map((x) => `<button type="button" class="chip-btn ${x.id === ed.recurringId ? 'on' : ''}" data-e="link" data-id="${x.id}">${x.id === ed.recurringId ? I.check : ''}${esc(x.name)}</button>`).join('')}
    </div>`;
}

/* ---------- capturar y ajustar foto ---------- */

let ed = null;
const editorRoot = $('#editor-root');

function startCapture(useCamera) {
  state.pendingLink = null;
  const input = useCamera ? $('#camera-input') : $('#photos-input');
  input.value = '';
  input.click();
}

const MAX_PDF_BYTES = 20 * 1024 * 1024;

function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

function onPhotoPicked(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (isPdf(file)) openPdfImport(file);
  else openEditor(file);
}

function showEditorLoading(text) {
  editorRoot.hidden = false;
  document.body.classList.add('locked');
  editorRoot.innerHTML = `<div class="ed-loading"><span class="spinner spinner-lg"></span><p>${text}</p></div>`;
}

// Estado inicial del editor; si se viene de "Pagos del mes", ya trae los datos de ese pago.
function newEditorState(extra) {
  const initialFolder = state.currentFolderId !== null ? state.currentFolderId
    : (state.lastFolderId && folderById(state.lastFolderId) ? state.lastFolderId : null);
  ed = {
    base: null, enhanced: null, useEnhance: false,
    rect: { x: 0.04, y: 0.04, w: 0.92, h: 0.92 },
    folderId: initialFolder, details: null, fullBlob: null, thumbBlob: null, previewBlob: null, previewUrl: null,
    recurringId: null, pdf: null,
    ...extra,
  };
  const link = state.pendingLink && recurringById(state.pendingLink.recurringId);
  if (link) {
    const period = state.pendingLink.period;
    ed.recurringId = link.id;
    ed.folderId = link.folderId && folderById(link.folderId) ? link.folderId : ed.folderId;
    ed.details = {
      note: link.name,
      date: period === currentPeriod() ? todayISO() : `${period}-${String(Math.min(link.day || 1, 28)).padStart(2, '0')}`,
      amount: link.amount ?? null,
    };
  }
  state.pendingLink = null;
}

async function openEditor(file) {
  showEditorLoading('Preparando la foto…');
  try {
    const img = await loadImageFromFile(file);
    newEditorState({ base: scaleToCanvas(img, 2000) });
    renderCrop();
  } catch (err) {
    console.error(err);
    closeEditor();
    alertBox('No se pudo abrir la foto', 'Intenta de nuevo o con otra foto.');
  }
}

async function openPdfImport(file) {
  if (file.size > MAX_PDF_BYTES) {
    state.pendingLink = null;
    return alertBox('El PDF es muy grande', `Este archivo pesa ${fmtBytes(file.size)}. La app acepta PDF de hasta 20 MB.`);
  }
  showEditorLoading('Abriendo el PDF…');
  let doc = null;
  try {
    const buf = await file.arrayBuffer();
    doc = await openPdf(buf);
    const page = await renderPage(doc, 1, 1400);
    const thumb = scaleToCanvas(page, 320);
    const [previewBlob, thumbBlob] = await Promise.all([canvasToBlob(page, 0.82), canvasToBlob(thumb, 0.72)]);
    freeCanvas(page); freeCanvas(thumb);
    const text = await extractText(doc).catch(() => '');
    newEditorState({
      pdf: { pages: doc.numPages, text },
      fullBlob: new Blob([buf], { type: 'application/pdf' }),
      previewBlob, thumbBlob, previewUrl: URL.createObjectURL(thumbBlob),
    });
    renderDetailsStep();
  } catch (err) {
    console.error(err);
    closeEditor();
    const locked = err && err.name === 'PasswordException';
    alertBox('No se pudo abrir el PDF', locked ? 'Este PDF tiene contraseña. Ábrelo, guárdalo sin contraseña e intenta de nuevo.' : 'Puede que el archivo esté dañado. Intenta con otro.');
  } finally {
    if (doc) doc.destroy();
  }
}

function editorCanvas() {
  return ed.useEnhance ? ed.enhanced : ed.base;
}

function renderCrop() {
  editorRoot.innerHTML = `
    <div class="ed-top">
      <button class="ed-link" data-e="cancel">Cancelar</button>
      <span class="ed-title">Ajusta el recibo</span>
      <span class="ed-link ed-placeholder">Cancelar</span>
    </div>
    <p class="ed-hint">Arrastra los <b>círculos blancos</b> a las esquinas del recibo. Si quedó de lado, toca <b>Girar</b>.</p>
    <div class="crop-stage" id="crop-stage">
      <div class="crop-wrap" id="crop-wrap">
        <div class="crop-box" id="crop-box">
          <span class="crop-h" data-h="nw"></span><span class="crop-h" data-h="ne"></span>
          <span class="crop-h" data-h="sw"></span><span class="crop-h" data-h="se"></span>
        </div>
      </div>
    </div>
    <div class="ed-tools">
      <button class="tool" data-e="rotate">${I.rotate}<span>Girar</span></button>
      <button class="tool ${ed.useEnhance ? 'on' : ''}" data-e="enhance" aria-pressed="${ed.useEnhance}">${I.sparkle}<span>Mejorar</span></button>
      <button class="btn btn-primary ed-next" data-e="next">Siguiente</button>
    </div>`;
  mountCanvas();
  bindCrop();
}

function mountCanvas() {
  const wrap = $('#crop-wrap');
  wrap.querySelector('canvas')?.remove();
  const c = editorCanvas();
  c.className = 'crop-canvas';
  wrap.prepend(c);
  layoutCanvas();
}

function layoutCanvas() {
  const stage = $('#crop-stage');
  const c = $('#crop-wrap canvas');
  if (!stage || !c) return;
  const pad = 28;
  const sw = stage.clientWidth - pad * 2;
  const sh = stage.clientHeight - pad * 2;
  const k = Math.min(sw / c.width, sh / c.height);
  c.style.width = Math.floor(c.width * k) + 'px';
  c.style.height = Math.floor(c.height * k) + 'px';
  positionBox();
}

function positionBox() {
  const box = $('#crop-box');
  if (!box) return;
  const { x, y, w, h } = ed.rect;
  box.style.left = x * 100 + '%';
  box.style.top = y * 100 + '%';
  box.style.width = w * 100 + '%';
  box.style.height = h * 100 + '%';
}

function bindCrop() {
  const stage = $('#crop-stage');
  const wrap = $('#crop-wrap');
  const MIN = 0.08;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  let drag = null;

  stage.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-h]');
    const inBox = e.target.closest('#crop-box');
    if (!handle && !inBox) return;
    e.preventDefault();
    drag = { type: handle ? handle.dataset.h : 'move', x: e.clientX, y: e.clientY, r: { ...ed.rect }, id: e.pointerId };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const b = wrap.getBoundingClientRect();
    const dx = (e.clientX - drag.x) / b.width;
    const dy = (e.clientY - drag.y) / b.height;
    const s = drag.r;
    const r = { ...s };
    if (drag.type === 'move') {
      r.x = clamp(s.x + dx, 0, 1 - s.w);
      r.y = clamp(s.y + dy, 0, 1 - s.h);
    } else {
      if (drag.type.includes('w')) { r.x = clamp(s.x + dx, 0, s.x + s.w - MIN); r.w = s.x + s.w - r.x; }
      if (drag.type.includes('e')) { r.w = clamp(s.w + dx, MIN, 1 - s.x); }
      if (drag.type.includes('n')) { r.y = clamp(s.y + dy, 0, s.y + s.h - MIN); r.h = s.y + s.h - r.y; }
      if (drag.type.includes('s')) { r.h = clamp(s.h + dy, MIN, 1 - s.y); }
    }
    ed.rect = r;
    positionBox();
  });
  const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
}

async function cropNext() {
  const btn = $('[data-e="next"]', editorRoot);
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const cropped = cropCanvas(editorCanvas(), ed.rect);
    const full = scaleToCanvas(cropped, 1800);
    const thumb = scaleToCanvas(full, 320);
    ed.fullBlob = await canvasToBlob(full, 0.8);
    ed.thumbBlob = await canvasToBlob(thumb, 0.72);
    freeCanvas(cropped); freeCanvas(full); freeCanvas(thumb);
    if (ed.previewUrl) URL.revokeObjectURL(ed.previewUrl);
    ed.previewUrl = URL.createObjectURL(ed.thumbBlob);
    renderDetailsStep();
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = 'Siguiente';
    alertBox('Algo salió mal', 'No se pudo preparar la foto. Intenta de nuevo.');
  }
}

function renderDetailsStep() {
  const folderLabel = ed.folderId && folderById(ed.folderId) ? pathText(ed.folderId) : 'Elegir carpeta';
  editorRoot.innerHTML = `
    <div class="ed-top">
      ${ed.pdf ? '<span class="ed-link ed-placeholder">Cancelar</span>' : `<button class="ed-link" data-e="back">${I.back}Foto</button>`}
      <span class="ed-title">${ed.pdf ? 'Guardar PDF' : 'Guardar recibo'}</span>
      <button class="ed-link" data-e="cancel">Cancelar</button>
    </div>
    <div class="ed-form">
      <div class="ed-preview-wrap">
        <img class="ed-preview" src="${ed.previewUrl}" alt="Vista previa del recibo">
        ${ed.pdf ? `<span class="badge-pdf">PDF · ${plural(ed.pdf.pages, 'página', 'páginas')}</span>` : ''}
      </div>
      <label class="field-label">¿En qué carpeta lo guardo?</label>
      <button class="folder-select ${ed.folderId ? '' : 'empty'}" data-e="pick-folder">
        <span class="tree-ico" style="color:${ed.folderId && folderById(ed.folderId) ? folderById(ed.folderId).color : 'var(--text-2)'}">${ed.folderId ? I.folder : I.inbox}</span>
        <span class="folder-select-name">${esc(folderLabel)}</span>
        <span class="folder-select-change">Cambiar</span>
      </button>
      ${detailsFields(ed.details || {})}
      ${linkChips()}
      <p class="field-help">Escribir qué es y el valor te ayuda a encontrarlo después, pero no es obligatorio.</p>
      <button class="btn btn-primary btn-block btn-lg" data-e="save">${I.check} Guardar recibo</button>
    </div>`;
  bindAmountInput(editorRoot);
}

async function saveFromEditor() {
  const btn = $('[data-e="save"]', editorRoot);
  btn.disabled = true;
  const details = readDetails(editorRoot);
  const id = uid();
  const pdfText = ed.pdf ? ed.pdf.text : '';
  const receipt = {
    id, folderId: ed.folderId || null, ...details, recurringId: ed.recurringId || null,
    createdAt: Date.now(), ocrStatus: pdfText.length >= 15 ? 'done' : 'pending', ocrText: pdfText.length >= 15 ? pdfText : '',
    fileType: ed.pdf ? 'pdf' : 'jpg', pages: ed.pdf ? ed.pdf.pages : 1,
  };
  try {
    const [full, thumb, preview] = await Promise.all([
      ed.fullBlob.arrayBuffer(), ed.thumbBlob.arrayBuffer(), ed.previewBlob ? ed.previewBlob.arrayBuffer() : null,
    ]);
    const image = { id, type: ed.pdf ? 'application/pdf' : 'image/jpeg', full, thumb };
    if (preview) image.preview = preview;
    receipt.bytes = full.byteLength + thumb.byteLength + (preview ? preview.byteLength : 0);
    await db.saveReceipt(receipt, image);
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    return alertBox('No se pudo guardar', 'Puede que el iPhone no tenga espacio. Intenta de nuevo.');
  }
  state.receipts.push(receipt);
  if (receipt.folderId) { state.lastFolderId = receipt.folderId; db.setMeta('lastFolderId', receipt.folderId); }
  closeEditor();
  state.query = '';
  go(receipt.folderId ? '/f/' + receipt.folderId : '/sin-carpeta');
  showToast(`Guardado en ${pathText(receipt.folderId)}`);
  setTimeout(runOcrQueue, 800);
}

function closeEditor() {
  state.pendingLink = null;
  if (ed) {
    freeCanvas(ed.base);
    freeCanvas(ed.enhanced);
    if (ed.previewUrl) URL.revokeObjectURL(ed.previewUrl);
  }
  ed = null;
  editorRoot.hidden = true;
  editorRoot.innerHTML = '';
  if (!$('#modal-root').children.length) document.body.classList.remove('locked');
}

editorRoot.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-e]')?.dataset.e;
  if (!a || !ed) return;
  if (a === 'cancel') {
    if (ed.fullBlob && !(await confirmBox({ title: '¿Descartar esta foto?', okText: 'Descartar', danger: true }))) return;
    closeEditor();
  } else if (a === 'rotate') {
    const old = ed.base;
    ed.base = rotateCanvas(old);
    freeCanvas(old);
    freeCanvas(ed.enhanced);
    ed.enhanced = ed.useEnhance ? enhanceCanvas(ed.base) : null;
    ed.rect = { x: 0.04, y: 0.04, w: 0.92, h: 0.92 };
    mountCanvas();
  } else if (a === 'enhance') {
    ed.useEnhance = !ed.useEnhance;
    if (ed.useEnhance && !ed.enhanced) ed.enhanced = enhanceCanvas(ed.base);
    const btn = e.target.closest('[data-e]');
    btn.classList.toggle('on', ed.useEnhance);
    btn.setAttribute('aria-pressed', ed.useEnhance);
    mountCanvas();
  } else if (a === 'next') {
    cropNext();
  } else if (a === 'back') {
    ed.details = readDetails(editorRoot);
    renderCrop();
  } else if (a === 'pick-folder') {
    ed.details = readDetails(editorRoot);
    const target = await pickFolder({ selected: ed.folderId || null });
    if (target !== undefined && ed) { ed.folderId = target; renderDetailsStep(); }
  } else if (a === 'save') {
    saveFromEditor();
  } else if (a === 'link') {
    ed.details = readDetails(editorRoot);
    const id = e.target.closest('[data-id]').dataset.id;
    if (ed.recurringId === id) ed.recurringId = null;
    else {
      const item = recurringById(id);
      ed.recurringId = id;
      if (item.folderId && folderById(item.folderId)) ed.folderId = item.folderId;
      if (!ed.details.note) ed.details.note = item.name;
      if (ed.details.amount == null && item.amount != null) ed.details.amount = item.amount;
    }
    renderDetailsStep();
  }
});

window.addEventListener('resize', () => { if (ed && $('#crop-stage')) layoutCanvas(); });

/* ---------- ver foto en grande ---------- */

const viewerRoot = $('#viewer-root');

// Imagen que se muestra del recibo: en los PDF, la primera página ya dibujada.
function imageBlob(rec) {
  if (rec.type === 'application/pdf') return new Blob([rec.preview || rec.thumb], { type: 'image/jpeg' });
  return new Blob([rec.full], { type: rec.type || 'image/jpeg' });
}

async function openViewer(id) {
  const rec = await db.get('images', id);
  if (!rec) return;
  const isPdfRec = rec.type === 'application/pdf';
  const urls = [];
  let closed = false;
  let doc = null;

  viewerRoot.innerHTML = `
    <div class="viewer-scroll" id="viewer-scroll"><div class="viewer-content" id="viewer-content"></div></div>
    <button class="viewer-close" data-v="close" aria-label="Cerrar">${I.close}<span>Cerrar</span></button>
    <p class="viewer-hint">Pellizca o toca dos veces para acercar</p>`;
  viewerRoot.hidden = false;
  document.body.classList.add('locked');

  const scroller = $('#viewer-scroll');
  const content = $('#viewer-content');
  let scale = 1;
  let baseW = 0;
  let ratio = 1;

  const fit = () => {
    baseW = isPdfRec ? scroller.clientWidth : Math.min(scroller.clientWidth, scroller.clientHeight * ratio);
    content.style.width = baseW * scale + 'px';
  };
  const zoomTo = (next, cx, cy) => {
    next = Math.min(5, Math.max(1, next));
    const r = scroller.getBoundingClientRect();
    const px = (scroller.scrollLeft + cx - r.left) / (baseW * scale);
    const py = (scroller.scrollTop + cy - r.top) / (content.offsetHeight || 1);
    scale = next;
    content.style.width = baseW * scale + 'px';
    scroller.scrollLeft = px * baseW * scale - (cx - r.left);
    scroller.scrollTop = py * content.offsetHeight - (cy - r.top);
  };

  const addImage = (blob) => {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const img = new Image();
    img.alt = 'Recibo';
    img.src = url;
    content.appendChild(img);
    return img;
  };

  if (!isPdfRec) {
    const img = addImage(imageBlob(rec));
    img.decode().then(() => { ratio = img.naturalWidth / img.naturalHeight || 1; fit(); }).catch(fit);
  } else {
    fit();
    const status = document.createElement('p');
    status.className = 'viewer-loading';
    status.textContent = 'Abriendo el PDF…';
    content.appendChild(status);
    try {
      doc = await openPdf(rec.full);
      const pages = Math.min(doc.numPages, 40);
      for (let n = 1; n <= pages && !closed; n++) {
        status.textContent = `Cargando página ${n} de ${pages}…`;
        const canvas = await renderPage(doc, n, Math.min(2000, Math.round(scroller.clientWidth * 2.5)));
        const blob = await canvasToBlob(canvas, 0.85);
        freeCanvas(canvas);
        if (!closed) content.insertBefore(addImage(blob), status);
      }
      status.textContent = doc.numPages > pages ? `Se muestran las primeras ${pages} páginas.` : '';
      if (!status.textContent) status.remove();
    } catch (err) {
      console.error(err);
      if (!closed) {
        status.textContent = 'No se pudo abrir el PDF completo. Esta es la primera página:';
        addImage(imageBlob(rec));
      }
    } finally {
      if (doc) { doc.destroy(); doc = null; }
    }
  }

  let pinch = null;
  let lastTap = 0;
  scroller.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: scale };
    }
  }, { passive: true });
  scroller.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      zoomTo(pinch.s * (d / pinch.d), (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    }
  }, { passive: false });
  scroller.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) pinch = null;
    if (e.changedTouches.length === 1 && e.touches.length === 0) {
      const now = Date.now();
      if (now - lastTap < 300) {
        const t = e.changedTouches[0];
        zoomTo(scale > 1.2 ? 1 : 2.5, t.clientX, t.clientY);
        lastTap = 0;
      } else lastTap = now;
    }
  });
  scroller.addEventListener('dblclick', (e) => zoomTo(scale > 1.2 ? 1 : 2.5, e.clientX, e.clientY));

  viewerRoot.onclick = (e) => {
    if (e.target.closest('[data-v="close"]')) {
      closed = true;
      viewerRoot.hidden = true;
      viewerRoot.innerHTML = '';
      urls.forEach((u) => URL.revokeObjectURL(u));
      if (!$('#modal-root').children.length && editorRoot.hidden) document.body.classList.remove('locked');
    }
  };
}

// Evita que Safari haga zoom a toda la página.
document.addEventListener('gesturestart', (e) => e.preventDefault());

/* ---------- lectura de texto (OCR) ---------- */

async function runOcrQueue() {
  if (state.ocrRunning) return;
  const pending = state.receipts.filter((r) => r.ocrStatus !== 'done');
  if (!pending.length) return;
  state.ocrRunning = true;
  refreshIfShowing();
  try {
    // Si no carga el lector (sin internet), se intenta más tarde.
    await ensureOcrReady();
    for (const r of pending) {
      if (!receiptById(r.id)) continue;
      try {
        const rec = await db.get('images', r.id);
        if (rec) r.ocrText = await recognizeText(imageBlob(rec));
        r.ocrStatus = 'done';
      } catch (err) {
        // Un recibo que falla dos veces se deja sin texto, para no trancar a los demás.
        console.warn('No se pudo leer el texto de', r.id, err);
        r.ocrTries = (r.ocrTries || 0) + 1;
        if (r.ocrTries >= 2) r.ocrStatus = 'done';
      }
      if (receiptById(r.id)) await db.put('receipts', r);
      refreshIfShowing(r.id);
    }
  } catch (err) {
    console.warn('No se pudo cargar el lector de texto', err);
  } finally {
    state.ocrRunning = false;
    refreshIfShowing();
  }
}

function refreshIfShowing(receiptId) {
  const hash = location.hash;
  if (!$('#modal-root').children.length && editorRoot.hidden
    && (hash === '#/ajustes' || (receiptId ? hash === '#/r/' + receiptId : hash.startsWith('#/r/')))) {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }
}

/* ---------- copia de seguridad ---------- */

// Cada copia es uno o varios .zip. Todos llevan la lista completa de carpetas,
// recibos y pagos (data.json), pero solo las fotos y PDF que no estaban en una
// copia anterior. Así cada copia es pequeña y el iPhone no se queda sin memoria.
// Si son muchos, se divide en partes que se guardan una por una.
const BACKUP_PART_BYTES = 60 * 1024 * 1024;

async function receiptBytes(r) {
  if (r.bytes) return r.bytes;
  const rec = await db.get('images', r.id);
  return rec ? rec.full.byteLength + rec.thumb.byteLength + (rec.preview ? rec.preview.byteLength : 0) : 0;
}

async function makeBackup(full = false) {
  state.backup = { busy: true, parts: [], index: 0, file: null, full, stamp: '' };
  render();
  try {
    const pending = state.receipts.filter((r) => full || !r.backedUp);
    const parts = [[]];
    let size = 0;
    for (const r of pending) {
      const bytes = await receiptBytes(r);
      if (size + bytes > BACKUP_PART_BYTES && parts[parts.length - 1].length) { parts.push([]); size = 0; }
      parts[parts.length - 1].push(r.id);
      size += bytes;
    }
    const d = new Date();
    state.backup.stamp = `${todayISO()}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    state.backup.parts = parts;
    await buildBackupPart();
  } catch (err) {
    console.error(err);
    state.backup = null;
    alertBox('No se pudo hacer la copia', 'Intenta de nuevo. Si sigue fallando, cierra la app y vuelve a abrirla.');
  }
  render();
}

async function buildBackupPart() {
  const b = state.backup;
  b.busy = true;
  b.file = null;
  render();
  const files = [{
    name: 'data.json',
    data: new TextEncoder().encode(JSON.stringify({
      app: 'mis-recibos', version: 2, exportedAt: new Date().toISOString(),
      part: b.index + 1, parts: b.parts.length,
      folders: state.folders,
      receipts: state.receipts.map(({ backedUp, ...r }) => r),
      recurring: state.recurring, marks: state.marks,
    })),
  }];
  for (const id of b.parts[b.index]) {
    const rec = await db.get('images', id);
    if (!rec) continue;
    files.push({ name: `img/${id}.${rec.type === 'application/pdf' ? 'pdf' : 'jpg'}`, data: new Uint8Array(rec.full) });
    files.push({ name: `th/${id}.jpg`, data: new Uint8Array(rec.thumb) });
    if (rec.preview) files.push({ name: `pv/${id}.jpg`, data: new Uint8Array(rec.preview) });
  }
  const total = b.parts.length;
  const name = `mis-recibos-copia-${b.stamp}${total > 1 ? `-parte-${b.index + 1}-de-${total}` : ''}.zip`;
  b.file = new File([makeZip(files)], name, { type: 'application/zip' });
  b.busy = false;
}

async function saveBackup() {
  const b = state.backup;
  if (!b || !b.file || b.busy) return;
  const file = b.file;
  let saved = false;
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); saved = true; } catch (err) {
      if (err.name !== 'AbortError') { downloadFile(file); saved = true; }
    }
  } else {
    downloadFile(file);
    saved = true;
  }
  if (!saved) return;

  for (const id of b.parts[b.index]) {
    const r = receiptById(id);
    if (r && !r.backedUp) { r.backedUp = true; await db.put('receipts', r); }
  }
  b.index++;
  if (b.index < b.parts.length) {
    try {
      await buildBackupPart();
      showToast(`Parte ${b.index} de ${b.parts.length} guardada`);
    } catch (err) {
      console.error(err);
      state.backup = null;
      alertBox('No se pudo preparar la siguiente parte', 'Lo que ya guardaste sirve. Toca “Hacer copia” otra vez para seguir con lo que falta.');
    }
    render();
    return;
  }
  state.backup = null;
  state.lastBackupAt = Date.now();
  await db.setMeta('lastBackupAt', state.lastBackupAt);
  render();
  showToast('Copia guardada');
}

// Se pueden elegir varios archivos a la vez: se usa la lista más reciente y las
// fotos de todos los archivos. No se borra ni se cambia nada de lo que ya está en la app.
async function restoreBackup(files) {
  const found = [];
  let bad = 0;
  for (const file of files) {
    try {
      const entries = readZip(await file.arrayBuffer());
      const raw = entries.get('data.json');
      if (!raw) throw new Error('sin data.json');
      const data = JSON.parse(new TextDecoder().decode(raw));
      if (data.app !== 'mis-recibos') throw new Error('otra app');
      found.push({ file, data, names: new Set(entries.keys()) });
    } catch (err) {
      console.warn(file.name, err);
      bad++;
    }
  }
  if (!found.length) {
    return alertBox('Ese archivo no sirve', 'Elige los archivos de copia de Mis Recibos (empiezan por “mis-recibos-copia”).');
  }

  const latest = found.reduce((a, b) => ((a.data.exportedAt || '') >= (b.data.exportedAt || '') ? a : b)).data;
  const hasFile = (f, id) => f.names.has(`img/${id}.jpg`) || f.names.has(`img/${id}.pdf`);
  const existing = new Set(state.receipts.map((r) => r.id));
  const receipts = latest.receipts || [];
  const toAdd = receipts.filter((r) => !existing.has(r.id) && found.some((f) => hasFile(f, r.id)));
  const missing = receipts.filter((r) => !existing.has(r.id) && !found.some((f) => hasFile(f, r.id))).length;
  const fecha = latest.exportedAt ? new Date(latest.exportedAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  const ok = await confirmBox({
    title: '¿Recuperar esta copia?',
    message: `Copia${fecha ? ` del <b>${esc(fecha)}</b>` : ''} con ${plural(receipts.length, 'recibo', 'recibos')} y ${plural((latest.folders || []).length, 'carpeta', 'carpetas')}. Se ${toAdd.length === 1 ? 'agregará' : 'agregarán'} <b>${plural(toAdd.length, 'recibo', 'recibos')}</b> a la app.`
      + (missing ? `<br><br>Faltan las fotos de ${plural(missing, 'recibo', 'recibos')}: están en copias anteriores. Puedes volver a “Recuperar copia” y elegir también esos archivos.` : '')
      + (bad ? `<br><br>${plural(bad, 'archivo no era', 'archivos no eran')} de Mis Recibos y se ignoraron.` : ''),
    okText: 'Recuperar',
  });
  if (!ok) return;

  showEditorLoading('Recuperando tus recibos…');
  const added = new Set();
  try {
    const has = (list, id) => list.some((x) => x.id === id);
    for (const f of latest.folders || []) if (!has(state.folders, f.id)) await db.put('folders', f);
    for (const x of latest.recurring || []) if (!has(state.recurring, x.id)) await db.put('recurring', x);
    for (const m of latest.marks || []) if (!has(state.marks, m.id)) await db.put('marks', m);
    for (const f of found) {
      const mine = toAdd.filter((r) => !added.has(r.id) && hasFile(f, r.id));
      if (!mine.length) continue;
      const entries = readZip(await f.file.arrayBuffer());
      for (const r of mine) {
        const pdf = entries.get(`img/${r.id}.pdf`);
        const full = pdf || entries.get(`img/${r.id}.jpg`);
        const thumb = entries.get(`th/${r.id}.jpg`);
        const preview = entries.get(`pv/${r.id}.jpg`);
        const image = {
          id: r.id, type: pdf ? 'application/pdf' : 'image/jpeg',
          full: full.slice().buffer, thumb: (thumb || preview || full).slice().buffer,
        };
        if (preview) image.preview = preview.slice().buffer;
        await db.saveReceipt({ ...r, backedUp: true }, image);
        added.add(r.id);
      }
    }
  } catch (err) {
    console.error(err);
    alertBox('No se pudo recuperar todo', `Se recuperaron ${plural(added.size, 'recibo', 'recibos')}. Puede que el iPhone no tenga espacio.`);
  }
  closeEditor();
  await loadState();
  render();
  if (added.size) showToast(`${plural(added.size, 'recibo recuperado', 'recibos recuperados')}`);
  setTimeout(runOcrQueue, 1000);
}

/* ---------- acciones ---------- */

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.closest('#modal-root, #editor-root, #viewer-root')) return;
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case 'nav': go(el.dataset.to); break;
    case 'open-folder': go('/f/' + id); break;
    case 'open-receipt': go('/r/' + id); break;
    case 'new-folder': createFolder(el.dataset.parent || null); break;
    case 'folder-menu': folderMenu(id); break;
    case 'clear-search': state.query = ''; render(); break;
    case 'capture-camera': startCapture(true); break;
    case 'capture-photos': startCapture(false); break;
    case 'view-image': openViewer(id); break;
    case 'share-receipt': shareReceipt(id); break;
    case 'edit-receipt': editReceipt(id); break;
    case 'move-receipt': moveReceipt(id); break;
    case 'delete-receipt': deleteReceipt(id); break;
    case 'backup-make': makeBackup(false); break;
    case 'backup-full': makeBackup(true); break;
    case 'backup-save': saveBackup(); break;
    case 'restore': $('#restore-input').value = ''; $('#restore-input').click(); break;
    case 'ocr-now': runOcrQueue(); break;
    case 'help': openWelcome(); break;
    case 'pay-month': state.payPeriod = shiftPeriod(state.payPeriod || currentPeriod(), Number(el.dataset.n)); render(); break;
    case 'pay-add': recurringForm(); break;
    case 'pay-item': paymentMenu(id); break;
  }
});

$('#camera-input').addEventListener('change', onPhotoPicked);
$('#photos-input').addEventListener('change', onPhotoPicked);
$('#restore-input').addEventListener('change', (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (files.length) restoreBackup(files);
});
window.addEventListener('hashchange', () => {
  if (!viewerRoot.hidden) viewerRoot.querySelector('[data-v="close"]')?.click();
  render();
});
window.addEventListener('online', () => setTimeout(runOcrQueue, 1500));

/* ---------- arranque ---------- */

async function loadState() {
  const [folders, receipts, recurring, marks, lastFolderId, lastBackupAt] = await Promise.all([
    db.getAll('folders'), db.getAll('receipts'), db.getAll('recurring'), db.getAll('marks'),
    db.getMeta('lastFolderId'), db.getMeta('lastBackupAt'),
  ]);
  state.folders = folders;
  state.receipts = receipts;
  state.recurring = recurring;
  state.marks = marks;
  state.lastFolderId = lastFolderId;
  state.lastBackupAt = lastBackupAt;
}

async function start() {
  try {
    await loadState();
  } catch (err) {
    console.error(err);
    view.innerHTML = emptyState(I.close, 'No se pudo abrir la app', 'Cierra la app y vuelve a abrirla. Si estás en una ventana privada de Safari, ábrela en una ventana normal.');
    return;
  }
  render();
  if (!(await db.getMeta('welcomed'))) openWelcome();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  setTimeout(runOcrQueue, 3000);
}

start();

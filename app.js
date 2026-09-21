'use strict';
/* Il Guardiano — gestionale ingressi Halloween.
   Tutto vive nel browser (localStorage): nessun server, funziona offline. */

/* ================= utilità ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const sum = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const hhmm = t => new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const eur = n => '€' + (Math.round(n * 100) / 100).toLocaleString('it-IT', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const persone = n => `${n} ${n === 1 ? 'persona' : 'persone'}`;
const today = () => new Date().toISOString().slice(0, 10);
const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ospite';
const byName = (a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });

const ICON = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const icon = name => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

/* ================= dati ================= */
const KEY = 'guardiano.v1';
const DEFAULTS = () => ({
  v: 1,
  event: { name: 'Halloween 2026', date: '2026-10-31', capacity: 0, autoScan: true, sound: true, doorSales: false },
  types: [
    { id: 'pag', name: 'Pagante', price: 0, prepaid: true },
    { id: 'omaggio', name: 'Omaggio / staff', price: 0, prepaid: true },
  ],
  guests: [],
  log: [],
});

let storageOk = true;
function load() {
  try {
    localStorage.setItem(KEY + '.probe', '1');
    localStorage.removeItem(KEY + '.probe');
    const raw = localStorage.getItem(KEY);
    if (raw) return hydrate(JSON.parse(raw));
  } catch (err) {
    storageOk = false;
    console.error('localStorage non disponibile', err);
  }
  return DEFAULTS();
}
function hydrate(d) {
  const base = DEFAULTS();
  return {
    ...base, ...d,
    event: { ...base.event, ...d.event },
    types: Array.isArray(d.types) && d.types.length ? d.types : base.types,
    guests: Array.isArray(d.guests) ? d.guests : [],
    log: Array.isArray(d.log) ? d.log : [],
  };
}
let db = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (err) { storageOk = false; toast('Salvataggio non riuscito: esporta subito un backup!', { kind: 'err' }); }
}

/* ================= dominio ================= */
const byId = id => db.guests.find(g => g.id === id);
const typeById = id => db.types.find(t => t.id === id);
const typeOf = g => typeById(g.typeId) || { id: '', name: 'Senza tipo', price: 0, prepaid: true };
const remaining = g => g.size - g.inside;
const doorSales = () => !!db.event.doorSales;
const dueOf = g => (g.paid || !doorSales() ? 0 : typeOf(g).price * g.size);
const unpaidBlock = g => !doorSales() && !g.paid && remaining(g) > 0; // solo prepagato: chi non risulta pagato non entra
const insideTotal = () => sum(db.guests, g => g.inside);
const capacity = () => Number(db.event.capacity) || 0;
const overCapacity = n => capacity() > 0 && insideTotal() + n > capacity();
const STATUS = { in: 'Dentro', part: 'Parziale', out: 'Uscito', wait: 'Non arrivato' };
const statusOf = g => (g.inside >= g.size ? 'in' : g.inside > 0 ? 'part' : g.arrivedAt ? 'out' : 'wait');
const expectedLeft = () => sum(db.guests, g => (statusOf(g) === 'out' ? 0 : remaining(g)));
const liveLog = () => db.log.filter(e => !e.undone);
const firstArrival = gid => db.log.find(e => e.gid === gid && e.kind === 'in' && !e.undone)?.t ?? null;
const isPrepaid = t => !t || t.prepaid || t.price === 0;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // niente 0/O/1/I
function newCode() {
  const y = new Date(db.event.date).getFullYear();
  const yy = Number.isFinite(y) ? String(y).slice(2) : '26';
  const used = new Set(db.guests.map(g => g.code));
  for (;;) {
    const body = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => CODE_CHARS[b % 32]).join('');
    const code = `HW${yy}-${body}`;
    if (!used.has(code)) return code;
  }
}

function addGuest(f) {
  const g = {
    id: uid(),
    code: f.code || newCode(),
    name: String(f.name || '').trim() || 'Senza nome',
    size: clamp(Math.round(+f.size) || 1, 1, 30),
    inside: 0,
    typeId: f.typeId,
    paid: f.paid ?? isPrepaid(typeById(f.typeId)),
    notes: String(f.notes || '').trim(),
    arrivedAt: null,
    createdAt: Date.now(),
    walkin: !!f.walkin,
  };
  db.guests.push(g);
  return g;
}

function checkIn(gid, n) {
  const g = byId(gid);
  n = clamp(n, 1, remaining(g));
  const due = dueOf(g);
  const first = !g.arrivedAt;
  g.inside += n;
  if (first) g.arrivedAt = Date.now();
  if (due > 0) g.paid = true;
  const e = { id: uid(), t: Date.now(), gid, name: g.name, typeId: g.typeId, kind: 'in', n, amount: due, paidNow: due > 0 };
  db.log.push(e);
  save();
  return e;
}

function checkOut(gid, n) {
  const g = byId(gid);
  n = clamp(n, 1, g.inside);
  g.inside -= n;
  const e = { id: uid(), t: Date.now(), gid, name: g.name, typeId: g.typeId, kind: 'out', n, amount: 0 };
  db.log.push(e);
  save();
  return e;
}

function undoEntry(id) {
  const e = db.log.find(x => x.id === id);
  if (!e || e.undone) return false;
  const g = byId(e.gid);
  if (g) {
    if (e.kind === 'in') {
      if (g.inside < e.n) return toast('Impossibile annullare: alcuni di loro sono già usciti.', { kind: 'err' }), false;
      g.inside -= e.n;
      if (e.paidNow) g.paid = false;
    } else {
      if (g.inside + e.n > g.size) return toast('Impossibile annullare questa uscita.', { kind: 'err' }), false;
      g.inside += e.n;
    }
  }
  e.undone = true;
  if (g) {
    g.arrivedAt = firstArrival(g.id);
    if (g.walkin && !db.log.some(x => x.gid === g.id && !x.undone)) db.guests = db.guests.filter(x => x !== g);
  }
  save();
  return true;
}

/* ================= feedback: toast, suoni ================= */
let toastTimer;
function toast(msg, { undo, kind } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button data-act="undo" data-id="${undo}">Annulla</button>` : ''}`;
  el.className = 'show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, undo ? 6500 : 3400);
}

let actx;
function unlockAudio() {
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    actx.resume?.();
  } catch { /* audio non disponibile */ }
}
function beep(kind) {
  if (db.event.sound && actx) {
    const seq = { ok: [[880, .08], [1320, .12]], warn: [[560, .13], [560, .13]], bad: [[170, .38]] }[kind];
    let t = actx.currentTime;
    for (const [f, d] of seq) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = kind === 'bad' ? 'sawtooth' : 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(.0001, t);
      g.gain.exponentialRampToValueAtTime(.28, t + .01);
      g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + d + .02);
      t += d + .03;
    }
  }
  navigator.vibrate?.(kind === 'ok' ? 40 : [90, 60, 90]);
}

/* ================= finestre (sheet) ================= */
const sheet = $('#sheet');
let sheetCtx = null;
function openSheet(html, ctx = {}) {
  sheet.innerHTML = `<div class="sheet-body">${html}</div>`;
  sheetCtx = ctx;
  if (!sheet.open) sheet.showModal();
  sheet.firstElementChild.scrollTop = 0;
  ctx.mount?.();
}
const closeSheet = () => { if (sheet.open) sheet.close(); };
sheet.addEventListener('close', () => { if (!sheet.open) sheetCtx = null; });
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });

const closeBtn = () => `<button class="x" data-act="closeSheet" aria-label="Chiudi">${icon('x')}</button>`;
const stepper = (name, val, min, max) => `<div class="stepper" data-name="${name}" data-min="${min}" data-max="${max}">
  <button type="button" class="btn sq" data-act="step" data-d="-1" aria-label="Uno in meno">−</button>
  <output aria-live="polite">${val}</output>
  <button type="button" class="btn sq" data-act="step" data-d="1" aria-label="Uno in più">+</button></div>`;
const stepVal = name => Number($(`.stepper[data-name="${name}"] output`, sheet).textContent);
const typeOptions = sel => db.types.map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}${doorSales() && t.price ? ' · ' + eur(t.price) : ''}</option>`).join('');

/* ---------- scheda ospite ---------- */
function showGuest(id) {
  const g = byId(id);
  if (!g) return;
  const st = statusOf(g), rem = remaining(g), t = typeOf(g);
  let door = '';
  if (unpaidBlock(g)) {
    door = `<div class="alert bad">Pagamento non registrato: non far entrare. Se ha pagato, aggiorna la scheda da «Modifica».</div>`;
  } else if (rem > 0) {
    door = `<div class="doorbox">
      ${g.size > 1 ? `<div class="stack"><div class="label" style="text-align:center">Quanti entrano adesso?</div>${stepper('n', rem, 1, rem)}</div>` : ''}
      <div class="due-line" id="dueLine" hidden><span>Da incassare</span><b></b></div>
      <div class="alert warn" id="capWarn" hidden></div>
      <button class="btn big block ok" id="inBtn" data-act="doIn"></button>
    </div>`;
  } else {
    door = `<div class="alert warn">Già entrat${g.size === 1 ? 'o/a' : 'i'}${g.arrivedAt ? ' alle ' + hhmm(g.arrivedAt) : ''} — ${persone(g.inside)} in sala.</div>`;
  }
  const exits = g.inside > 0 ? `<div class="stack"><h3>Uscita</h3><div class="cols">
      <button class="btn" data-act="doOut" data-n="1">${g.inside > 1 ? 'Esce 1' : 'Segna uscita'}</button>
      ${g.inside > 1 ? `<button class="btn" data-act="doOut" data-n="${g.inside}">Escono tutti (${g.inside})</button>` : ''}
    </div></div>` : '';
  openSheet(`
    <div class="sheet-head"><h2>${esc(g.name)}</h2>${closeBtn()}</div>
    <div class="meta"><span class="pill ${st}">${STATUS[st]}</span><span class="tag">${esc(t.name)}</span><span class="tag">${persone(g.size)}</span><span class="tag code">${esc(g.code)}</span></div>
    ${g.notes ? `<div class="notebox">${esc(g.notes)}</div>` : ''}
    ${door}${exits}
    <div class="foot">
      <button class="btn" data-act="showTicket" data-id="${g.id}">Biglietto QR</button>
      <button class="btn" data-act="editGuest" data-id="${g.id}">Modifica</button>
    </div>`, { gid: g.id, onStep: syncGuest, mount: syncGuest });
}

function syncGuest() {
  const g = byId(sheetCtx.gid);
  if (!g || remaining(g) <= 0 || unpaidBlock(g)) return;
  const n = $('.stepper[data-name="n"]', sheet) ? stepVal('n') : remaining(g);
  const due = dueOf(g), over = overCapacity(n);
  const dueLine = $('#dueLine', sheet);
  dueLine.hidden = due <= 0;
  $('b', dueLine).textContent = eur(due);
  const warn = $('#capWarn', sheet);
  warn.hidden = !over;
  warn.textContent = `Con questi ingressi si supera la capienza (${insideTotal() + n} su ${capacity()}).`;
  const btn = $('#inBtn', sheet);
  btn.className = 'btn big block ' + (over ? 'warn' : 'ok');
  const verb = statusOf(g) === 'out' ? 'rientrare' : 'entrare';
  btn.textContent = `${due > 0 ? `Incassa ${eur(due)} e f` : 'F'}ai ${verb} ${n}${over ? ' comunque' : ''}`;
}

/* ---------- aggiunta / modifica ospite ---------- */
function showEdit(id) {
  const g = id ? byId(id) : null;
  const t0 = g ? typeById(g.typeId) : db.types[0];
  openSheet(`
    <div class="sheet-head"><h2>${g ? 'Modifica ospite' : 'Nuovo ospite'}</h2>${closeBtn()}</div>
    <form id="guestForm" class="stack" autocomplete="off">
      <label class="field"><span>Nome</span><input type="text" name="name" required value="${esc(g?.name)}" autocapitalize="words" placeholder="Es. Giulia Rossi"></label>
      <div class="stack"><div class="label">Numero di persone</div>${stepper('size', g?.size ?? 1, Math.max(1, g?.inside ?? 1), 30)}</div>
      <label class="field"><span>Tipo di biglietto</span><select name="typeId">${typeOptions(g?.typeId ?? t0?.id)}</select></label>
      <label class="check"><input type="checkbox" name="paid" ${(g ? g.paid : isPrepaid(t0)) ? 'checked' : ''}>Pagamento ricevuto</label>
      <label class="field"><span>Note (visibili alla porta)</span><textarea name="notes" placeholder="Es. tavolo riservato, organizzatore…">${esc(g?.notes)}</textarea></label>
      <button class="btn big block primary" type="submit">${g ? 'Salva' : 'Aggiungi alla lista'}</button>
      <div class="foot">
        ${g ? `<button type="button" class="btn danger" data-act="deleteGuest" data-id="${g.id}">Elimina</button>` : ''}
        <button type="button" class="btn" data-act="${g ? 'openGuest' : 'closeSheet'}" data-id="${g?.id ?? ''}">Annulla</button>
      </div>
    </form>`, { gid: g?.id, paidTouched: !!g });
  const form = $('#guestForm', sheet);
  $('[name=paid]', form).addEventListener('change', () => { sheetCtx.paidTouched = true; });
  $('[name=typeId]', form).addEventListener('change', e => {
    if (!sheetCtx.paidTouched) $('[name=paid]', form).checked = isPrepaid(typeById(e.target.value));
  });
}

function submitGuest(form) {
  const f = new FormData(form);
  const data = { name: f.get('name'), size: stepVal('size'), typeId: f.get('typeId'), paid: f.get('paid') === 'on', notes: f.get('notes') };
  if (!String(data.name).trim()) return;
  if (sheetCtx.gid) {
    Object.assign(byId(sheetCtx.gid), { ...data, name: data.name.trim(), notes: data.notes.trim() });
    save(); refresh();
    showGuest(sheetCtx.gid);
  } else {
    const g = addGuest(data);
    save(); refresh(); closeSheet();
    toast(`${g.name} aggiunto alla lista`);
  }
}

/* ---------- ospite alla porta ---------- */
function showWalkIn(name = '') {
  const def = db.types.find(t => !t.prepaid && t.price > 0) || db.types[0];
  openSheet(`
    <div class="sheet-head"><h2>Nuovo alla porta</h2>${closeBtn()}</div>
    <form id="walkForm" class="stack" autocomplete="off">
      <label class="field"><span>Nome (facoltativo)</span><input type="text" name="name" value="${esc(name)}" autocapitalize="words" placeholder="Es. Marco"></label>
      <label class="field"><span>Biglietto</span><select name="typeId">${typeOptions(def.id)}</select></label>
      <div class="stack"><div class="label" style="text-align:center">Quante persone?</div>${stepper('size', 1, 1, 30)}</div>
      <div class="alert warn" id="capWarn" hidden></div>
      <button class="btn big block ok" id="walkBtn" type="submit"></button>
    </form>`, { onStep: syncWalk, mount: syncWalk });
}

function syncWalk() {
  const n = stepVal('size');
  const t = typeById($('[name=typeId]', sheet).value);
  const total = t.price * n, over = overCapacity(n);
  const warn = $('#capWarn', sheet);
  warn.hidden = !over;
  warn.textContent = `Si supera la capienza (${insideTotal() + n} su ${capacity()}).`;
  const btn = $('#walkBtn', sheet);
  btn.className = 'btn big block ' + (over ? 'warn' : 'ok');
  btn.textContent = `${total > 0 ? `Incassa ${eur(total)} e f` : 'F'}ai entrare ${n}${over ? ' comunque' : ''}`;
}

function submitWalkIn(form) {
  const f = new FormData(form);
  const n = stepVal('size'), t = typeById(f.get('typeId'));
  if (overCapacity(n) && !confirm(`Capienza di ${capacity()} superata. Far entrare comunque?`)) return;
  const count = db.guests.filter(g => g.walkin).length + 1;
  const g = addGuest({ name: String(f.get('name')).trim() || `Ospite cassa ${count}`, size: n, typeId: t.id, paid: t.price === 0, walkin: true });
  const e = checkIn(g.id, n);
  beep('ok'); closeSheet(); refresh();
  toast(`${g.name} · ingresso di ${persone(n)}${e.amount ? ` · incassati ${eur(e.amount)}` : ''}`, { undo: e.id });
}

/* ---------- biglietto con QR ---------- */
function roundRect(x, px, py, w, h, r) {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r);
  x.closePath();
}
function fitText(x, text, maxW, size, weight, family) {
  for (let s = size; s >= 22; s -= 2) {
    x.font = `${weight} ${s}px ${family}`;
    if (x.measureText(text).width <= maxW) return;
  }
}
function ticketCanvas(g) {
  const W = 900, H = 1340, SERIF = 'Georgia, "Times New Roman", serif', SANS = '-apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#26153c'); bg.addColorStop(1, '#0d0a12');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, 90, 10, W / 2, 90, 640);
  glow.addColorStop(0, 'rgba(255,122,26,.42)'); glow.addColorStop(1, 'rgba(255,122,26,0)');
  x.fillStyle = glow; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#ff7a1a'; x.lineWidth = 6;
  roundRect(x, 32, 32, W - 64, H - 64, 44); x.stroke();

  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.fillStyle = '#ffa04d'; x.font = `700 30px ${SANS}`;
  if ('letterSpacing' in x) x.letterSpacing = '7px';
  x.fillText('BIGLIETTO D’INGRESSO', W / 2, 140);
  if ('letterSpacing' in x) x.letterSpacing = '0px';

  x.fillStyle = '#f5efe6'; fitText(x, db.event.name, W - 160, 96, 800, SERIF);
  x.fillText(db.event.name, W / 2, 262);
  const d = new Date(db.event.date);
  if (!isNaN(d)) {
    x.fillStyle = '#a498b4'; x.font = `600 34px ${SANS}`;
    x.fillText(d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), W / 2, 326);
  }
  x.strokeStyle = '#4b3b62'; x.lineWidth = 3; x.setLineDash([2, 12]); x.lineCap = 'round';
  x.beginPath(); x.moveTo(110, 385); x.lineTo(W - 110, 385); x.stroke(); x.setLineDash([]);

  x.fillStyle = '#fff'; fitText(x, g.name, W - 160, 76, 800, SANS);
  x.fillText(g.name, W / 2, 480);
  x.fillStyle = '#a498b4'; x.font = `600 34px ${SANS}`;
  x.fillText(`${persone(g.size)} · ${typeOf(g).name}`, W / 2, 540);

  x.fillStyle = '#fff'; roundRect(x, 150, 590, 600, 600, 36); x.fill();
  QR.draw(x, g.code, 170, 610, 560, { dark: '#0d0a12', light: '#ffffff', margin: 2 });

  x.fillStyle = '#f5efe6'; x.font = `700 40px ui-monospace, Menlo, Consolas, monospace`;
  x.fillText(g.code, W / 2, 1245);
  x.fillStyle = '#a498b4'; x.font = `500 28px ${SANS}`;
  x.fillText('Mostra questo QR all’ingresso', W / 2, 1290);
  return c;
}

function showTicket(id) {
  const g = byId(id);
  const canvas = ticketCanvas(g);
  openSheet(`
    <div class="sheet-head"><h2>Biglietto</h2>${closeBtn()}</div>
    <img class="ticket-preview" alt="Anteprima biglietto di ${esc(g.name)}" src="${canvas.toDataURL('image/png')}">
    <div class="stack">
      <button class="btn big block primary" data-act="ticketSave">Scarica immagine</button>
      ${navigator.canShare ? `<button class="btn block" data-act="ticketShare">Condividi (WhatsApp, Mail…)</button>` : ''}
      <button class="btn block ghost" data-act="openGuest" data-id="${g.id}">Indietro</button>
    </div>`, { gid: id, canvas });
  canvas.toBlob(b => {
    if (b && sheetCtx?.canvas === canvas) sheetCtx.file = new File([b], `biglietto-${slug(g.name)}.png`, { type: 'image/png' });
  }, 'image/png');
}
const ticketFile = async () => sheetCtx.file || new File([await new Promise(r => sheetCtx.canvas.toBlob(r, 'image/png'))], `biglietto-${slug(byId(sheetCtx.gid).name)}.png`, { type: 'image/png' });

function printTickets(list) {
  if (!list.length) return toast('Nessun ospite in lista.');
  const d = new Date(db.event.date);
  const dateStr = isNaN(d) ? '' : d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#print').innerHTML = list.map(g => `<div class="pt">
    <div class="pt-head">${esc(db.event.name)}</div><div class="pt-date">${esc(dateStr)}</div>
    <img alt="" src="${QR.dataURL(g.code, 6, { margin: 2 })}">
    <div class="pt-nm">${esc(g.name)}</div><div class="pt-sub">${persone(g.size)} · ${esc(typeOf(g).name)}</div>
    <div class="pt-code">${esc(g.code)}</div></div>`).join('');
  window.print();
}
window.addEventListener('afterprint', () => { $('#print').innerHTML = ''; });

/* ================= viste ================= */
const ui = { tab: 'porta', q: '', gq: '', filter: 'all' };

function setTab(t) {
  ui.tab = t;
  render();
  window.scrollTo(0, 0);
}
function render() {
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  updateTop();
  ({ porta: renderPorta, ospiti: renderOspiti, serata: renderSerata })[ui.tab]();
}
function refresh() {
  updateTop();
  if (ui.tab === 'porta') updatePorta();
  else if (ui.tab === 'ospiti') updateOspiti();
  else renderSerata();
}
function updateTop() {
  const inside = insideTotal(), cap = capacity();
  const pill = $('#topCount');
  $('b', pill).textContent = inside;
  $('span', pill).textContent = cap ? '/' + cap : '';
  pill.className = 'count-pill' + (cap && inside >= cap ? ' bad' : cap && inside >= cap * .85 ? ' warn' : '');
  $('#brandName').textContent = db.event.name || 'Il Guardiano';
}
const storageBanner = () => (storageOk ? '' : `<div class="alert bad">Il browser non permette di salvare i dati (navigazione privata?). Aprilo in una finestra normale, altrimenti perderai tutto alla chiusura.</div>`);

function guestRow(g) {
  const st = statusOf(g), due = dueOf(g);
  return `<button class="row" data-act="openGuest" data-id="${g.id}">
    <div class="row-main">
      <div class="nm">${esc(g.name)}</div>
      <div class="sub">${esc(typeOf(g).name)} · ${persone(g.size)}${st === 'part' ? ` · dentro ${g.inside}` : ''}${due ? ` · <span class="due">da pagare ${eur(due)}</span>` : (!g.paid && !doorSales() ? ' · <span class="due">non pagato</span>' : '')}</div>
      ${g.notes ? `<div class="note">${esc(g.notes)}</div>` : ''}
    </div>
    <span class="pill ${st}">${STATUS[st]}</span></button>`;
}

function findGuests(q) {
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const code = q.trim().toUpperCase().replace(/\s+/g, '');
  return db.guests
    .filter(g => { const n = norm(g.name); return tokens.every(t => n.includes(t)) || (code.length >= 4 && g.code.includes(code)); })
    .sort(byName);
}

/* ---------- Porta ---------- */
function renderPorta() {
  $('#view').innerHTML = `${storageBanner()}
    <section class="card meter" id="meter"></section>
    <div class="searchbar">
      <label class="search">${icon('search')}<input id="q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Cerca nome o codice…" value="${esc(ui.q)}" aria-label="Cerca ospite"></label>
      <button class="btn primary" data-act="scan" aria-label="Scansiona QR">${icon('scan')}QR</button>
    </div>
    ${doorSales() ? `<button class="btn block" data-act="walkin">${icon('plus')} Nuovo ospite alla porta</button>` : ''}
    <div id="portaList" class="list"></div>`;
  updatePorta();
}

function updatePorta() {
  const inside = insideTotal(), cap = capacity();
  const cls = cap && inside >= cap ? 'bad' : cap && inside >= cap * .85 ? 'warn' : '';
  $('#meter').innerHTML = `
    <div class="meter-top">
      <div><div class="eyebrow">In sala</div><div class="meter-num">${inside}${cap ? `<small> / ${cap}</small>` : ''}</div></div>
      <div class="meter-side"><div><b>${expectedLeft()}</b><span>attesi</span></div><div><b>${sum(liveLog().filter(e => e.kind === 'in'), e => e.n)}</b><span>entrati</span></div></div>
    </div>
    ${cap ? `<div class="bar ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="${cap}" aria-valuenow="${inside}"><i style="width:${Math.min(100, inside / cap * 100)}%"></i></div>` : ''}
    ${cap && inside >= cap ? '<div class="alert bad">Sala piena: capienza raggiunta.</div>' : ''}
    ${!cap ? '<div class="alert info" style="display:flex;justify-content:space-between;align-items:center;gap:10px">Capienza non impostata<button class="btn sm" data-tab="serata">Imposta</button></div>' : ''}`;

  const list = $('#portaList');
  const q = ui.q.trim();
  if (q) {
    const res = findGuests(q);
    list.innerHTML = res.length
      ? `<div class="list-title"><h3>${res.length} risultat${res.length === 1 ? 'o' : 'i'}</h3></div>${res.slice(0, 60).map(guestRow).join('')}`
      : `<div class="empty"><p>Nessun ospite trovato per «${esc(q)}».</p>${doorSales() ? `<button class="btn primary" data-act="walkinName">Aggiungi «${esc(q)}» alla porta</button>` : '<p>Non risulta in lista. Le eccezioni (staff, omaggi) si aggiungono dalla sezione Ospiti.</p>'}</div>`;
  } else if (!db.guests.length) {
    list.innerHTML = `<div class="empty"><p>La lista è vuota. Importa i paganti da un CSV o aggiungili a mano dalla sezione Ospiti.${doorSales() ? ' Oppure registra chi arriva direttamente alla porta.' : ''}</p><button class="btn primary" data-tab="ospiti">Vai a Ospiti</button></div>`;
  } else {
    const seen = new Set(), recent = [];
    for (const e of [...liveLog()].reverse()) {
      const g = byId(e.gid);
      if (g && !seen.has(g.id)) { seen.add(g.id); recent.push(g); }
      if (recent.length >= 6) break;
    }
    list.innerHTML = recent.length
      ? `<div class="list-title"><h3>Ultimi movimenti</h3></div>${recent.map(guestRow).join('')}`
      : `<div class="empty"><p>Nessun ingresso ancora. Cerca un ospite per nome o scansiona il QR del biglietto.</p></div>`;
  }
}

/* ---------- Ospiti ---------- */
function renderOspiti() {
  $('#view').innerHTML = `
    <div class="head-row"><h1>Ospiti</h1><span class="grow"></span><button class="btn primary" data-act="addGuest">${icon('plus')} Aggiungi</button></div>
    <label class="search">${icon('search')}<input id="gq" type="search" inputmode="search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Cerca nella lista…" value="${esc(ui.gq)}" aria-label="Cerca nella lista"></label>
    <div class="chips" id="chips"></div>
    <div id="guestList" class="list"></div>
    <section class="card stack" id="listTools"></section>`;
  updateOspiti();
}

function updateOspiti() {
  const G = db.guests;
  const filters = [
    ['all', 'Tutti', G.length],
    ['wait', 'Non arrivati', G.filter(g => statusOf(g) === 'wait').length],
    ['in', 'Dentro', G.filter(g => g.inside > 0).length],
    ['out', 'Usciti', G.filter(g => statusOf(g) === 'out').length],
  ];
  const unpaid = G.filter(g => !g.paid).length;
  if (unpaid) filters.push(['unpaid', 'Non pagati', unpaid]);
  if (!filters.some(f => f[0] === ui.filter)) ui.filter = 'all';
  $('#chips').innerHTML = filters.map(([k, l, n]) => `<button class="chip ${ui.filter === k ? 'on' : ''}" data-filter="${k}">${l}<b>${n}</b></button>`).join('');

  let rows = G.slice().sort(byName);
  if (ui.filter === 'in') rows = rows.filter(g => g.inside > 0);
  else if (ui.filter === 'unpaid') rows = rows.filter(g => !g.paid);
  else if (ui.filter !== 'all') rows = rows.filter(g => statusOf(g) === ui.filter);
  if (ui.gq.trim()) { const ids = new Set(findGuests(ui.gq).map(g => g.id)); rows = rows.filter(g => ids.has(g.id)); }
  $('#guestList').innerHTML = rows.length
    ? rows.map(guestRow).join('')
    : `<div class="empty"><p>${G.length ? 'Nessun ospite corrisponde ai filtri.' : 'Ancora nessun ospite in lista.'}</p></div>`;

  $('#listTools').innerHTML = `
    <h3>Lista · ${G.length} nominativi, ${persone(sum(G, g => g.size))}</h3>
    <div class="cols"><button class="btn" data-act="importCsv">Importa CSV</button><button class="btn" data-act="csvTemplate">Scarica modello</button></div>
    <button class="btn block" data-act="printAll">Stampa tutti i biglietti QR</button>
    ${G.length ? '' : '<button class="btn block ghost" data-act="demo">Carica ospiti di prova</button>'}
    <p class="muted" style="font-size:14px">Colonne del CSV: Nome, Persone, Tipo, Pagato, Note, Codice; basta Nome. Puoi reimportare il file quando cambia: chi c’è già viene aggiornato (riconosciuto dal codice o dal nome), non duplicato.</p>`;
}

/* ---------- Serata ---------- */
function renderSerata() {
  const live = liveLog(), ins = live.filter(e => e.kind === 'in');
  const revenue = sum(live, e => e.amount || 0);
  const total = sum(db.guests, g => g.size);
  const perType = db.types.map(t => {
    const es = ins.filter(e => e.typeId === t.id);
    return { t, n: sum(es, e => e.n), amount: sum(es, e => e.amount || 0), listed: sum(db.guests.filter(g => g.typeId === t.id), g => g.size) };
  });
  const ds = doorSales(), outN = sum(live.filter(e => e.kind === 'out'), e => e.n);
  const logRows = db.log.slice(-40).reverse().map(e => `
    <div class="log-item ${e.undone ? 'undone' : ''}">
      <time>${hhmm(e.t)}</time>
      <div class="what"><span class="${e.kind === 'in' ? 'tag-in' : 'tag-out'}">${e.kind === 'in' ? 'Ingresso' : 'Uscita'} ×${e.n}</span> ${esc(e.name)}
        <small>${esc(typeById(e.typeId)?.name || '—')}${e.amount ? ` · incassati ${eur(e.amount)}` : ''}${e.undone ? ' · annullato' : ''}</small></div>
      ${e.undone ? '' : `<button class="btn sm" data-act="undo" data-id="${e.id}">Annulla</button>`}
    </div>`).join('');

  $('#view').innerHTML = `${storageBanner()}
    <h1>Serata</h1>
    <section class="card"><h3>Riepilogo</h3><div class="stats" style="margin-top:12px">
      <div class="stat hi"><b>${insideTotal()}</b><span>In sala adesso</span></div>
      <div class="stat"><b>${sum(ins, e => e.n)}<small class="muted" style="font-size:16px"> / ${total}</small></b><span>Ingressi registrati</span></div>
      <div class="stat"><b>${expectedLeft()}</b><span>Ancora attesi</span></div>
      ${ds ? `<div class="stat hi"><b>${eur(revenue)}</b><span>Incasso alla porta</span></div>` : `<div class="stat"><b>${outN}</b><span>Usciti</span></div>`}
    </div></section>

    <section class="card"><h3>Per tipo di biglietto</h3>
      <table style="margin-top:8px"><thead><tr><th>Tipo</th>${ds ? '<th>Ingressi</th><th>Incassato</th>' : '<th>In lista</th><th>Entrati</th>'}</tr></thead><tbody>
        ${perType.map(r => `<tr><td>${esc(r.t.name)}</td>${ds ? `<td>${r.n}</td><td>${eur(r.amount)}</td>` : `<td>${r.listed}</td><td>${r.n}</td>`}</tr>`).join('')}
      </tbody></table>
      ${ds ? '<p class="muted" style="font-size:13px;margin-top:10px">L’incasso conta solo quanto riscosso alla porta; le prevendite già pagate non sono incluse.</p>' : ''}
    </section>

    <section class="card"><h3>Registro</h3><div class="log" style="margin-top:8px">${logRows || '<p class="muted" style="padding:8px 0">Ancora nessun movimento.</p>'}</div></section>

    <section class="card stack"><h3>Impostazioni serata</h3>
      <label class="field"><span>Nome evento</span><input type="text" data-set="name" value="${esc(db.event.name)}"></label>
      <div class="cols">
        <label class="field"><span>Data</span><input type="date" data-set="date" value="${esc(db.event.date)}"></label>
        <label class="field"><span>Capienza (0 = illimitata)</span><input type="number" inputmode="numeric" min="0" data-set="capacity" value="${capacity()}"></label>
      </div>
      <label class="check"><input type="checkbox" data-set="autoScan" ${db.event.autoScan ? 'checked' : ''}>Ingresso automatico alla scansione QR</label>
      <label class="check"><input type="checkbox" data-set="sound" ${db.event.sound ? 'checked' : ''}>Suoni e vibrazione</label>
      <label class="check"><input type="checkbox" data-set="doorSales" ${ds ? 'checked' : ''}>Vendita alla porta (incasso la sera)</label>
      <p class="muted" style="font-size:13px">${ds ? 'Attiva: si può aggiungere e incassare chi arriva senza biglietto.' : 'Spenta: la lista è di soli paganti. Chi non risulta pagato non entra e alla porta non si incassa niente.'}</p>
    </section>

    <section class="card"><h3>Tipi di biglietto</h3>
      <div style="margin-top:6px">${db.types.map(t => `
        <div class="type-row ${ds ? '' : 'simple'}">
          <input type="text" data-type="${t.id}" data-field="name" value="${esc(t.name)}" aria-label="Nome tipo">
          ${ds ? `<input type="number" inputmode="decimal" min="0" step="0.5" data-type="${t.id}" data-field="price" value="${t.price}" aria-label="Prezzo in euro">` : ''}
          <button class="btn sm danger" data-act="delType" data-id="${t.id}" aria-label="Elimina tipo">${icon('x')}</button>
          ${ds ? `<label class="check"><input type="checkbox" data-type="${t.id}" data-field="prepaid" ${t.prepaid ? 'checked' : ''}>Già pagato in prevendita (non si incassa alla porta)</label>` : ''}
        </div>`).join('')}</div>
      <button class="btn block" style="margin-top:8px" data-act="addType">${icon('plus')} Aggiungi tipo</button>
    </section>

    <section class="card stack"><h3>Dati</h3>
      <div class="cols"><button class="btn" data-act="exportGuests">Esporta ospiti (CSV)</button><button class="btn" data-act="exportLog">Esporta registro (CSV)</button></div>
      <div class="cols"><button class="btn" data-act="backup">Backup completo</button><button class="btn" data-act="restore">Ripristina backup</button></div>
      <p class="muted" style="font-size:14px">I dati stanno solo su questo dispositivo. Fai un backup prima e dopo la serata.</p>
      <button class="btn danger block" data-act="resetNight">Azzera la serata (dopo le prove)</button>
      <button class="btn danger block" data-act="wipe">Cancella tutto</button>
    </section>`;
}

/* ================= scanner QR ================= */
const scan = { stream: null, timer: 0, resumeTimer: 0, det: null, lock: false, lastCode: '', lastAt: 0, canvas: document.createElement('canvas') };
const scanDlg = $('#scan'), scanVideo = $('#scanVideo');

function setScanMsg(text, err = false) {
  const el = $('#scanMsg');
  el.textContent = text;
  el.className = err ? 'err' : '';
}
function loadJsQR() {
  if (window.jsQR) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/jsqr.js';
    s.onload = () => (window.jsQR ? resolve() : reject(new Error('jsQR mancante')));
    s.onerror = () => reject(new Error('jsQR non trovato'));
    document.head.append(s);
  });
}
const camError = e => ({
  NotAllowedError: 'Permesso alla fotocamera negato. Consentilo dalle impostazioni del browser, oppure scrivi il codice qui sotto.',
  NotFoundError: 'Nessuna fotocamera trovata. Scrivi il codice qui sotto.',
  NotReadableError: 'La fotocamera è usata da un’altra app.',
}[e?.name] || 'Impossibile avviare la fotocamera. Scrivi il codice qui sotto.');

async function startScan() {
  unlockAudio();
  if (!scanDlg.open) scanDlg.showModal();
  resumeScan();
  scan.lastCode = '';
  setScanMsg('Avvio fotocamera…');
  if (!navigator.mediaDevices?.getUserMedia) {
    return setScanMsg('Fotocamera non disponibile: apri l’app da HTTPS oppure scrivi il codice qui sotto.', true);
  }
  try {
    scan.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
  } catch (e) {
    return setScanMsg(camError(e), true);
  }
  if (!scanDlg.open) return stopScan(); // chiuso mentre si attendeva il permesso
  scanVideo.srcObject = scan.stream;
  await scanVideo.play().catch(() => {});
  scan.det = null;
  if ('BarcodeDetector' in window) {
    try { scan.det = new BarcodeDetector({ formats: ['qr_code'] }); } catch { scan.det = null; }
  }
  if (!scan.det) {
    try { await loadJsQR(); } catch { return setScanMsg('Lettore QR non disponibile su questo browser: scrivi il codice qui sotto.', true); }
  }
  setScanMsg('Inquadra il QR del biglietto');
  scanLoop();
}

function stopScan() {
  clearTimeout(scan.timer);
  clearTimeout(scan.resumeTimer);
  scan.stream?.getTracks().forEach(t => t.stop());
  scan.stream = null;
  scanVideo.srcObject = null;
}
scanDlg.addEventListener('close', stopScan);

function scanLoop() {
  clearTimeout(scan.timer);
  if (!scanDlg.open || !scan.stream) return;
  scan.timer = setTimeout(async () => {
    if (!scan.lock && scanVideo.readyState >= 2) {
      const text = await readFrame();
      if (text) onScanned(text);
    }
    scanLoop();
  }, 130);
}

async function readFrame() {
  try {
    if (scan.det) return (await scan.det.detect(scanVideo))[0]?.rawValue || '';
    const w = scanVideo.videoWidth, h = scanVideo.videoHeight;
    if (!w) return '';
    const k = Math.min(1, 640 / w), c = scan.canvas;
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(scanVideo, 0, 0, c.width, c.height);
    const img = cx.getImageData(0, 0, c.width, c.height);
    return window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || '';
  } catch { return ''; }
}

function showScanResult(kind, title, sub, { note = '', buttons = [], auto = 0 } = {}) {
  scan.lock = true;
  const marks = { ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', warn: '<path d="M12 3l10 18H2zM12 10v5M12 18h.01"/>', bad: '<path d="M6 6l12 12M18 6L6 18"/>' };
  const el = $('#scanResult');
  el.className = `scan-result ${kind}`;
  el.innerHTML = `<svg class="mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${marks[kind]}</svg>
    <h2>${esc(title)}</h2><p>${esc(sub)}</p>${note ? `<div class="note">${esc(note)}</div>` : ''}
    <div class="foot">${buttons.map(b => `<button class="btn big ${b.cls || ''}" data-act="${b.act}" ${b.id ? `data-id="${b.id}"` : ''}>${b.label}</button>`).join('')}</div>`;
  el.hidden = false;
  clearTimeout(scan.resumeTimer);
  if (auto) scan.resumeTimer = setTimeout(resumeScan, auto);
}
function resumeScan() {
  clearTimeout(scan.resumeTimer);
  $('#scanResult').hidden = true;
  scan.lock = false;
}

function onScanned(raw, { force = false } = {}) {
  const code = String(raw).trim().toUpperCase();
  const now = Date.now();
  if (!force && code === scan.lastCode && now - scan.lastAt < 3000) {
    scan.lastAt = now; // finché il QR resta inquadrato la finestra si rinnova: niente "già entrato" a chi non ha ancora abbassato il telefono
    return;
  }
  scan.lastCode = code; scan.lastAt = now;

  const g = db.guests.find(x => x.code === code);
  if (!g) {
    beep('bad');
    return showScanResult('bad', 'Codice non valido', 'Questo QR non è di questa lista.', { buttons: [{ act: 'resumeScan', label: 'Continua', cls: '' }] });
  }
  const rem = remaining(g);
  const cont = { act: 'resumeScan', label: 'Continua' };
  const open = { act: 'scanOpen', label: 'Apri scheda', id: g.id };
  if (rem <= 0) {
    beep('warn');
    return showScanResult('warn', 'Già entrato', `${g.name} · ${persone(g.inside)} in sala${g.arrivedAt ? ' dalle ' + hhmm(g.arrivedAt) : ''}`, { note: g.notes, buttons: [open, cont] });
  }
  if (unpaidBlock(g)) {
    beep('bad');
    return showScanResult('bad', 'Non risulta pagato', `${g.name} · ${persone(g.size)}`, { note: g.notes, buttons: [open, cont] });
  }
  if (db.event.autoScan && dueOf(g) === 0 && !overCapacity(rem)) {
    const e = checkIn(g.id, rem);
    beep('ok'); refresh();
    return showScanResult('ok', g.name, `Ingresso registrato · ${persone(rem)}`, { note: g.notes, auto: 2600, buttons: [{ act: 'scanUndo', label: 'Annulla', id: e.id }] });
  }
  beep('warn');
  closeScan();
  showGuest(g.id);
}
function closeScan() { if (scanDlg.open) scanDlg.close(); }

/* ================= CSV, backup ================= */
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
async function download(name, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  if (IS_IOS) {
    // Le web app installate sulla Home gestiscono male i download: meglio il foglio di condivisione ("Salva su File").
    for (const type of [mime, 'text/plain']) {
      const file = new File([blob], name, { type });
      if (!navigator.canShare?.({ files: [file] })) continue;
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === 'AbortError') return; break; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita l'esecuzione di formule in Excel
  return `"${s.replace(/"/g, '""')}"`;
};
const csvOut = rows => '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const sep = [';', '\t', ','].map(s => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function importRows(rows) {
  const head = rows[0].map(norm);
  const find = keys => head.findIndex(h => keys.some(k => h === k || h.startsWith(k)));
  const col = { name: find(['nome', 'name', 'ospite', 'nominativo']), surname: find(['cognome', 'surname']), size: find(['pers', 'quant', 'num', 'size', 'posti', 'n.']), type: find(['tip', 'biglietto', 'type']), paid: find(['pagat', 'paid']), notes: find(['not']), code: find(['cod']) };
  const hasHeader = col.name >= 0 || col.surname >= 0;
  const data = hasHeader ? rows.slice(1) : rows;
  if (!hasHeader) Object.assign(col, { name: 0, surname: -1, size: rows[0].length > 1 && /^\d+$/.test(rows[0][1].trim()) ? 1 : -1, type: -1, paid: -1, notes: -1, code: -1 });
  const cell = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const defType = db.types.find(t => t.prepaid) || db.types[0];

  // Reimportare lo stesso file (aggiornato) non deve creare doppioni: chi c'è già si riconosce dal codice o dal nome.
  const byCode = new Map(db.guests.map(g => [g.code, g]));
  const byName = new Map();
  for (const g of db.guests) if (!g.walkin) byName.set(norm(g.name), [...(byName.get(norm(g.name)) || []), g]);
  const touched = new Set();
  let added = 0, updated = 0, people = 0, skipped = 0;
  for (const r of data) {
    const name = [cell(r, col.name), cell(r, col.surname)].filter(Boolean).join(' ');
    if (!name) { skipped++; continue; }
    const codeRaw = cell(r, col.code).toUpperCase();
    const typeName = cell(r, col.type);
    const type = typeName ? db.types.find(t => norm(t.name) === norm(typeName)) : null;
    const paidRaw = norm(cell(r, col.paid));
    const paid = paidRaw ? /^(si|s|y|yes|1|true|x|ok|pagato)$/.test(paidRaw) : undefined;
    const sizeN = parseInt(cell(r, col.size), 10);
    const notes = cell(r, col.notes);
    let g = (codeRaw && byCode.get(codeRaw)) || (byName.get(norm(name)) || []).find(x => !touched.has(x.id));
    if (g && touched.has(g.id)) g = null; // stesso codice ripetuto nel file
    if (g) {
      g.name = name;
      if (sizeN > 0) g.size = clamp(sizeN, Math.max(1, g.inside), 30);
      if (type) g.typeId = type.id;
      if (paid !== undefined) g.paid = paid;
      if (notes) g.notes = notes;
      updated++;
    } else {
      g = addGuest({ name, size: sizeN || 1, typeId: (type || defType).id, code: codeRaw && !byCode.has(codeRaw) ? codeRaw : '', paid, notes });
      byCode.set(g.code, g);
      added++;
    }
    touched.add(g.id);
    people += g.size;
  }
  save(); refresh();
  toast(`${added} nuovi, ${updated} aggiornati (${persone(people)} nel file)${skipped ? ` · ${skipped} righe senza nome ignorate` : ''}`);
}

const DEMO = [
  ['Giulia Rossi', 2, 0], ['Marco Bianchi', 1, 0], ['Sara Conti', 4, 0, 'Vicino al DJ'], ['Luca Moretti', 1, 0],
  ['Elena Ferrari', 2, 1, 'Organizzatrice'], ['Davide Greco', 1, 0, 'Bonifico non ancora arrivato', false], ['Chiara Romano', 3, 0], ['Matteo Colombo', 2, 0],
  ['Francesca Ricci', 1, 0, 'Allergia ai latticini'], ['Andrea Marino', 2, 0], ['Valentina Gallo', 1, 1, 'Fotografa'], ['Simone Costa', 5, 0, 'Compleanno: torta alle 23:30'],
];
function loadDemo() {
  DEMO.forEach(([name, size, ti, notes, paid]) => addGuest({ name, size, typeId: db.types[Math.min(ti, db.types.length - 1)].id, notes, paid }));
  save(); refresh();
  toast('Ospiti di prova aggiunti. Ricordati di “Azzerare la serata” prima dell’evento.');
}

/* ================= azioni ================= */
const ACTIONS = {
  closeSheet,
  closeScan,
  resumeScan,
  scan: startScan,
  walkin: () => showWalkIn(),
  walkinName: () => showWalkIn(ui.q.trim()),
  addGuest: () => showEdit(null),
  editGuest: el => showEdit(el.dataset.id),
  openGuest: el => showGuest(el.dataset.id),
  showTicket: el => showTicket(el.dataset.id),
  demo: loadDemo,
  importCsv: () => $('#fileCsv').click(),
  restore: () => $('#fileBackup').click(),

  step(el) {
    const st = el.closest('.stepper'), out = $('output', st);
    out.textContent = clamp(Number(out.textContent) + Number(el.dataset.d), Number(st.dataset.min), Number(st.dataset.max));
    sheetCtx?.onStep?.();
  },

  doIn() {
    const g = byId(sheetCtx.gid);
    if (unpaidBlock(g)) return toast('Pagamento non registrato: non può entrare.', { kind: 'err' });
    const n = $('.stepper[data-name="n"]', sheet) ? stepVal('n') : remaining(g);
    if (overCapacity(n) && !confirm(`Capienza di ${capacity()} superata. Far entrare comunque?`)) return;
    const e = checkIn(g.id, n);
    beep('ok'); closeSheet(); refresh();
    toast(`${g.name} · ingresso di ${persone(n)}${e.amount ? ` · incassati ${eur(e.amount)}` : ''}`, { undo: e.id });
  },
  doOut(el) {
    const g = byId(sheetCtx.gid);
    const e = checkOut(g.id, Number(el.dataset.n));
    closeSheet(); refresh();
    toast(`${g.name} · uscita di ${persone(e.n)}`, { undo: e.id });
  },
  undo(el) {
    if (undoEntry(el.dataset.id)) { refresh(); toast('Operazione annullata.'); }
  },
  scanOpen(el) { closeScan(); showGuest(el.dataset.id); },
  scanUndo(el) {
    if (undoEntry(el.dataset.id)) { refresh(); beep('warn'); }
    resumeScan();
  },

  deleteGuest(el) {
    const g = byId(el.dataset.id);
    if (!confirm(`Eliminare «${g.name}» dalla lista?${g.inside ? ' Risulta ancora dentro.' : ''}`)) return;
    db.guests = db.guests.filter(x => x !== g);
    save(); closeSheet(); refresh();
    toast(`${g.name} eliminato`);
  },

  async ticketSave() {
    const f = await ticketFile();
    download(f.name, f, 'image/png');
  },
  async ticketShare() {
    const f = sheetCtx.file || await ticketFile();
    if (!navigator.canShare?.({ files: [f] })) return ACTIONS.ticketSave();
    try { await navigator.share({ files: [f], title: db.event.name, text: `Il tuo biglietto per ${db.event.name}` }); }
    catch (e) { if (e.name !== 'AbortError') toast('Condivisione non riuscita.', { kind: 'err' }); }
  },
  printAll: () => printTickets(db.guests.slice().sort(byName)),

  addType() {
    db.types.push({ id: 't' + uid(), name: 'Nuovo tipo', price: 0, prepaid: !doorSales() });
    save(); renderSerata();
  },
  delType(el) {
    const used = db.guests.filter(g => g.typeId === el.dataset.id).length;
    if (db.types.length <= 1) return toast('Serve almeno un tipo di biglietto.', { kind: 'err' });
    if (used) return toast(`Ci sono ${used} ospiti con questo tipo: cambiali prima di eliminarlo.`, { kind: 'err' });
    db.types = db.types.filter(t => t.id !== el.dataset.id);
    save(); renderSerata();
  },

  csvTemplate() {
    const first = db.types[0].name, last = db.types[db.types.length - 1].name;
    download('modello-ospiti.csv', csvOut([
      ['Nome', 'Persone', 'Tipo', 'Pagato', 'Note'],
      ['Giulia Rossi', 2, first, 'sì', ''],
      ['Marco Bianchi', 1, first, 'no', 'Bonifico in arrivo'],
      ['Elena Ferrari', 1, last, 'sì', 'Organizzatrice'],
    ]), 'text/csv');
  },
  exportGuests: () => download(`ospiti-${today()}.csv`, csvOut([
    ['Codice', 'Nome', 'Persone', 'Tipo', 'Pagato', 'Dentro ora', 'Primo ingresso', 'Note'],
    ...db.guests.slice().sort(byName).map(g => [g.code, g.name, g.size, typeOf(g).name, g.paid ? 'sì' : 'no', g.inside, g.arrivedAt ? hhmm(g.arrivedAt) : '', g.notes]),
  ]), 'text/csv'),
  exportLog: () => download(`registro-${today()}.csv`, csvOut([
    ['Ora', 'Ospite', 'Tipo', 'Azione', 'Persone', 'Incassato (€)', 'Annullato'],
    ...db.log.map(e => [hhmm(e.t), e.name, typeById(e.typeId)?.name || '', e.kind === 'in' ? 'Ingresso' : 'Uscita', e.n, e.amount || 0, e.undone ? 'sì' : '']),
  ]), 'text/csv'),
  backup: () => download(`guardiano-backup-${today()}.json`, JSON.stringify(db, null, 2), 'application/json'),

  resetNight() {
    if (!confirm('Azzero ingressi, uscite, incassi e registro, ed elimino gli ospiti aggiunti alla porta.\nLa lista degli invitati resta. Continuare?')) return;
    const collected = new Set(liveLog().filter(e => e.paidNow).map(e => e.gid));
    db.guests = db.guests.filter(g => !g.walkin);
    db.guests.forEach(g => { g.inside = 0; g.arrivedAt = null; if (collected.has(g.id)) g.paid = false; });
    db.log = [];
    save(); refresh(); toast('Serata azzerata.');
  },
  wipe() {
    if (prompt('Verranno cancellati ospiti, registro e impostazioni.\nScrivi CANCELLA per confermare.') !== 'CANCELLA') return;
    db = DEFAULTS();
    save(); ui.q = ui.gq = ''; render(); toast('Tutto cancellato.');
  },
};

/* ================= eventi ================= */
document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) return setTab(tab.dataset.tab);
  const chip = e.target.closest('[data-filter]');
  if (chip) { ui.filter = chip.dataset.filter; return updateOspiti(); }
  const el = e.target.closest('[data-act]');
  if (el && ACTIONS[el.dataset.act]) ACTIONS[el.dataset.act](el, e);
});

document.addEventListener('input', e => {
  if (e.target.id === 'q') { ui.q = e.target.value; updatePorta(); }
  else if (e.target.id === 'gq') { ui.gq = e.target.value; updateOspiti(); }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.id !== 'q') return;
  const res = findGuests(ui.q);
  const exact = res.find(g => g.code === ui.q.trim().toUpperCase());
  const pick = exact || (res.length === 1 ? res[0] : null); // lo scanner Bluetooth "digita" il codice e preme Invio
  if (pick) { e.preventDefault(); e.target.blur(); showGuest(pick.id); }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.set) {
    const k = t.dataset.set;
    db.event[k] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Math.max(0, Math.round(+t.value) || 0) : t.value;
    save(); updateTop();
    if (k === 'doorSales') renderSerata();
  } else if (t.dataset.type) {
    const ty = typeById(t.dataset.type), f = t.dataset.field;
    if (f === 'price') ty.price = Math.max(0, +t.value || 0);
    else if (f === 'prepaid') ty.prepaid = t.checked;
    else ty.name = t.value.trim() || ty.name;
    save();
  } else if (sheet.contains(t) && sheetCtx?.onStep && t.tagName === 'SELECT') {
    sheetCtx.onStep();
  }
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const id = e.target.id;
  if (id === 'guestForm') submitGuest(e.target);
  else if (id === 'walkForm') submitWalkIn(e.target);
  else if (id === 'scanForm') {
    const input = $('#scanCode');
    if (input.value.trim()) { onScanned(input.value, { force: true }); input.value = ''; }
  }
});

$('#fileCsv').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf); // CSV salvati da Excel
    const rows = parseCSV(text);
    if (!rows.length) return toast('Il file è vuoto.', { kind: 'err' });
    importRows(rows);
  } catch (err) {
    console.error(err);
    toast('Non riesco a leggere questo file.', { kind: 'err' });
  }
});

$('#fileBackup').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!d || !Array.isArray(d.guests) || !d.event) throw new Error('formato');
    if (!confirm(`Ripristino il backup (${d.guests.length} ospiti)? I dati attuali verranno sostituiti.`)) return;
    db = hydrate(d);
    save(); render(); toast('Backup ripristinato.');
  } catch {
    toast('File di backup non valido.', { kind: 'err' });
  }
});

/* ================= avvio ================= */
let wakeLock;
async function keepAwake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); }
  catch { /* non supportato o negato */ }
}
document.addEventListener('visibilitychange', keepAwake);

document.addEventListener('pointerdown', unlockAudio, { once: true });
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
keepAwake();
render();

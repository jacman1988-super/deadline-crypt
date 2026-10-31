/**
 * app.js — Deadline Crypt application shell
 * Handles state, rendering, CRUD, import/export, reminders, storage.
 *
 * Initial implementation and core corrections: Kiro, 2026-10-31.
 * Codex: review, storage recovery, backup history, focus and demo controls.
 * No external dependencies. ES module.
 */

import {
  parseDeadline, classifyDeadline, formatDeadline, formatCountdown,
  isDateOnlyPast,
  getMissingCount, getNextAction,
  shouldShowReminder, acknowledgeReminder, ackKey,
  validateUrl, normaliseUrl,
  validateImportPayload, deduplicateRecords,
  sanitiseText,
  createSeedRecords, generateId,
  STAGES, FEE_STATUS,
  MAX_TITLE_LEN, MAX_NOTES_LEN, MAX_CREDITS_LEN, MAX_CHECKLIST, MAX_LABEL_LEN, MAX_RECORDS
} from './domain.js';

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_KEY      = 'deadlineCrypt_records';
const STORAGE_ACK_KEY  = 'deadlineCrypt_acks';
let storageAvailable   = true;
let storageWriteBlocked = false;
let storageProblem = '';

function tryLoadStorage(key) {
  try { return localStorage.getItem(key); }
  catch { storageAvailable = false; return null; }
}

function trySaveStorage(key, value) {
  if (storageWriteBlocked) return false;
  try { localStorage.setItem(key, value); return true; }
  catch (e) {
    storageAvailable = false;
    showStorageBadge();
    return false;
  }
}

function showStorageBadge() {
  const el = document.getElementById('storage-badge');
  if (el) {
    el.removeAttribute('hidden');
    if (storageProblem) el.textContent = storageProblem;
  }
}

function announce(message) {
  const el = document.getElementById('app-message');
  if (el) { el.hidden = false; el.textContent = message; }
}

let confirmationAction = null;
function showNotice(message) {
  document.getElementById('notice-text').textContent = message;
  document.getElementById('notice-dialog').showModal();
}
function confirmAction(message, action) {
  confirmationAction = action;
  document.getElementById('confirm-text').textContent = message;
  document.getElementById('confirm-dialog').showModal();
}

// Only current canonical deadlines and real boolean flags survive a backup.
function currentAcknowledgements(list, history) {
  const clean = {};
  if (!history || typeof history !== 'object' || Array.isArray(history)) return clean;
  for (const record of list) {
    if (!record.deadline || record.deadline.dateOnly) continue;
    const key = ackKey(record);
    const value = history[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    clean[key] = {
      ack24: value.ack24 === true,
      ack72: value.ack72 === true,
      ack7d: value.ack7d === true
    };
  }
  return clean;
}

function mergeAcknowledgementHistory(current, incoming) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    const previous = merged[key] ?? {};
    merged[key] = {
      ack24: previous.ack24 === true || value.ack24 === true,
      ack72: previous.ack72 === true || value.ack72 === true,
      ack7d: previous.ack7d === true || value.ack7d === true
    };
  }
  return merged;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {object[]} */
let records = [];
/** @type {object} ackKey → { ack24, ack72, ack7d } */
let acks = {};

/** UI state */
let filterStage  = '';
let filterCash   = false;
let searchQuery  = '';
let sortBy       = 'urgency';
let editingId    = null;   // null = new record
let pendingImport = null;  // { merged, added, skipped, conflicts }
let modalReturnFocus = null;
let importReturnFocus = null;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function loadState() {
  const raw = tryLoadStorage(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const validation = validateImportPayload({ version: 1, records: parsed });
      if (!validation.ok) throw new Error('Saved records are invalid.');
      records = validation.records;
    } catch {
      records = [];
      storageWriteBlocked = true;
      storageProblem = 'Saved data unreadable · original retained · working in memory';
    }
  }
  // Re-attach parsed deadline objects (not stored, derived on load)
  records = records.map(hydrate);

  const rawAcks = tryLoadStorage(STORAGE_ACK_KEY);
  if (rawAcks) {
    try { acks = JSON.parse(rawAcks) ?? {}; } catch { acks = {}; }
  }
  acks = currentAcknowledgements(records, acks);
}

function loadExamples() {
  const examples = createSeedRecords(new Date()).map(hydrate);
  const ids = new Set(examples.map(r => r.id));
  const load = () => {
    const retained = records.filter(r => !ids.has(r.id));
    if (retained.length + examples.length > MAX_RECORDS) {
      showNotice(`There is room for ${MAX_RECORDS} entries. Export a backup and remove unused entries before loading examples.`);
      return;
    }
    records = [...retained, ...examples];
    acks = currentAcknowledgements(retained, acks);
    filterStage = ''; filterCash = false; searchQuery = ''; sortBy = 'urgency';
    setVal('search-input', ''); setVal('filter-stage', ''); setVal('sort-by', 'urgency');
    document.getElementById('filter-cash').checked = false;
    saveRecords(); saveAcks(); render();
    announce('Three fictional examples loaded. Your other entries were kept.');
  };
  if (records.some(r => ids.has(r.id))) {
    confirmAction('Reload the three fictional sample cards? Changes to those samples will be reset. Your other entries stay unchanged.', load);
  } else load();
}

/** Attach parsed deadline to a plain record object. */
function hydrate(r) {
  if (r.deadlineRaw) {
    const p = parseDeadline(r.deadlineRaw);
    return { ...r, deadline: 'error' in p ? null : p };
  }
  return { ...r, deadline: null };
}

function saveRecords() {
  // Strip transient .deadline before serialising
  const toStore = records.map(({ deadline: _d, ...r }) => r);
  trySaveStorage(STORAGE_KEY, JSON.stringify(toStore));
}

function saveAcks() {
  trySaveStorage(STORAGE_ACK_KEY, JSON.stringify(acks));
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
  renderReminders();
  renderGrid();
}

function renderReminders() {
  const container = document.getElementById('reminder-queue');
  if (!container) return;
  container.innerHTML = '';
  const now = new Date();
  for (const r of records) {
    const reminder = shouldShowReminder(r, acks, now);
    if (!reminder) continue;
    const el = document.createElement('div');
    el.className = 'reminder-alert';
    el.setAttribute('role', 'alert');

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('width', '18'); icon.setAttribute('height', '18');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '2');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
    // SVG elements expose className as an SVGAnimatedString (read-only value).
    // Use setAttribute to set the class, which works for both HTML and SVG.
    icon.setAttribute('class', 'reminder-icon');

    const txt = document.createElement('span');
    txt.className = 'reminder-text';
    const strong = document.createElement('strong');
    strong.textContent = r.title;
    txt.appendChild(strong);
    const dl = r.deadline ? formatDeadline(r.deadline) : r.deadlineRaw;
    const timeNode = document.createTextNode(` — deadline ${dl} (within ${reminder.threshold})`);
    txt.appendChild(timeNode);

    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-ghost';
    btn.type = 'button';
    btn.textContent = 'Acknowledge';
    btn.addEventListener('click', () => {
      acks = acknowledgeReminder(acks, ackKey(r), reminder.threshold);
      saveAcks();
      renderReminders();
    });

    el.append(icon, txt, btn);
    container.appendChild(el);
  }
}

function getFilteredSorted() {
  const now = new Date();
  let list = records.filter(r => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!r.title.toLowerCase().includes(q) &&
          !(r.sourceUrl && r.sourceUrl.toLowerCase().includes(q))) return false;
    }
    if (filterStage && r.stage !== filterStage) return false;
    if (filterCash && !(r.cashAmount > 0)) return false;
    return true;
  });

  const urgencyOrder = { expired: 0, within24h: 1, within72h: 2, within7days: 3, dateOnly: 4, later: 5, none: 6 };

  list.sort((a, b) => {
    const ua = a.deadline ? urgencyOrder[classifyDeadline(a.deadline, now)] : 6;
    const ub = b.deadline ? urgencyOrder[classifyDeadline(b.deadline, now)] : 6;
    if (sortBy === 'urgency') {
      if (ua !== ub) return ua - ub;
      // secondary: deadline date
      const da = a.deadline?.date?.getTime() ?? Infinity;
      const db = b.deadline?.date?.getTime() ?? Infinity;
      return da - db;
    }
    if (sortBy === 'title') return a.title.localeCompare(b.title, 'pl');
    if (sortBy === 'stage') return STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage);
    return 0;
  });

  return { list, now };
}

function renderGrid() {
  const container = document.getElementById('records-grid');
  if (!container) return;
  container.innerHTML = '';

  const { list, now } = getFilteredSorted();

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `<div class="empty-icon">${svgGhostLarge()}</div><h2>Your next entry starts here</h2><p class="text-muted">Add an opportunity, load the fictional examples, or adjust your filters.</p>`;
    container.appendChild(empty);
    return;
  }

  for (const r of list) {
    container.appendChild(renderCard(r, now));
  }
}

function renderCard(r, now) {
  const urgency = r.deadline ? classifyDeadline(r.deadline, now) : 'none';

  const card = document.createElement('article');
  card.className = `record-card urgency-${urgency}`;
  card.dataset.id = r.id;

  // Header
  const header = document.createElement('div');
  header.className = 'card-header';

  const title = document.createElement('h2');
  title.className = 'card-title';
  title.textContent = r.title;

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  actions.setAttribute('aria-label', 'Record actions');

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn btn-sm btn-ghost';
  editBtn.setAttribute('aria-label', `Edit ${r.title}`);
  editBtn.innerHTML = svgEdit();
  editBtn.addEventListener('click', () => openEditModal(r.id));

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-sm btn-ghost';
  delBtn.setAttribute('aria-label', `Delete ${r.title}`);
  delBtn.innerHTML = svgTrash();
  delBtn.addEventListener('click', () => confirmDelete(r.id, r.title));

  actions.append(editBtn, delBtn);
  header.append(title, actions);

  // Stage chip
  const stage = document.createElement('div');
  stage.innerHTML = renderStageChip(r.stage);

  // Deadline badge
  const dlDiv = document.createElement('div');
  if (r.deadline) {
    const badge = document.createElement('span');
    badge.className = `deadline-badge urgency-${urgency}`;
    const dlText = formatDeadline(r.deadline);
    badge.textContent = dlText;
    if (r.deadline.dateOnly && isDateOnlyPast(r.deadline, now)) {
      // Calendar date has passed but the exact closing hour was never known.
      // Show a non-alarming calendar hint — do NOT classify as 'expired' or
      // invent a closing instant that could trigger threshold alarms.
      const hint = document.createElement('span');
      hint.className = 'dateonly-past-hint text-muted';
      hint.style.fontSize = '0.75rem';
      hint.style.display = 'block';
      hint.textContent = '(calendar date has passed — hour was unknown)';
      dlDiv.appendChild(badge);
      dlDiv.appendChild(hint);
    } else if (!r.deadline.dateOnly && urgency !== 'expired' && urgency !== 'later') {
      const cd = formatCountdown(r.deadline, now);
      if (cd) {
        badge.textContent = '';
        const s = document.createElement('span');
        s.textContent = dlText;
        const c = document.createElement('span');
        c.className = 'countdown';
        c.textContent = ` (${cd})`;
        badge.append(s, c);
      }
      dlDiv.appendChild(badge);
    } else {
      dlDiv.appendChild(badge);
    }
  } else {
    const na = document.createElement('span');
    na.className = 'text-muted';
    na.style.fontSize = '0.8rem';
    na.textContent = 'No deadline set';
    dlDiv.appendChild(na);
  }

  // Ghost count
  const missing = getMissingCount(r);
  const ghostDiv = document.createElement('div');
  if (r.checklist && r.checklist.length > 0) {
    const gc = document.createElement('span');
    gc.className = `ghost-count${missing > 0 ? ' has-missing' : ''}`;
    gc.innerHTML = `${svgGhost()} `;
    const txt = document.createTextNode(
      missing > 0 ? `${missing} missing` : 'All materials ready'
    );
    gc.appendChild(txt);
    ghostDiv.appendChild(gc);
  }

  // Meta (prize / fee)
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  if (r.cashAmount !== null && r.cashAmount !== undefined && r.cashAmount > 0) {
    const cash = document.createElement('span');
    cash.className = 'prize-cash';
    cash.textContent = `${r.cashAmount.toLocaleString('pl-PL')} ${r.currency || ''}`.trim();
    meta.appendChild(cash);
  }
  if (r.creditsDescription) {
    const cr = document.createElement('span');
    cr.className = 'prize-credits text-muted';
    cr.textContent = r.creditsDescription;
    meta.appendChild(cr);
  }
  if (r.feeStatus && r.feeStatus !== 'unknown') {
    const fee = document.createElement('span');
    fee.className = `fee-${r.feeStatus}`;
    fee.textContent = r.feeStatus === 'free' ? '✓ Free entry' : '⚠ Paid entry';
    meta.appendChild(fee);
  }

  // Next action
  const nextAction = document.createElement('p');
  nextAction.className = `next-action ${r.stage === 'submitted' ? 'submitted' : r.stage === 'withdrawn' ? 'withdrawn' : ''}`;
  nextAction.textContent = getNextAction(r);

  // Source link
  const srcDiv = document.createElement('div');
  if (r.sourceUrl) {
    const link = document.createElement('a');
    link.href = r.sourceUrl;
    link.rel = 'noopener noreferrer';
    link.target = '_blank';
    link.className = 'card-source';
    link.textContent = r.sourceUrl;
    srcDiv.appendChild(link);
  }

  card.append(header, stage, dlDiv);
  if (ghostDiv.firstChild) card.appendChild(ghostDiv);
  if (meta.firstChild) card.appendChild(meta);
  card.append(nextAction);
  if (srcDiv.firstChild) card.appendChild(srcDiv);

  return card;
}

// ---------------------------------------------------------------------------
// SVG helpers (inline, no external resources)
// ---------------------------------------------------------------------------

function svgGhost() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2C7.03 2 3 6.03 3 11v9l3-2 3 2 3-2 3 2 3-2v-9c0-4.97-4.03-9-9-9zm-2 10a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>
  </svg>`;
}

function svgGhostLarge() {
  return `<svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2C7.03 2 3 6.03 3 11v9l3-2 3 2 3-2 3 2 3-2v-9c0-4.97-4.03-9-9-9zm-2 10a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>
  </svg>`;
}

function svgEdit() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>`;
}

function svgTrash() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6"/><path d="M14 11v6"/>
    <path d="M9 6V4h6v2"/>
  </svg>`;
}

function svgClose() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>`;
}

function renderStageChip(stage) {
  const labels = {
    interested: '◉ Interested',
    registered: '◉ Registered',
    preparing:  '◉ Preparing',
    submitted:  '◉ Submitted',
    withdrawn:  '◉ Withdrawn'
  };
  return `<span class="stage-chip stage-${stage}" aria-label="Stage: ${stage}">${labels[stage] ?? stage}</span>`;
}

// ---------------------------------------------------------------------------
// CRUD Modal
// ---------------------------------------------------------------------------

let _checklistItems = [];

function openNewModal() {
  editingId = null;
  _checklistItems = [];
  renderModal({
    id: '', title: '', sourceUrl: '', cashAmount: '', currency: 'PLN',
    creditsDescription: '', feeStatus: 'unknown', deadlineRaw: '',
    stage: 'interested', checklist: [], notes: ''
  });
}

function openEditModal(id) {
  const r = records.find(r => r.id === id);
  if (!r) return;
  editingId = id;
  _checklistItems = (r.checklist || []).map(i => ({ ...i }));
  renderModal(r);
}

function renderModal(r) {
  const overlay = document.getElementById('modal-overlay');
  const title   = document.getElementById('modal-title');
  const form    = document.getElementById('record-form');
  if (!overlay || !form) return;

  title.textContent = editingId ? 'Edit Record' : 'New Record';

  // Populate form fields
  setVal('f-title',        r.title || '');
  setVal('f-source-url',   r.sourceUrl || '');
  setVal('f-cash-amount',  r.cashAmount != null ? String(r.cashAmount) : '');
  setVal('f-currency',     r.currency || 'PLN');
  setVal('f-credits-desc', r.creditsDescription || '');
  setVal('f-fee-status',   r.feeStatus || 'unknown');
  setVal('f-deadline',     r.deadlineRaw || '');
  setVal('f-stage',        r.stage || 'interested');
  setVal('f-notes',        r.notes || '');

  clearErrors();
  renderChecklistEditor();

  modalReturnFocus = document.activeElement;
  document.querySelector('.app-shell').inert = true;
  overlay.removeAttribute('hidden');
  document.getElementById('f-title')?.focus();

  // Show/hide delete button
  const delBtn = document.getElementById('modal-delete-btn');
  if (delBtn) { delBtn.hidden = !editingId; }
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.setAttribute('hidden', '');
  editingId = null;
  _checklistItems = [];
  document.querySelector('.app-shell').inert = false;
  (modalReturnFocus?.isConnected ? modalReturnFocus : document.getElementById('btn-new'))?.focus();
}

function renderChecklistEditor() {
  const list = document.getElementById('checklist-list');
  if (!list) return;
  list.innerHTML = '';
  for (let i = 0; i < _checklistItems.length; i++) {
    list.appendChild(buildChecklistItemEl(i));
  }
}

function buildChecklistItemEl(i) {
  const item = _checklistItems[i];
  const row = document.createElement('div');
  row.className = 'checklist-item';
  row.dataset.index = i;

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!item.done;
  cb.setAttribute('aria-label', `Complete: ${item.label}`);
  cb.addEventListener('change', () => {
    _checklistItems[i].done = cb.checked;
    lbl.classList.toggle('done', cb.checked);
  });

  const lbl = document.createElement('span');
  lbl.className = `item-label${item.done ? ' done' : ''}`;
  lbl.textContent = item.label;

  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'remove-item';
  rm.setAttribute('aria-label', `Remove: ${item.label}`);
  rm.innerHTML = svgClose();
  rm.addEventListener('click', () => {
    _checklistItems.splice(i, 1); renderChecklistEditor();
    document.getElementById('new-item-input')?.focus();
  });

  row.append(cb, lbl, rm);
  return row;
}

function addChecklistItem() {
  const input = document.getElementById('new-item-input');
  if (!input) return;
  const label = input.value.trim().slice(0, MAX_LABEL_LEN);
  if (!label) return;
  if (_checklistItems.length >= MAX_CHECKLIST) return;
  _checklistItems.push({ id: generateId(), label, done: false });
  input.value = '';
  renderChecklistEditor();
  input.focus();
}

function saveRecord() {
  clearErrors();
  if (!editingId && records.length >= MAX_RECORDS) {
    showError('f-title', `Maximum ${MAX_RECORDS} entries. Export a backup before removing old entries.`);
    return;
  }
  const title        = getVal('f-title').trim().slice(0, MAX_TITLE_LEN);
  const sourceUrl    = getVal('f-source-url').trim();
  const cashRaw      = getVal('f-cash-amount').trim();
  const currency     = sanitiseText(getVal('f-currency'), 10);
  const creditsDesc  = sanitiseText(getVal('f-credits-desc'), MAX_CREDITS_LEN);
  const feeStatus    = getVal('f-fee-status');
  const deadlineRaw  = getVal('f-deadline').trim();
  const stage        = getVal('f-stage');
  const notes        = sanitiseText(getVal('f-notes'), MAX_NOTES_LEN);

  let valid = true;

  if (!title) { showError('f-title', 'Title is required.'); valid = false; }

  let resolvedUrl = '';
  if (sourceUrl) {
    const v = validateUrl(sourceUrl);
    if (!v.ok) { showError('f-source-url', v.error); valid = false; }
    else resolvedUrl = v.url;
    if (v.ok && records.some(r => r.id !== editingId && r.sourceUrl && normaliseUrl(r.sourceUrl) === normaliseUrl(resolvedUrl))) {
      showError('f-source-url', 'This source is already tracked. Edit the existing entry instead.'); valid = false;
    }
  }

  let cashAmount = null;
  if (cashRaw !== '') {
    const n = Number(cashRaw);
    if (isNaN(n) || n < 0 || !isFinite(n)) { showError('f-cash-amount', 'Must be a non-negative number.'); valid = false; }
    else cashAmount = n;
  }

  let deadline = null;
  if (deadlineRaw) {
    const p = parseDeadline(deadlineRaw);
    if ('error' in p) { showError('f-deadline', p.error); valid = false; }
    else deadline = p;
  }

  if (!valid) return;

  const now = new Date();
  const id  = editingId || generateId();

  // If deadline changed on an existing record, reset acks for that record
  if (editingId) {
    const old = records.find(r => r.id === editingId);
    if (old && ackKey(old) !== ackKey({ id, deadlineRaw, deadline })) {
      const oldKey = ackKey(old);
      const newAcks = { ...acks };
      delete newAcks[oldKey];
      acks = newAcks;
      saveAcks();
    }
  }

  const record = {
    id,
    title,
    sourceUrl: resolvedUrl,
    cashAmount,
    currency,
    creditsDescription: creditsDesc,
    feeStatus,
    deadlineRaw: deadlineRaw || null,
    stage,
    checklist: _checklistItems.map(i => ({ id: i.id || generateId(), label: i.label, done: !!i.done })),
    notes,
    createdAt: editingId ? (records.find(r => r.id === editingId)?.createdAt ?? now.toISOString()) : now.toISOString(),
    updatedAt: now.toISOString(),
    deadline
  };

  if (editingId) {
    records = records.map(r => r.id === editingId ? record : r);
  } else {
    records = [...records, record];
  }

  saveRecords();
  closeModal();
  render();
  announce(storageAvailable && !storageWriteBlocked
    ? `Entry saved. Stage: ${stage} (your local record).`
    : 'Entry updated in memory only. Export a backup before closing.');
}

function confirmDelete(id, title) {
  confirmAction(`Delete "${title}"? This cannot be undone. Export a backup first if you need to keep it.`, () => {
    records = records.filter(r => r.id !== id);
    for (const key of Object.keys(acks)) {
      if (key.startsWith(id + ':')) delete acks[key];
    }
    saveRecords(); saveAcks(); closeModal(); render();
  });
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

function exportRecords() {
  const toExport = records.map(({ deadline: _d, ...r }) => r);
  const payload = JSON.stringify({ version: 1, records: toExport,
    acknowledgements: currentAcknowledgements(records, acks),
    exportedAt: new Date().toISOString() }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `deadline-crypt-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  announce(`Backup export started: ${records.length} entries plus reminder history. Check your browser downloads.`);
}

function triggerImport() {
  document.getElementById('import-file-input')?.click();
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  if (file.size > 1_000_000) { showNotice('Import is limited to 1 MB. The current desk was not changed.'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    let payload;
    try { payload = JSON.parse(ev.target.result); }
    catch { showNotice('Invalid JSON file. Your current entries were not changed.'); return; }

    const validation = validateImportPayload(payload);
    if (!validation.ok) {
      showNotice('Import failed:\n\n' + validation.errors.join('\n'));
      return;
    }

    const incoming = validation.records.map(hydrate);
    const result = deduplicateRecords(records, incoming);
    if (!result.ok) {
      // Atomic rejection — e.g. would exceed MAX_RECORDS
      showNotice('Import rejected:\n\n' + result.errors.join('\n'));
      return;
    }
    pendingImport = { ...result, acknowledgements: validation.acknowledgements ?? {} };
    showImportDialog(result);
  };
  reader.onerror = () => showNotice('The file could not be read. Your current entries were not changed.');
  reader.readAsText(file);
}

function showImportDialog({ merged: _m, added, skipped, conflicts }) {
  const overlay = document.getElementById('import-overlay');
  const summary = document.getElementById('import-summary');
  const conflictList = document.getElementById('import-conflict-list');
  if (!overlay || !summary || !conflictList) return;

  summary.innerHTML = '';
  const addedSpan = document.createElement('span');
  addedSpan.className = 'count-added';
  addedSpan.textContent = `${added} new`;
  const skipSpan = document.createElement('span');
  skipSpan.className = 'count-skipped';
  skipSpan.textContent = `${skipped} skipped`;
  summary.append(
    document.createTextNode('Ready to import: '),
    addedSpan,
    document.createTextNode(' records, '),
    skipSpan,
    document.createTextNode(' duplicates.')
  );

  conflictList.innerHTML = '';
  if (conflicts.length > 0) {
    const ul = document.createElement('ul');
    for (const c of conflicts) {
      const li = document.createElement('li');
      li.textContent = c;
      ul.appendChild(li);
    }
    conflictList.appendChild(ul);
    conflictList.hidden = false;
  } else {
    conflictList.hidden = true;
  }

  importReturnFocus = document.activeElement;
  document.querySelector('.app-shell').inert = true;
  overlay.removeAttribute('hidden');
  document.getElementById('import-cancel')?.focus();
}

function confirmImport() {
  if (!pendingImport) return;
  const { added, skipped } = pendingImport;
  records = pendingImport.merged;
  acks = currentAcknowledgements(records, mergeAcknowledgementHistory(acks, pendingImport.acknowledgements));
  saveRecords();
  saveAcks();
  pendingImport = null;
  closeImportDialog();
  render();
  announce(`Import complete: ${added} added, ${skipped} duplicates kept. Your existing entries were preserved.`);
}

function closeImportDialog() {
  const overlay = document.getElementById('import-overlay');
  if (overlay) overlay.setAttribute('hidden', '');
  pendingImport = null;
  document.querySelector('.app-shell').inert = false;
  (importReturnFocus?.isConnected ? importReturnFocus : document.getElementById('btn-import'))?.focus();
}

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

function getVal(id) { return document.getElementById(id)?.value ?? ''; }
function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function showError(fieldId, msg) {
  const field = document.getElementById(fieldId);
  if (field) { field.classList.add('invalid'); field.setAttribute('aria-describedby', fieldId + '-err'); }
  const errEl = document.getElementById(fieldId + '-err');
  if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
}
function clearErrors() {
  document.querySelectorAll('.form-input.invalid, .form-select.invalid, .form-textarea.invalid')
    .forEach(el => { el.classList.remove('invalid'); el.removeAttribute('aria-describedby'); });
  document.querySelectorAll('.form-error').forEach(el => { el.textContent = ''; el.hidden = true; });
}

// ---------------------------------------------------------------------------
// Toolbar wiring
// ---------------------------------------------------------------------------

function wireToolbar() {
  document.getElementById('btn-demo')?.addEventListener('click', loadExamples);
  document.getElementById('search-input')?.addEventListener('input', e => {
    searchQuery = e.target.value;
    renderGrid();
  });
  document.getElementById('filter-stage')?.addEventListener('change', e => {
    filterStage = e.target.value;
    renderGrid();
  });
  document.getElementById('filter-cash')?.addEventListener('change', e => {
    filterCash = e.target.checked;
    renderGrid();
  });
  document.getElementById('sort-by')?.addEventListener('change', e => {
    sortBy = e.target.value;
    renderGrid();
  });
  document.getElementById('btn-new')?.addEventListener('click', openNewModal);
  document.getElementById('btn-export')?.addEventListener('click', exportRecords);
  document.getElementById('btn-import')?.addEventListener('click', triggerImport);
  document.getElementById('import-file-input')?.addEventListener('change', handleImportFile);
}

// ---------------------------------------------------------------------------
// Modal wiring
// ---------------------------------------------------------------------------

function wireModal() {
  document.getElementById('notice-ok').addEventListener('click', () => document.getElementById('notice-dialog').close());
  document.getElementById('confirm-cancel').addEventListener('click', () => document.getElementById('confirm-dialog').close());
  document.getElementById('confirm-dialog').addEventListener('close', () => { confirmationAction = null; });
  document.getElementById('confirm-continue').addEventListener('click', () => {
    const action = confirmationAction;
    document.getElementById('confirm-dialog').close();
    confirmationAction = null;
    action?.();
  });
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-save')?.addEventListener('click', saveRecord);
  document.getElementById('modal-delete-btn')?.addEventListener('click', () => {
    if (editingId) {
      const r = records.find(r => r.id === editingId);
      if (r) confirmDelete(r.id, r.title);
    }
  });
  document.getElementById('add-item-btn')?.addEventListener('click', addChecklistItem);
  document.getElementById('new-item-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); }
  });

  // Trap focus & close on Escape
  document.getElementById('modal-overlay')?.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    else trapDialogFocus(e);
  });

  // Import dialog
  document.getElementById('import-cancel')?.addEventListener('click', closeImportDialog);
  document.getElementById('import-confirm')?.addEventListener('click', confirmImport);
  document.getElementById('import-close')?.addEventListener('click', closeImportDialog);
  document.getElementById('import-overlay')?.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeImportDialog();
    else trapDialogFocus(e);
  });
}

function trapDialogFocus(e) {
  if (e.key !== 'Tab') return;
  const elements = [...e.currentTarget.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')]
    .filter(el => !el.hidden && el.getClientRects().length > 0);
  const first = elements[0], last = elements.at(-1);
  if (!first) return;
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ---------------------------------------------------------------------------
// Periodic refresh (reminders / countdowns)
// ---------------------------------------------------------------------------

let _ticker = null;
function startTicker() {
  _ticker = setInterval(() => render(), 30_000); // refresh every 30 s
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  loadState();
  wireToolbar();
  wireModal();
  render();
  startTicker();

  if (!storageAvailable || storageWriteBlocked) showStorageBadge();
}

document.addEventListener('DOMContentLoaded', init);

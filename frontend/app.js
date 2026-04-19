// app.js — Journal Sync main entry point
// Handles: form lifecycle, autosave, offline detection, and sync orchestration.

import { openDB, saveEntry, getEntryByDate, getUnsyncedEntries } from './db.js';
import { syncAll, isConfigured } from './sync.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS             = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DRAFT_KEY        = 'journal_sync_draft';
const LAST_SYNCED_KEY  = 'journal_last_synced';
const AUTOSAVE_DELAY   = 25_000; // 25 seconds

// ─── DOM references ───────────────────────────────────────────────────────────

const form              = document.getElementById('journal-form');
const saveBtn           = document.getElementById('save-btn');
const syncBtn           = document.getElementById('sync-btn');
const formMessage       = document.getElementById('form-message');
const toast             = document.getElementById('toast');
const connectBadge      = document.getElementById('connectivity-badge');
const syncBadge         = document.getElementById('sync-badge');
const unsyncedCount     = document.getElementById('unsynced-count');
const unsyncedNumber    = document.getElementById('unsynced-number');
const lastSyncedLabel   = document.getElementById('last-synced-label');
const lastSyncedTime    = document.getElementById('last-synced-time');
const dateInput         = document.getElementById('date');
const dayInput          = document.getElementById('day');

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  await openDB();
  prefillDate();

  // Priority: existing IDB entry > autosaved draft
  const loaded = await loadTodayEntry();
  if (!loaded) restoreDraft();

  await refreshStatusUI();
  registerServiceWorker();
  setupConnectivityListeners();
  setupAutosave();
  setupDependentCheckboxes();

  // Warn if the backend URL hasn't been configured yet
  if (!isConfigured()) {
    showToast('Add your Apps Script URL to sync.js to enable syncing', 'warning');
  } else if (navigator.onLine) {
    attemptSync({ silent: true });
  }
}

// ─── Date utilities ───────────────────────────────────────────────────────────

/** Return today as YYYY-MM-DD in the local timezone */
function todayString() {
  const d  = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Return the day name for a YYYY-MM-DD string */
function dayName(dateStr) {
  return DAYS[new Date(`${dateStr}T00:00:00`).getDay()];
}

function prefillDate() {
  const today     = todayString();
  dateInput.value = today;
  dayInput.value  = dayName(today);
}

// Recalculate day whenever the date field changes
dateInput.addEventListener('change', () => {
  if (dateInput.value) dayInput.value = dayName(dateInput.value);
});

// ─── Load today's entry from IndexedDB ───────────────────────────────────────

/**
 * Attempt to populate the form from an existing IDB entry for today.
 * @returns {Promise<boolean>} true if an entry was found and loaded
 */
async function loadTodayEntry() {
  try {
    const entry = await getEntryByDate(todayString());
    if (!entry) return false;
    populateForm(entry);
    showToast("Today's entry loaded from local storage", 'success');
    return true;
  } catch (err) {
    console.warn('[Journal Sync] Could not load today\'s entry:', err);
    return false;
  }
}

/** Fill every form field from an entry object */
function populateForm(entry) {
  // Date and day
  if (entry.date) dateInput.value = entry.date;
  if (entry.date) dayInput.value = dayName(entry.date);

  // Reflection fields
  if (entry.wakeTime) document.getElementById('wakeTime').value = entry.wakeTime;
  if (entry.people) document.getElementById('people').value = entry.people;
  if (entry.activity) document.getElementById('activity').value = entry.activity;
  if (entry.highlight) document.getElementById('highlight').value = entry.highlight;
  if (entry.mistakes) document.getElementById('mistakes').value = entry.mistakes;
  if (entry.insight) document.getElementById('insight').value = entry.insight;
  if (entry.gratefulFor) document.getElementById('gratefulFor').value = entry.gratefulFor;

  // Habits (checkboxes)
  const habits = ['intellectual', 'hobby', 'meditation', 'threeLWater', 'toxic', 'gym', 'cardio', 'mj', 'per', 'scl', 'phys', 'fam', 'nootropic'];
  habits.forEach(habit => {
    const checkEl = document.getElementById(habit);
    const noteEl = document.getElementById(habit + 'Note');
    if (checkEl && entry[habit] === 'Y') checkEl.checked = true;
    if (noteEl && entry[habit + 'Note']) noteEl.value = entry[habit + 'Note'];
  });

  // Money checkbox and notes
  const moneyEl = document.getElementById('money');
  const moneyNoteEl = document.getElementById('moneyNote');
  if (moneyEl && entry.money === 'Y') moneyEl.checked = true;
  if (moneyNoteEl && entry.moneyNote) moneyNoteEl.value = entry.moneyNote;

  showToast("Today's entry loaded from local storage", 'success');
}

// ─── Form submission ──────────────────────────────────────────────────────────

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMessage();

  const dateVal = dateInput.value || todayString();

  // Preserve the original createdAt if this entry already exists locally
  let createdAt;
  try {
    const existing = await getEntryByDate(dateVal);
    createdAt = existing?.createdAt ?? new Date().toISOString();
  } catch {
    createdAt = new Date().toISOString();
  }

  // Helper to get checkbox value as Y/N
  const getHabitValue = (checkboxId) => {
    const el = document.getElementById(checkboxId);
    return el && el.checked ? 'Y' : 'N';
  };

  // Helper to get optional text value
  const getHabitNote = (noteId) => {
    const el = document.getElementById(noteId);
    return el ? el.value.trim() : '';
  };

  /** @type {JournalEntry} */
  const entry = {
    id:                  dateVal,
    date:                dateVal,
    day:                 dayName(dateVal),

    // Reflection fields
    wakeTime:            val('wakeTime'),
    people:              val('people'),
    activity:            val('activity'),
    highlight:           val('highlight'),
    mistakes:            val('mistakes'),
    insight:             val('insight'),
    gratefulFor:         val('gratefulFor'),

    // Habits with optional notes
    intellectual:        getHabitValue('intellectual'),
    intellectualNote:    getHabitNote('intellectualNote'),
    hobby:               getHabitValue('hobby'),
    hobbyNote:           getHabitNote('hobbyNote'),
    meditation:          getHabitValue('meditation'),
    meditationNote:      getHabitNote('meditationNote'),
    threeLWater:         getHabitValue('threeLWater'),
    threeLWaterNote:     getHabitNote('threeLWaterNote'),
    toxic:               getHabitValue('toxic'),
    toxicNote:           getHabitNote('toxicNote'),
    gym:                 getHabitValue('gym'),
    gymNote:             getHabitNote('gymNote'),
    cardio:              getHabitValue('cardio'),
    cardioNote:          getHabitNote('cardioNote'),
    mj:                  getHabitValue('mj'),
    mjNote:              getHabitNote('mjNote'),
    per:                 getHabitValue('per'),
    perNote:             getHabitNote('perNote'),
    scl:                 getHabitValue('scl'),
    sclNote:             getHabitNote('sclNote'),
    phys:                getHabitValue('phys'),
    physNote:            getHabitNote('physNote'),
    fam:                 getHabitValue('fam'),
    famNote:             getHabitNote('famNote'),
    nootropic:           getHabitValue('nootropic'),
    nootropicNote:       getHabitNote('nootropicNote'),

    // Money checkbox and notes
    money:               getHabitValue('money'),
    moneyNote:           getHabitNote('moneyNote'),

    // Metadata
    createdAt,
    updatedAt:           new Date().toISOString(),
    synced:              false,
    syncedAt:            null,
  };

  saveBtn.disabled    = true;
  saveBtn.textContent = 'Saving…';

  try {
    await saveEntry(entry);
    clearDraft();
    showMessage('Saved locally.', 'success');
    await refreshStatusUI();

    if (!isConfigured()) {
      showToast('Entry saved locally. Add your Apps Script URL to sync.', 'warning');
    } else if (navigator.onLine) {
      showToast('Syncing…', 'success');
      await attemptSync();
    } else {
      showToast('Offline — entry queued for sync', 'success');
      // Clear form after saving offline
      setTimeout(() => clearFormFields(), 1000);
    }
  } catch (err) {
    console.error('[Journal Sync] Save failed:', err);
    showMessage('Save failed. Please try again.', 'error');
  } finally {
    saveBtn.disabled    = false;
    saveBtn.innerHTML   = '<span class="btn-icon" aria-hidden="true">💾</span> Save Locally';
  }
});

function validateForm() {
  const reflectionEl = document.getElementById('reflection');
  reflectionEl.classList.remove('error');
  if (!reflectionEl.value.trim()) {
    reflectionEl.classList.add('error');
    reflectionEl.focus();
    showMessage('The Key Reflection field is required.', 'error');
    return false;
  }
  return true;
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

syncBtn.addEventListener('click', async () => {
  if (!navigator.onLine) {
    showToast('You are offline — cannot sync now', 'error');
    return;
  }
  if (!isConfigured()) {
    showToast('Add your Apps Script URL to sync.js first', 'error');
    return;
  }
  await attemptSync();
});

// ─── Clear Form ───────────────────────────────────────────────────────────────

const clearBtn = document.getElementById('clear-btn');
clearBtn.addEventListener('click', () => {
  if (confirm('Clear all form fields? This will delete your current entry draft.')) {
    clearFormFields();
    showToast('Form cleared', 'success');
  }
});

/**
 * Run syncAll() and update the UI.
 * @param {{ silent?: boolean }} [opts]  If silent, skip toasts when nothing queued
 */
async function attemptSync(opts = {}) {
  syncBtn.disabled   = true;
  syncBtn.innerHTML  = '<span class="btn-icon" aria-hidden="true">⏳</span> Syncing…';

  try {
    const { synced, failed } = await syncAll();

    if (synced > 0) {
      const message = `✅ ${synced} entr${synced === 1 ? 'y' : 'ies'} synced to Google Sheets!`;
      showToast(message, 'success');
      alert(message + '\n\nYour entry has been sent successfully.');
      localStorage.setItem(LAST_SYNCED_KEY, new Date().toISOString());
      clearFormFields();
    } else if (failed > 0) {
      showToast(`Sync failed for ${failed} entr${failed === 1 ? 'y' : 'ies'}`, 'error');
    } else if (!opts.silent) {
      showToast('Everything is already synced', 'success');
    }
  } catch (err) {
    console.error('[Journal Sync] Sync error:', err);
    showToast('Sync failed — will retry when back online', 'error');
  } finally {
    syncBtn.disabled   = false;
    syncBtn.innerHTML  = '<span class="btn-icon" aria-hidden="true">🔄</span> Sync Now';
    await refreshStatusUI();
  }
}

// ─── Status UI ────────────────────────────────────────────────────────────────

async function refreshStatusUI() {
  try {
    const pending = await getUnsyncedEntries();
    const count   = pending.length;

    if (count > 0) {
      unsyncedNumber.textContent = count;
      unsyncedCount.hidden       = false;
      syncBadge.textContent      = `${count} local`;
      syncBadge.className        = 'badge badge--local';
      syncBadge.hidden           = false;
    } else {
      unsyncedCount.hidden  = true;
      syncBadge.textContent = 'Synced';
      syncBadge.className   = 'badge badge--synced';
      syncBadge.hidden      = false;
    }

    const ts = localStorage.getItem(LAST_SYNCED_KEY);
    if (ts) {
      lastSyncedLabel.hidden      = false;
      lastSyncedTime.textContent  = relativeTime(new Date(ts));
    }
  } catch (err) {
    console.warn('[Journal Sync] Status refresh error:', err);
  }
}

function relativeTime(date) {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return date.toLocaleDateString();
}

// ─── Connectivity ─────────────────────────────────────────────────────────────

function setupConnectivityListeners() {
  updateConnectivityBadge(navigator.onLine);

  window.addEventListener('online', async () => {
    updateConnectivityBadge(true);
    if (isConfigured()) {
      showToast('Back online — syncing queued entries…', 'success');
      await attemptSync({ silent: true });
    } else {
      showToast('Back online', 'success');
    }
  });

  window.addEventListener('offline', () => {
    updateConnectivityBadge(false);
    showToast('You are now offline — entries will be queued', 'warning');
  });
}

function updateConnectivityBadge(online) {
  connectBadge.textContent = online ? 'Online' : 'Offline';
  connectBadge.className   = `badge badge--${online ? 'online' : 'offline'}`;
}

// ─── Draft autosave ───────────────────────────────────────────────────────────
// Silently saves all form content to localStorage every AUTOSAVE_DELAY ms
// after the last keypress. Cleared on explicit save to prevent stale restores.

let _autosaveTimer = null;

function setupAutosave() {
  form.querySelectorAll('input:not([readonly]), textarea').forEach(el => {
    el.addEventListener('input', () => {
      clearTimeout(_autosaveTimer);
      _autosaveTimer = setTimeout(saveDraft, AUTOSAVE_DELAY);
    });
  });
}

// ─── Dependent checkboxes ─────────────────────────────────────────────────────

/**
 * Setup dependent checkbox logic:
 * - If Cardio OR Gym is checked → auto-check PHYS
 * - If MJ is checked → auto-check PER
 */
function setupDependentCheckboxes() {
  const cardioEl = document.getElementById('cardio');
  const gymEl = document.getElementById('gym');
  const physEl = document.getElementById('phys');
  const mjEl = document.getElementById('mj');
  const perEl = document.getElementById('per');

  const updatePhys = () => {
    if (cardioEl.checked || gymEl.checked) {
      physEl.checked = true;
    }
  };

  const updatePer = () => {
    if (mjEl.checked) {
      perEl.checked = true;
    }
  };

  cardioEl.addEventListener('change', updatePhys);
  gymEl.addEventListener('change', updatePhys);
  mjEl.addEventListener('change', updatePer);
}


function saveDraft() {
  try {
    // Helper functions
    const getHabitValue = (checkboxId) => {
      const el = document.getElementById(checkboxId);
      return el && el.checked ? 'Y' : 'N';
    };
    const getHabitNote = (noteId) => {
      const el = document.getElementById(noteId);
      return el ? el.value.trim() : '';
    };

    const draft = {
      date:                dateInput.value,
      wakeTime:            val('wakeTime'),
      people:              val('people'),
      activity:            val('activity'),
      highlight:           val('highlight'),
      mistakes:            val('mistakes'),
      insight:             val('insight'),
      gratefulFor:         val('gratefulFor'),
      intellectual:        getHabitValue('intellectual'),
      intellectualNote:    getHabitNote('intellectualNote'),
      hobby:               getHabitValue('hobby'),
      hobbyNote:           getHabitNote('hobbyNote'),
      meditation:          getHabitValue('meditation'),
      meditationNote:      getHabitNote('meditationNote'),
      threeLWater:         getHabitValue('threeLWater'),
      threeLWaterNote:     getHabitNote('threeLWaterNote'),
      toxic:               getHabitValue('toxic'),
      toxicNote:           getHabitNote('toxicNote'),
      gym:                 getHabitValue('gym'),
      gymNote:             getHabitNote('gymNote'),
      cardio:              getHabitValue('cardio'),
      cardioNote:          getHabitNote('cardioNote'),
      mj:                  getHabitValue('mj'),
      mjNote:              getHabitNote('mjNote'),
      per:                 getHabitValue('per'),
      perNote:             getHabitNote('perNote'),
      scl:                 getHabitValue('scl'),
      sclNote:             getHabitNote('sclNote'),
      phys:                getHabitValue('phys'),
      physNote:            getHabitNote('physNote'),
      fam:                 getHabitValue('fam'),
      famNote:             getHabitNote('famNote'),
      nootropic:           getHabitValue('nootropic'),
      nootropicNote:       getHabitNote('nootropicNote'),
      money:               getHabitValue('money'),
      moneyNote:           getHabitNote('moneyNote'),
      savedAt:             new Date().toISOString(),
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Silently ignore localStorage quota errors
  }
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);

    // Restore date
    if (draft.date) {
      dateInput.value = draft.date;
      dayInput.value  = dayName(draft.date);
    }

    // Restore reflection fields
    if (draft.wakeTime) document.getElementById('wakeTime').value = draft.wakeTime;
    if (draft.people) document.getElementById('people').value = draft.people;
    if (draft.activity) document.getElementById('activity').value = draft.activity;
    if (draft.highlight) document.getElementById('highlight').value = draft.highlight;
    if (draft.mistakes) document.getElementById('mistakes').value = draft.mistakes;
    if (draft.insight) document.getElementById('insight').value = draft.insight;
    if (draft.gratefulFor) document.getElementById('gratefulFor').value = draft.gratefulFor;

    // Restore habit checkboxes and notes
    const habits = ['intellectual', 'hobby', 'meditation', 'threeLWater', 'toxic', 'gym', 'cardio', 'mj', 'per', 'scl', 'phys', 'fam', 'nootropic'];
    habits.forEach(habit => {
      const checkEl = document.getElementById(habit);
      const noteEl = document.getElementById(habit + 'Note');
      if (checkEl && draft[habit] === 'Y') checkEl.checked = true;
      if (noteEl && draft[habit + 'Note']) noteEl.value = draft[habit + 'Note'];
    });

    // Restore money checkbox and notes
    const moneyEl = document.getElementById('money');
    const moneyNoteEl = document.getElementById('moneyNote');
    if (moneyEl && draft.money === 'Y') moneyEl.checked = true;
    if (moneyNoteEl && draft.moneyNote) moneyNoteEl.value = draft.moneyNote;

    showToast('Draft restored from your last session', 'success');
  } catch {
    // Ignore malformed or missing draft
  }
}

function clearDraft() {
  clearTimeout(_autosaveTimer);
  localStorage.removeItem(DRAFT_KEY);
}

/** Clear all form fields and reset to today's date */
function clearFormFields() {
  form.reset();
  prefillDate();
  clearDraft();
}

// ─── Service Worker ───────────────────────────────────────────────────────────

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./service-worker.js')
    .then(reg  => console.log('[Journal Sync] SW registered, scope:', reg.scope))
    .catch(err => console.warn('[Journal Sync] SW registration failed:', err));
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

let _toastTimer = null;

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'warning'} type
 */
function showToast(message, type = 'success') {
  clearTimeout(_toastTimer);
  toast.textContent = message;
  toast.className   = `toast toast--${type}`;
  toast.hidden      = false;
  _toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

function showMessage(text, type) {
  formMessage.textContent = text;
  formMessage.className   = `form-message form-message--${type}`;
  formMessage.hidden      = false;
}

function clearMessage() {
  formMessage.hidden      = true;
  formMessage.textContent = '';
}

/** Trim + return value of a form field by id */
function val(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

// ─── Start ────────────────────────────────────────────────────────────────────

init().catch(err => console.error('[Journal Sync] Init failed:', err));

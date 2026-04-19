// sync.js — Handles syncing local IndexedDB entries to Google Sheets
// via a Google Apps Script Web App endpoint.

import { getUnsyncedEntries, markSynced } from './db.js';

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
// ⚠️  After deploying your Apps Script, paste the Web App URL here.
//     Format: https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwislQfs1TFVBiH2dDzP1Uph_Ixs1awKScZosyk1-i-oysGMLb3Nl6HxWNmxPTQ959r/exec';

const SYNC_TIMEOUT_MS = 15_000; // abort if a single request takes > 15 s

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether the Apps Script URL has been configured.
 * Useful for showing setup guidance in the UI before the first real sync.
 * @returns {boolean}
 */
export function isConfigured() {
  return (
    typeof APPS_SCRIPT_URL === 'string' &&
    APPS_SCRIPT_URL.length > 0 &&
    APPS_SCRIPT_URL !== 'YOUR_APPS_SCRIPT_URL_HERE'
  );
}

/**
 * Attempt to sync every unsynced local entry to Google Sheets.
 * Entries are sent one at a time to avoid hammering the endpoint.
 *
 * @returns {Promise<{ synced: number, failed: number }>}
 */
export async function syncAll() {
  const pending = await getUnsyncedEntries();
  if (pending.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const entry of pending) {
    try {
      await syncOne(entry);
      synced++;
    } catch (err) {
      console.warn(`[Journal Sync] Failed to sync entry ${entry.id}:`, err.message);
      failed++;
    }
  }

  return { synced, failed };
}

/**
 * Sync a single entry object to Google Sheets.
 * Throws on network error, timeout, or a non-success response from the backend.
 *
 * @param {object} entry  A full entry object from IndexedDB
 * @returns {Promise<object>}  The parsed JSON response from Apps Script
 */
export async function syncOne(entry) {
  if (!isConfigured()) {
    throw new Error(
      'Apps Script URL is not set. Open sync.js and replace APPS_SCRIPT_URL.'
    );
  }

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

  try {
    // Using Content-Type: text/plain avoids the CORS preflight request that
    // can block Apps Script Web App responses from non-Google origins.
    // The body is still valid JSON and Apps Script parses it identically.
    const response = await fetch(APPS_SCRIPT_URL, {
      method:   'POST',
      headers:  { 'Content-Type': 'text/plain;charset=utf-8' },
      body:     JSON.stringify(buildPayload(entry)),
      signal:   controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} — ${response.statusText}`);
    }

    const data = await response.json();

    if (data.status !== 'success') {
      throw new Error(data.message || 'Apps Script returned a non-success status');
    }

    // Persist the synced state locally so the UI updates correctly
    await markSynced(entry.id);
    return data;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error('Sync request timed out after 15 seconds');
    }
    throw err;
  }
}

// ─── Payload builder ─────────────────────────────────────────────────────────

/**
 * Map frontend field names → Google Sheet column header names.
 * Combines Y/N with optional notes: "Y - notes" or just "Y"/"N"
 *
 * @param {object} entry
 * @returns {object}  Ready-to-POST payload
 */
function buildPayload(entry) {
  // Helper to combine Y/N with optional notes
  const formatHabit = (yesNo, notes) => {
    if (!notes || notes.trim() === '') return yesNo;
    return `${yesNo} - ${notes}`;
  };

  return {
    'Date':                       entry.date,
    'Wake Time':                  entry.wakeTime,
    'People':                     entry.people,
    'Activity':                   entry.activity,
    'What moved forward':         entry.highlight,
    'Mistakes/Learnings':         entry.mistakes,
    'Insight':                    entry.insight,
    'Grateful for':               entry.gratefulFor,
    'Intellectual':               formatHabit(entry.intellectual, entry.intellectualNote),
    'Hobby':                      formatHabit(entry.hobby, entry.hobbyNote),
    'Meditation':                 formatHabit(entry.meditation, entry.meditationNote),
    '3L Water':                   formatHabit(entry.threeLWater, entry.threeLWaterNote),
    'Toxic':                      formatHabit(entry.toxic, entry.toxicNote),
    'Gym':                        formatHabit(entry.gym, entry.gymNote),
    'Cardio':                     formatHabit(entry.cardio, entry.cardioNote),
    'MJ':                         formatHabit(entry.mj, entry.mjNote),
    'PER':                        formatHabit(entry.per, entry.perNote),
    'SCL':                        formatHabit(entry.scl, entry.sclNote),
    'PHYS':                       formatHabit(entry.phys, entry.physNote),
    'FAM':                        formatHabit(entry.fam, entry.famNote),
    '$':                          formatHabit(entry.money, entry.moneyNote),
    'NOOTROPIC':                  formatHabit(entry.nootropic, entry.nootropicNote),
  };
}

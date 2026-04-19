// ============================================================
// Code.gs — Journal Sync · Google Apps Script Backend
// ============================================================
//
// SETUP (do this once):
//   1. Open https://script.google.com and create a new project.
//   2. Paste this entire file into the editor.
//   3. Fill in SPREADSHEET_ID and SHEET_NAME below.
//   4. Click Deploy → New Deployment → Web App.
//      • Execute as:   Me
//      • Who has access: Anyone  (anonymous — no login required)
//   5. Copy the deployment URL and paste it into
//      frontend/sync.js  →  const APPS_SCRIPT_URL = https://script.google.com/macros/s/AKfycbwislQfs1TFVBiH2dDzP1Uph_Ixs1awKScZosyk1-i-oysGMLb3Nl6HxWNmxPTQ959r/exec
var SHEET_NAME = '01. Journal';  // Change this if it's not already
// RE-DEPLOY after every code change:
//   Deploy → Manage Deployments → Edit → New Version → Deploy.
// ============================================================

// ── CONFIGURATION ────────────────────────────────────────────
// ⚠️  Replace with your actual Spreadsheet ID.
//     Find it in the sheet URL:
//     https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
var SPREADSHEET_ID = '1I9yoaokpOCRdhCMY305Jr65Dw3iJkoIfaW0M26C2V_0';

// ⚠️  Replace with the exact name of the sheet tab to write to.
//     This is the tab name at the bottom of the spreadsheet (case-sensitive).
var SHEET_NAME = '01. Journal';

// The column header used as the unique key per row.
// Change this only if your Date column has a different header.
var DATE_COLUMN_HEADER = 'Date';

// ── Entry point ──────────────────────────────────────────────

/**
 * Receives POST requests from the Journal Sync frontend.
 * Parses the JSON body, validates it, then upserts the entry
 * into the target sheet.
 *
 * @param {GoogleAppsScript.Events.DoPost} e
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  try {
    var payload = parsePayload(e);
    if (!payload) {
      return jsonResponse({ status: 'error', message: 'Invalid or empty request body.' }, 400);
    }

    var validation = validatePayload(payload);
    if (!validation.ok) {
      return jsonResponse({ status: 'error', message: validation.message }, 400);
    }

    var sheet = openSheet();
    updateOrInsertEntry(sheet, payload);

    return jsonResponse({
      status:  'success',
      message: 'Entry saved.',
      date:    payload[DATE_COLUMN_HEADER]
    });

  } catch (err) {
    console.error('doPost error: ' + err.message + '\n' + err.stack);
    return jsonResponse({ status: 'error', message: err.message || 'Internal server error.' }, 500);
  }
}

/**
 * Simple health check — visit the deployment URL in a browser to confirm
 * the script is running.
 */
function doGet() {
  return jsonResponse({ status: 'ok', message: 'Journal Sync backend is live.' });
}

// ── Payload helpers ──────────────────────────────────────────

/**
 * Safely parse the JSON body from a POST event.
 * Returns null if the body is missing or malformed.
 *
 * @param {GoogleAppsScript.Events.DoPost} e
 * @returns {Object|null}
 */
function parsePayload(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return null;
    return JSON.parse(e.postData.contents);
  } catch (_) {
    return null;
  }
}

/**
 * Validate that the payload contains the required Date field.
 *
 * @param {Object} payload
 * @returns {{ ok: boolean, message?: string }}
 */
function validatePayload(payload) {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, message: 'Payload must be a JSON object.' };
  }
  if (!payload[DATE_COLUMN_HEADER] || String(payload[DATE_COLUMN_HEADER]).trim() === '') {
    return { ok: false, message: 'Missing required field: "' + DATE_COLUMN_HEADER + '".' };
  }
  return { ok: true };
}

// ── Sheet helpers ────────────────────────────────────────────

/**
 * Open the configured spreadsheet and return the named sheet.
 * Throws a descriptive error if either is not found.
 *
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function openSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('Sheet "' + SHEET_NAME + '" was not found in spreadsheet "' + ss.getName() + '".');
  }
  return sheet;
}

/**
 * Read the first row of the sheet and return a map of
 *   { "Header Name" → columnIndex (1-based) }
 *
 * Headers are trimmed of surrounding whitespace.
 * Empty cells are skipped.
 *
 * Example result: { 'Date': 1, 'Day': 2, 'Wake up': 3, … }
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Object.<string, number>}
 */
function buildHeaderMap(sheet) {
  var lastCol  = sheet.getLastColumn();
  if (lastCol === 0) return {};

  var headers  = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map      = {};

  headers.forEach(function(header, index) {
    var key = String(header).trim();
    if (key) map[key] = index + 1;  // store as 1-based column number
  });

  return map;
}

/**
 * Normalize a raw date value to the canonical YYYY-MM-DD string so that
 * comparisons between the incoming payload and sheet cell values are reliable,
 * regardless of how Sheets stores the date (Date object, string, number, etc.).
 *
 * @param {*} raw
 * @returns {string}  YYYY-MM-DD, or the raw value trimmed if parsing fails
 */
function normalizeDate(raw) {
  if (!raw && raw !== 0) return '';

  var str = String(raw).trim();

  // Already in YYYY-MM-DD — return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // Sheets may return a JavaScript Date object when the cell is formatted as Date
  if (raw instanceof Date) {
    var yyyy = raw.getFullYear();
    var mm   = String(raw.getMonth() + 1).padStart(2, '0');
    var dd   = String(raw.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  // Attempt generic Date parsing as a last resort
  try {
    var d = new Date(str);
    if (!isNaN(d.getTime())) {
      var y  = d.getFullYear();
      var mo = String(d.getMonth() + 1).padStart(2, '0');
      var dy = String(d.getDate()).padStart(2, '0');
      return y + '-' + mo + '-' + dy;
    }
  } catch (_) { /* fall through */ }

  return str;
}

/**
 * Search the Date column for a row matching the given date string.
 * Reads the entire column in a single API call for efficiency.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} dateStr  YYYY-MM-DD
 * @returns {number}  1-based row index, or -1 if not found
 */
function findRowByDate(sheet, dateStr) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;  // sheet has only a header row (or is empty)

  var headerMap   = buildHeaderMap(sheet);
  var dateColIdx  = headerMap[DATE_COLUMN_HEADER];

  if (!dateColIdx) {
    throw new Error(
      'Column "' + DATE_COLUMN_HEADER + '" not found in the sheet\'s header row. ' +
      'Check SHEET_NAME and DATE_COLUMN_HEADER in Code.gs.'
    );
  }

  var normalTarget = normalizeDate(dateStr);
  var dataRows     = lastRow - 1;  // exclude header

  // Read all date cells at once (single Sheets API call)
  var values = sheet.getRange(2, dateColIdx, dataRows, 1).getValues();

  for (var i = 0; i < values.length; i++) {
    if (normalizeDate(values[i][0]) === normalTarget) {
      return i + 2;  // +1 for 0-index, +1 for header row → 1-based
    }
  }

  return -1;
}

// ── Core upsert ──────────────────────────────────────────────

/**
 * Write the payload to the sheet, either updating an existing row for the
 * given date or appending a new row if the date is not found.
 *
 * Rules:
 *   • Only writes fields whose header exists in the sheet's header map.
 *   • Skips fields with undefined / null / empty-string values on UPDATE
 *     (preserves whatever is already in the cell).
 *   • On INSERT, empty fields become empty cells.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Object} payload
 */
function updateOrInsertEntry(sheet, payload) {
  var headerMap = buildHeaderMap(sheet);
  var dateStr   = payload[DATE_COLUMN_HEADER];
  var rowIndex  = findRowByDate(sheet, dateStr);

  if (rowIndex === -1) {
    // ── Insert new row ──────────────────────────────────────
    var colCount = sheet.getLastColumn() || Object.keys(headerMap).length;
    var newRow   = new Array(colCount).fill('');

    Object.keys(payload).forEach(function(key) {
      var colIdx = headerMap[key];
      var value  = payload[key];
      if (colIdx && value !== undefined && value !== null) {
        newRow[colIdx - 1] = value;  // array is 0-indexed
      }
    });

    sheet.appendRow(newRow);
    console.log('Inserted new row for date: ' + dateStr);

  } else {
    // ── Update existing row ────────────────────────────────
    // Batch writes: collect all cell updates and apply them in one pass
    // to minimise Sheets API calls.
    Object.keys(payload).forEach(function(key) {
      var colIdx = headerMap[key];
      var value  = payload[key];
      // Skip: column not in sheet, or value is empty (don't overwrite with blank)
      if (!colIdx || value === undefined || value === null || value === '') return;
      sheet.getRange(rowIndex, colIdx).setValue(value);
    });

    console.log('Updated row ' + rowIndex + ' for date: ' + dateStr);
  }
}

// ── Response helper ──────────────────────────────────────────

/**
 * Wrap an object as a JSON ContentService response.
 * Note: Apps Script Web Apps do not expose HTTP status codes to the caller —
 * the statusCode param is for documentation purposes only.
 *
 * @param {Object} obj
 * @param {number} [statusCode]  Ignored by Apps Script; kept for readability
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function jsonResponse(obj, statusCode) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

# Journal Sync

A mobile-first, offline-first journaling PWA that saves daily reflections
to IndexedDB locally and syncs them into an existing Google Sheet.

---

## Folder structure

```
journal-sync/
├── frontend/
│   ├── index.html          App shell + journal form
│   ├── styles.css          Dark-green mobile-first styles
│   ├── app.js              Form lifecycle, autosave, connectivity, orchestration
│   ├── db.js               IndexedDB wrapper (open, save, get, mark-synced)
│   ├── sync.js             POST to Apps Script, timeout, retry logic
│   ├── manifest.json       PWA manifest
│   ├── service-worker.js   Offline cache (cache-first strategy)
│   └── icons/
│       └── icon.svg        App icon (used as favicon + PWA icon)
├── backend/
│   └── Code.gs             Google Apps Script (doPost, header map, upsert)
└── README.md               This file
```

---

## Prerequisites

- A Google account with access to Google Sheets and Google Apps Script
- A local HTTP server for development (options below)
- A modern browser (Chrome, Safari, Firefox, Edge)

---

## 1 · Frontend — run locally

The app uses ES modules and a service worker, both of which require an HTTP
server (they do **not** work when opened as a `file://` URL).

**Option A — Python (no install needed on macOS/Linux)**
```bash
cd journal-sync/frontend
python -m http.server 8080
# Open http://localhost:8080
```

**Option B — Node `serve`**
```bash
npx serve journal-sync/frontend -p 8080
# Open http://localhost:8080
```

**Option C — VS Code Live Server extension**
Right-click `frontend/index.html` → "Open with Live Server".

---

## 2 · Backend — deploy Apps Script

### 2a · Configure the script

1. Open [script.google.com](https://script.google.com) and create a **new project**.
2. Delete the default empty function and paste the full contents of
   `backend/Code.gs` into the editor.
3. Find these two lines near the top and fill them in:

   ```javascript
   var SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
   var SHEET_NAME     = 'Journal';
   ```

   - **SPREADSHEET_ID** — the long ID string from your spreadsheet's URL:
     `https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit`
   - **SHEET_NAME** — the exact name of the tab at the bottom of your sheet
     (case-sensitive, including spaces).

4. Save the project (`Ctrl+S` / `Cmd+S`).

### 2b · First-time authorisation

Run the `doGet` function once from the editor (click ▶ Run) to trigger the
OAuth permission screen. Approve access to your spreadsheet.

### 2c · Deploy as a Web App

1. Click **Deploy → New Deployment**.
2. Click the gear icon next to "Select type" and choose **Web App**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone *(allows the frontend to POST without login)*
4. Click **Deploy**.
5. Copy the **Web App URL** — it looks like:
   `https://script.google.com/macros/s/AKfycb…/exec`

### 2d · After every code change

Go to **Deploy → Manage Deployments → Edit → New Version → Deploy** to push
updates. The URL stays the same.

---

## 3 · Connect the frontend to the backend

Open `frontend/sync.js` and replace the placeholder URL:

```javascript
// Before
const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL_HERE';

// After
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycb…/exec';
```

Save the file. The sync button and auto-sync on startup will now work.

---

## 4 · Column header mapping

The keys in `sync.js → buildPayload()` must match your sheet's header row
**exactly** (case-sensitive, including spaces). The defaults match:

| Frontend field      | Expected sheet header                         |
|---------------------|-----------------------------------------------|
| `date`              | `Date`                                        |
| `day`               | `Day`                                         |
| `wakeUp`            | `Wake up`                                     |
| `peopleSpentTimeWith` | `People i spent time with`                  |
| `reflection`        | `Key Comment / Reflection / Take away`        |
| `highlight`         | `What went well / Highlight`                  |
| `mistakes`          | `Mistakes / Learnings`                        |
| `progress`          | `Progress What moved forward today?`          |
| `insight`           | `Insight What did today teach me?`            |
| `focusTomorrow`     | `Focus What actually matters tomorrow?`       |

If a header in your sheet differs from the table above, update the matching
key in `buildPayload()` in `frontend/sync.js`. The Apps Script backend reads
headers dynamically, so no backend change is needed.

---

## 5 · Test offline mode

1. Open the app in Chrome and fill in the form.
2. Open DevTools → **Application → Service Workers** — confirm the SW is active.
3. Tick **Offline** in DevTools → **Network** tab.
4. Press **Save Locally** — entry saves to IndexedDB, toast says "queued".
5. Untick **Offline** — the app detects the `online` event and auto-syncs.
6. Check your Google Sheet — the row should appear within a few seconds.

---

## How the sync flow works

```
User fills form
      │
      ▼
[ Save Locally button ]
      │
      ├─ collectFormData()         ← builds the entry object
      ├─ saveEntry() (IndexedDB)   ← upsert keyed by YYYY-MM-DD
      └─ clearDraft() (localStorage)

If online:
      │
      ▼
[ attemptSync() ]
      │
      ├─ getUnsyncedEntries()      ← reads all entries where synced === false
      └─ for each entry:
            │
            ├─ buildPayload()      ← maps JS field names → sheet column headers
            ├─ fetch(APPS_SCRIPT_URL, POST)
            │
            └─ Apps Script:
                  ├─ parsePayload()
                  ├─ validatePayload()
                  ├─ buildHeaderMap()    ← reads row 1 of the sheet dynamically
                  ├─ findRowByDate()     ← scans Date column for matching date
                  └─ updateOrInsertEntry()
                        ├─ UPDATE existing row  (date already in sheet)
                        └─ INSERT appendRow()   (new date)

On success:
      └─ markSynced(id)            ← patches entry in IndexedDB: synced = true
      └─ UI refreshes badges / last-synced timestamp
```

If the device is offline when Save is pressed, the entry stays in IndexedDB
with `synced: false`. The `window.addEventListener('online', …)` listener
fires the next time connectivity returns, triggering a full `syncAll()` pass.

---

## Deployment checklist

- [ ] `SPREADSHEET_ID` set in `Code.gs`
- [ ] `SHEET_NAME` set in `Code.gs`
- [ ] `doGet` run once in editor to approve OAuth
- [ ] Apps Script deployed as Web App (Execute as: Me, Access: Anyone)
- [ ] Web App URL pasted into `frontend/sync.js`
- [ ] Sheet header row matches keys in `buildPayload()` exactly
- [ ] Frontend served over HTTP (not `file://`)
- [ ] Service worker confirmed active in DevTools
- [ ] Offline test: save → go offline → back online → sheet updated

---

## Easy next upgrades

| Feature | How |
|---------|-----|
| **Voice notes** | Add a `<button>` that uses the Web Speech API (`SpeechRecognition`) to transcribe into a textarea |
| **Mood slider** | Add `<input type="range" min="1" max="10">`, store as `mood` field, add matching column to sheet |
| **Checkbox habits** | Add a small habits array, render as checkboxes, serialise to a comma-separated string before sync |
| **Weekly export** | Add a button that reads all entries from IndexedDB for the last 7 days and downloads a `.csv` |
| **AI weekly reflection** | On "Export", POST the week's entries to the Apps Script which calls the Gemini API (`UrlFetchApp`) and appends a summary row |

---

## Notes

- **One entry per day** — the `id` and the IndexedDB key are both the `YYYY-MM-DD`
  date string. Saving again on the same day overwrites the local entry and
  tells Apps Script to update (not create) the matching row.
- **CORS** — the frontend sends `Content-Type: text/plain` to avoid the CORS
  preflight request, which Apps Script Web Apps can sometimes block.
  The body is still valid JSON and Apps Script parses it identically.
- **Icons** — the SVG icon works everywhere modern. For the best Android PWA
  install experience, export `icons/icon.svg` as `icon-192.png` and
  `icon-512.png` and add them to `manifest.json`.

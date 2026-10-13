# CVV Smart Outpass System

Flask + SQLite backend for the hostel outpass prototype. The server enforces every rule;
the browser only shows what the server returns.

## Run it

```bash
pip install -r requirements.txt
python3 app.py
```

Easiest: double-click `start.command` (Mac) or `start.bat` (Windows). It installs Flask if needed and opens the browser.

Or open http://localhost:8000. Demo accounts are under "Demo accounts" on the login page (password `pass123`).
The database (`outpass.db`) is created on first run. Delete it to start fresh.

Run the tests: `pip install reportlab && python test_flows.py`

## What's where

| File | What it does |
|---|---|
| `app.py` | Backend: login, workflow rules, 10 PM cutoff, gate scans, alerts, parent page API, calendar sync |
| `index.html`, `app.js`, `style.css` | Student / staff web app |
| `parent.html` | The parent's page (opened from the WhatsApp link, no login) |
| `cvv_calendar.json` | Holidays and breaks from CVV's 2026-27 academic calendar |
| `test_flows.py` | 65 checks covering every flow (SQLite and Postgres) |
| `api/index.py`, `vercel.json` | Vercel deployment — see DEPLOY.md |
| `prototype-backup/` | Your original `app.js` / `style.css` before the backend |

## Rules the server enforces

- **Pass type** from CVV's academic calendar + weekends. Semester breaks only count for the semesters they apply to
  (e.g. 6–24 Dec is a break for S3/S5/S7 but S1 still has classes).
- **Approvals:** holiday = parent · working day = parent → class teacher → HOD (in order) · emergency = all three at once.
  Any rejection stops the request. Teachers/HODs only see their own department.
- **10 PM cutoff (day before):** holiday requests close; unanswered ones are rejected and the parent is told.
- **Emergency > 2 h:** warden can approve directly unless someone rejected.
- **Gate:** QR scan on the outing day only; exit then return; still out at 6 PM → alert to warden + parent.
- **Kitchen:** count of students out for tomorrow's lunch, final at 10 PM.

## Student and parent data come only from hostel records

- The admin uploads the hostel/admission CSV: `RegNo, Name, Email, Branch, Semester, ParentName, ParentPhone, ParentLanguage`.
- Students **cannot sign up freely**. They *activate* an existing record with register number + matching college email,
  and only set a password. Name, branch, semester and parent phone come from the record.
- Students can never enter or change the parent number. Only the admin can, and every change is logged
  (`/api/students/<id>/contact-log`). The student list flags a number shared by several students so the office can check
  (siblings are fine, a friend's number isn't).

## Parent-friendly approval (no app, no login)

1. **Reply 1 or 2** to the WhatsApp/SMS message. The easiest option, and it works on any phone. The reply comes from the registered number, so it's verified.
2. **Tap the link** to open a big, simple page in English, Malayalam, Hindi, Kannada, Telugu or Tamil, with a 🔊 *Listen* button
   that reads the request aloud. It has huge ✅ / ❌ buttons. "Yes" asks for a 4-digit SMS code (auto-fills on most phones),
   and "No" asks once more to confirm.
3. **Call the warden** with one tap from the page. The warden records the answer under *Phone Approval*.

The message language is set per parent (CSV or Admin → Students). If a parent switches language on the page, the next message uses it.

## Alerts for each person

| Who | What they get |
|---|---|
| Class teacher / HOD | 🚨 red "Emergency — approve now" (3 sharp beeps) or 📝 "Waiting for your approval — step 2 of 3 / final step" (soft chime). Approve/Reject right in the alert, "Approve all" for routine ones, reject needs a second tap. WhatsApp alert has a link that opens the request. |
| Warden | 🚨 still out after 6 PM / emergency waiting 2 h+ (with *Call parent*), 🌙 parent approved after 10 PM, 📵 parent hasn't replied (with *Remind* / *Take answer by phone*) |
| Parent | Plain-language WhatsApp in their language: request, approved/rejected, left campus, returned, late |
| Student | Who they're waiting for, plus *Send to parent again* |

The bell shows a count coloured by urgency and shakes for emergencies. The browser tab title shows the count.
Desktop notifications pop up when the tab is in the background, after the user allows them once.

## Academic calendar from cvv.ac.in

`cvv_calendar.json` holds the holidays and breaks from
[CVV's ACADEMIC CALENDAR (2026-27) for all UG, PG & PhD programmes](https://www.cvv.ac.in/wp-content/uploads/2026/06/Academic-Calendar-2026-27.pdf).
**Admin → Calendar → Sync from cvv.ac.in** downloads the newest calendar PDF from the
[student corner page](https://www.cvv.ac.in/student-corner/?tab=Academic-Calendar) and reloads it. If the PDF format changes
and too little is found, nothing is overwritten. Holidays the admin adds by hand are kept across syncs.
Two dates are tentative in CVV's calendar (Eid ul-Fitr, Bakrid), so re-sync once they're confirmed.

## Still simulated

WhatsApp, SMS and OTP delivery are written to the `notifications` table instead of being sent. To go live:

- Replace `notify()` in `app.py` with a provider such as the WhatsApp Business API, Gupshup, Twilio or MSG91.
- Point the provider's incoming-message webhook at `/api/inbound`.
- Set these environment variables:
  - `OUTPASS_DEMO=0` hides OTPs and demo parent links.
  - `OUTPASS_INBOUND_SECRET` must match the `X-Inbound-Secret` header the provider sends.
  - `OUTPASS_SECRET` is the session key.
- Have `flask --app app sweep` run every few minutes. Rules also apply on every request, so this only matters when no one is using the app.

## Not opening?

- **Use http://localhost:8000, not 5000.** On a Mac, port 5000 belongs to AirPlay Receiver.
- **Don't double-click `index.html`.** The server has to be running, and the page has to come from it.
- **The terminal window must stay open.** It should say `Running on http://127.0.0.1:8000`.
- **"No module named flask"?** Run `python3 -m pip install -r requirements.txt`.
- **"Address already in use"?** Run `PORT=8050 python3 app.py` and open http://localhost:8050.
- **macOS says start.command "can't be opened"?** Right-click it → Open → Open. Or run `chmod +x start.command` once.

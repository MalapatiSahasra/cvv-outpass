"""
CVV Smart Outpass System — Flask backend
=========================================

Run:
    pip install flask
    python app.py            # http://localhost:5000

The server owns every rule in the outpass workflow, so the browser can no longer
fake an approval by editing localStorage:

  * pass type (holiday / working / emergency) is decided here from the academic calendar
  * approval order: holiday = parent; working day = parent -> class teacher -> HOD;
    emergency = parent + teacher + HOD in parallel
  * any rejection stops the request
  * 10 PM cutoff (day before): parent approval before cutoff auto-generates a holiday pass,
    later approvals go to the warden; holiday requests with no parent reply are rejected at cutoff
  * emergency waiting > 2 h: warden can approve directly unless someone has rejected
  * gate scans: exit then re-entry; return after 6 PM (or still out after 6 PM) alerts warden + parent

OTP, WhatsApp and SMS are still simulated: every message is written to the
`notifications` table (the "outbox") instead of being sent. Swap `notify()` for a
real WhatsApp/SMS provider when ready. With DEMO_MODE on, the OTP is also returned
to the browser so the prototype's on-screen simulation keeps working.
"""

import csv
import hashlib
import io
import json
import os
import re
import urllib.request
import secrets
import base64
import sqlite3
import threading
import zlib
from datetime import date, datetime, timedelta
from functools import wraps
from zoneinfo import ZoneInfo

from flask import Flask, g, jsonify, request, send_from_directory, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Database: Postgres when DATABASE_URL is set (Vercel + Neon), otherwise a local SQLite file.
DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
ON_VERCEL = bool(os.environ.get("VERCEL"))
DB_PATH = os.environ.get("OUTPASS_DB") or (
    "/tmp/outpass.db" if ON_VERCEL else os.path.join(BASE_DIR, "outpass.db"))
USE_PG = bool(DATABASE_URL)
# No-database mode for the online prototype: each browser keeps its own copy of the demo data and
# sends it with every request, so it works on Vercel's throwaway servers without any database.
TUNNEL = os.environ.get("OUTPASS_TUNNEL", "1" if (ON_VERCEL and not USE_PG) else "0") == "1"
SAMPLE_DATA = os.environ.get("OUTPASS_SAMPLE_DATA", "1") == "1"
TZ = ZoneInfo("Asia/Kolkata")
DEMO_MODE = os.environ.get("OUTPASS_DEMO", "1") == "1"
ALLOWED_EMAIL_DOMAINS = ("@cvv.ac.in", "@cvv.edu.in")
CUTOFF_HOUR = 22          # 10 PM, day before the outing
RETURN_DEADLINE_HOUR = 18  # 6 PM, day of the outing
EMERGENCY_OVERRIDE_HOURS = 2
OTP_TTL_SECONDS = 300  # parents get 5 minutes — some type slowly
CALENDAR_FILE = os.path.join(BASE_DIR, "cvv_calendar.json")
CVV_CALENDAR_PAGE = "https://www.cvv.ac.in/student-corner/?tab=Academic-Calendar"
INBOUND_SECRET = os.environ.get("OUTPASS_INBOUND_SECRET")  # set in production for the SMS/WhatsApp webhook

app = Flask(__name__, static_folder=None)
# Sessions must survive across serverless instances, so the key can't be random per process online.
# Set OUTPASS_SECRET in production; otherwise derive one from the (secret) database URL.
app.secret_key = (os.environ.get("OUTPASS_SECRET")
                  or (hashlib.sha256(("cvv-outpass:" + DATABASE_URL).encode()).hexdigest() if DATABASE_URL else None)
                  or secrets.token_hex(32))
app.config.update(SESSION_COOKIE_SAMESITE="Lax", SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SECURE=ON_VERCEL)


# ═══════════════════════════════════════════════════════════════════
# Database
# ═══════════════════════════════════════════════════════════════════
SCHEMA = """
CREATE TABLE IF NOT EXISTS students (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    reg_no        TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    semester      INTEGER,
    branch        TEXT,
    parent_name   TEXT,
    parent_phone  TEXT,
    parent_lang   TEXT DEFAULT 'en',
    activated     INTEGER NOT NULL DEFAULT 0   -- records come from the hostel office; the student only sets a password
);
CREATE TABLE IF NOT EXISTS parent_contact_log (
    id         {SERIAL},
    student_id TEXT NOT NULL,
    old_phone  TEXT,
    new_phone  TEXT,
    changed_by TEXT NOT NULL,
    at         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS staff (
    id               TEXT PRIMARY KEY,
    email            TEXT UNIQUE NOT NULL,
    name             TEXT NOT NULL,
    password_hash    TEXT NOT NULL,
    role             TEXT NOT NULL CHECK (role IN ('teacher','hod','warden','guard','kitchen','admin')),
    department       TEXT,
    is_class_teacher INTEGER DEFAULT 0,
    class_section    TEXT
);
CREATE TABLE IF NOT EXISTS holidays (
    date      TEXT PRIMARY KEY,
    name      TEXT,
    kind      TEXT DEFAULT 'holiday',   -- holiday | break
    semesters TEXT,                     -- NULL = everyone, else "3,5,7"
    source    TEXT DEFAULT 'admin'      -- cvv.ac.in | admin
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS outpasses (
    pass_id        TEXT PRIMARY KEY,
    student_id     TEXT NOT NULL REFERENCES students(id),
    out_date       TEXT NOT NULL,
    reason         TEXT NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('holiday','working','emergency')),
    status         TEXT NOT NULL DEFAULT 'pending',
    reject_reason  TEXT,
    created_at     TEXT NOT NULL,
    parent_status  TEXT NOT NULL DEFAULT 'pending',
    parent_time    TEXT,
    parent_method  TEXT,
    teacher_status TEXT NOT NULL DEFAULT 'na',
    teacher_time   TEXT,
    teacher_by     TEXT,
    hod_status     TEXT NOT NULL DEFAULT 'na',
    hod_time       TEXT,
    hod_by         TEXT,
    warden_status  TEXT NOT NULL DEFAULT 'na',
    warden_time    TEXT,
    warden_by      TEXT,
    exit_at        TEXT,
    return_at      TEXT,
    late_return    INTEGER NOT NULL DEFAULT 0,
    late_alerted   INTEGER NOT NULL DEFAULT 0,
    late_ack       INTEGER NOT NULL DEFAULT 0,
    qr_token       TEXT UNIQUE NOT NULL,
    parent_token   TEXT UNIQUE,
    otp_hash       TEXT,
    otp_expires    TEXT
);
CREATE INDEX IF NOT EXISTS idx_outpass_student ON outpasses(student_id);
CREATE INDEX IF NOT EXISTS idx_outpass_date ON outpasses(out_date);
CREATE TABLE IF NOT EXISTS gate_scans (
    id       {SERIAL},
    pass_id  TEXT NOT NULL REFERENCES outpasses(pass_id),
    kind     TEXT NOT NULL CHECK (kind IN ('exit','return')),
    at       TEXT NOT NULL,
    guard_id TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
    id         {SERIAL},
    created_at TEXT NOT NULL,
    channel    TEXT NOT NULL,
    recipient  TEXT NOT NULL,
    message    TEXT NOT NULL,
    pass_id    TEXT
);
"""

DEMO_CONTACT_EMAIL = "malapatisahasra162@gmail.com"
DEMO_CONTACT_PHONE = "+91 76595 27002"

SEED_STUDENTS = [
    ("STU001", "rahul@cvv.edu.in", "Rahul Sharma", "CVV2024001", 5, "CSE", "Mr. Anil Sharma", "+91 98765 43210"),
    ("STU002", "priya@cvv.edu.in", "Priya Reddy", "CVV2024002", 3, "ECE", "Mrs. Lakshmi Reddy", "+91 91234 56789"),
    ("STU003", "arjun@cvv.edu.in", "Arjun Nair", "CVV2024003", 7, "ME", "Mr. Vijay Nair", "+91 87654 32100"),
    ("STU004", "sneha@cvv.edu.in", "Sneha Patel", "CVV2024004", 5, "CSE", "Mrs. Kavita Patel", "+91 99887 65432"),
    ("STU005", "amit@cvv.edu.in", "Amit Kumar", "CVV2024005", 3, "ECE", "Mr. Rajesh Kumar", "+91 90909 09090"),
]
# Extra sample students for the online demo (switched off in the tests with OUTPASS_SAMPLE_DATA=0).
SAMPLE_STUDENTS = [
    ("STU006", DEMO_CONTACT_EMAIL, "Malapati Sahasra", "CVV2024106", 5, "CSE", "Mr. Malapati Srinivas", DEMO_CONTACT_PHONE),
    ("STU007", "aditya.menon@cvv.edu.in", "Aditya Menon", "CVV2024107", 5, "CSE", "Mr. Suresh Menon", "+91 94470 11223"),
    ("STU008", "kavya.nair@cvv.edu.in", "Kavya Nair", "CVV2024108", 5, "CSE", "Mrs. Deepa Nair", "+91 98950 33445"),
    ("STU009", "rohit.verma@cvv.edu.in", "Rohit Verma", "CVV2024109", 3, "CSE", "Mr. Ajay Verma", "+91 98110 55667"),
    ("STU010", "ananya.iyer@cvv.edu.in", "Ananya Iyer", "CVV2024110", 7, "CSE", "Mrs. Lakshmi Iyer", "+91 94440 77889"),
    ("STU011", "farhan.ali@cvv.edu.in", "Farhan Ali", "CVV2024111", 3, "ECE", "Mr. Imran Ali", "+91 97450 99001"),
    ("STU012", "divya.krishnan@cvv.edu.in", "Divya Krishnan", "CVV2024112", 5, "ECE", "Mr. Gopal Krishnan", "+91 94960 22334"),
    ("STU013", "sai.teja@cvv.edu.in", "Sai Teja Reddy", "CVV2024113", 5, "CSE", "Mr. Venkat Reddy", "+91 99490 44556"),
]

SEED_STAFF = [
    ("TCH001", "teacher@cvv.edu.in", "Dr. Meena Iyer", "teacher", "CSE", 1, "CSE-5"),
    ("TCH002", "ece.teacher@cvv.edu.in", "Prof. Suresh Rao", "teacher", "ECE", 1, "ECE-3"),
    ("HOD001", "hod@cvv.edu.in", "Dr. Ramesh Gupta", "hod", "CSE", 0, None),
    ("HOD002", "ece.hod@cvv.edu.in", "Dr. Anita Desai", "hod", "ECE", 0, None),
    ("WAR001", "warden@cvv.edu.in", "Mr. Krishnan", "warden", None, 0, None),
    ("GRD001", "guard@cvv.edu.in", "Security - Gate 1", "guard", None, 0, None),
    ("KIT001", "kitchen@cvv.edu.in", "Annakshetra Staff", "kitchen", None, 0, None),
    ("ADM001", "admin@cvv.edu.in", "Admin Office", "admin", None, 0, None),
]
DEMO_PASSWORD = "pass123"


class PgRow(dict):
    """Row usable as row["col"] and row[0], like sqlite3.Row."""
    def __init__(self, cols, vals):
        super().__init__(zip(cols, vals))
        self._vals = vals

    def __getitem__(self, k):
        return self._vals[k] if isinstance(k, int) else dict.__getitem__(self, k)


class PgDB:
    """Thin wrapper so the same SQL (with ? placeholders) runs on Postgres."""
    def __init__(self, url):
        import psycopg  # pip install "psycopg[binary]"

        def factory(cur):
            cols = [c.name for c in cur.description] if cur.description else []
            return lambda vals: PgRow(cols, vals)
        self.conn = psycopg.connect(url, row_factory=factory)

    @staticmethod
    def _sql(q):
        return q.replace("?", "%s")

    def execute(self, q, params=()):
        return self.conn.execute(self._sql(q), params)

    def executemany(self, q, seq):
        with self.conn.cursor() as cur:
            cur.executemany(self._sql(q), seq)

    def executescript(self, script):
        script = re.sub(r"--[^\n]*", "", script)  # drop comments (they may contain ';')
        for stmt in script.split(";"):
            if stmt.strip():
                self.conn.execute(stmt)

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()

    def close(self):
        self.conn.close()


_tunnel = threading.local()


class _SharedConn:
    """The tunnel's in-memory database, used by the inner request; the tunnel closes it."""
    def __init__(self, conn):
        self._conn = conn

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def close(self):
        pass


def connect():
    if getattr(_tunnel, "conn", None) is not None:
        return _SharedConn(_tunnel.conn)
    if USE_PG:

        return PgDB(DATABASE_URL)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def get_db():
    if "db" not in g:
        g.db = connect()
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def seed(db, wipe=False):
    if wipe:
        for t in ("parent_contact_log", "notifications", "gate_scans", "outpasses", "students", "staff", "holidays", "settings"):
            db.execute(f"DELETE FROM {t}")
    pw = generate_password_hash(DEMO_PASSWORD)
    db.executemany(
        "INSERT INTO students (id,email,name,reg_no,password_hash,semester,branch,parent_name,parent_phone,activated) "
        "VALUES (?,?,?,?,?,?,?,?,?,1)",
        [(s[0], s[1], s[2], s[3], pw, s[4], s[5], s[6], s[7]) for s in SEED_STUDENTS])
    db.executemany(
        "INSERT INTO staff (id,email,name,password_hash,role,department,is_class_teacher,class_section) "
        "VALUES (?,?,?,?,?,?,?,?)",
        [(s[0], s[1], s[2], pw, s[3], s[4], s[5], s[6]) for s in SEED_STAFF])
    load_calendar_entries(db, json.load(open(CALENDAR_FILE, encoding="utf-8")), "cvv.ac.in")
    db.executemany("INSERT INTO settings (key,value) VALUES (?,?)",
                   [("total_students", "500"), ("next_pass_id", "1"),
                    ("warden_phone", DEMO_CONTACT_PHONE if SAMPLE_DATA else "+91 98470 00000"),
                    ("calendar_synced_at", iso(now()))])
    if SAMPLE_DATA:
        seed_samples(db, pw)
    db.commit()


def seed_samples(db, pw):
    """A lived-in demo: more students, and passes in every state dated around today."""
    db.executemany(
        "INSERT INTO students (id,email,name,reg_no,password_hash,semester,branch,parent_name,parent_phone,activated) "
        "VALUES (?,?,?,?,?,?,?,?,?,1)",
        [(s[0], s[1], s[2], s[3], pw, s[4], s[5], s[6], s[7]) for s in SAMPLE_STUDENTS])
    t = now()
    today, tom = t.date(), t.date() + timedelta(days=1)
    sat = today + timedelta(days=((5 - today.weekday()) % 7) or 7)
    ago = lambda h: iso(t - timedelta(hours=h))
    at = lambda d, h, m=0: iso(datetime(d.year, d.month, d.day, h, m, tzinfo=TZ))
    weekday = today.weekday() < 5
    A, P, N, R = "approved", "pending", "na", "rejected"
    # student, date, reason, type, status, parent, teacher, hod, created (hours ago), exit, return, late
    rows = [
        ("STU006", sat, "Visiting family in Ernakulam", "holiday", P, P, N, N, 1, None, None, 0),
        ("STU007", tom, "Dental appointment at the city hospital", "working", P, A, P, P, 3, None, None, 0),
        ("STU008", tom, "Sister's engagement ceremony", "working", P, A, A, P, 5, None, None, 0),
        ("STU009", today, "Father admitted to hospital", "emergency", P, A, P, P, 3, None, None, 0),
        ("STU010", sat, "Weekend at home", "holiday", A, A, N, N, 20, None, None, 0),
        ("STU013", sat, "Cousin's wedding in Thrissur", "holiday", A, A, N, N, 26, None, None, 0),
        ("STU011", today, "Passport verification at the PSK", "working" if weekday else "holiday", "active",
         A, A if weekday else N, A if weekday else N, 30, at(today, 9, 10), None, 0),
        ("STU012", today, "Bank KYC and shopping", "working" if weekday else "holiday", "completed",
         A, A if weekday else N, A if weekday else N, 28, at(today, 8, 30), at(today, 12, 45), 0),
        ("STU001", today - timedelta(days=2), "Dinner with family", "holiday", "completed", A, N, N, 70,
         at(today - timedelta(days=2), 10, 0), at(today - timedelta(days=2), 18, 40), 1),
        ("STU004", today - timedelta(days=3), "Personal work", "working", R, A, R, N, 90, None, None, 0),
    ]
    for i, (sid, d, reason, ptype, status, ps, ts, hs, hago, ex, rt, late) in enumerate(rows, 1):
        db.execute(
            "INSERT INTO outpasses (pass_id,student_id,out_date,reason,type,status,reject_reason,created_at,"
            "parent_status,parent_time,parent_method,teacher_status,teacher_time,hod_status,hod_time,"
            "exit_at,return_at,late_return,late_alerted,qr_token,parent_token) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (f"CVV-{i:05d}", sid, d.isoformat(), reason, ptype, status,
             "Rejected by teacher" if status == R else None, ago(hago),
             ps, ago(hago - 0.5) if ps == A else None, "reply" if ps == A else None,
             ts, ago(hago - 1) if ts in (A, R) else None,
             hs, ago(hago - 1.5) if hs == A else None,
             ex, rt, late, late, "TKN-" + secrets.token_hex(6).upper(), secrets.token_urlsafe(16)))
    db.execute("UPDATE settings SET value=? WHERE key='next_pass_id'", (str(len(rows) + 1),))



def expand(entry):
    d = date.fromisoformat(entry["date"])
    end = date.fromisoformat(entry.get("to") or entry["date"])
    while d <= end:
        yield d.isoformat()
        d += timedelta(days=1)


def load_calendar_entries(db, cal, source):
    """Replace calendar-sourced days with `cal` (dict with holidays/breaks). Admin-added days are kept."""
    db.execute("DELETE FROM holidays WHERE source=?", (source,))
    n = 0
    for kind in ("holidays", "breaks"):
        for e in cal.get(kind, []):
            sems = ",".join(str(x) for x in e["semesters"]) if e.get("semesters") else None
            for day in expand(e):
                db.execute("INSERT INTO holidays (date,name,kind,semesters,source) VALUES (?,?,?,?,?) "
                           "ON CONFLICT(date) DO UPDATE SET name=excluded.name, kind=excluded.kind, "
                           "semesters=excluded.semesters, source=excluded.source",
                           (day, e["name"], kind[:-1] if kind == "breaks" else "holiday", sems, source))
                n += 1
    return n


def migrate(db):
    """Add columns introduced after the first version, so an older outpass.db keeps working."""
    def cols(t):
        if USE_PG:
            return {r[0] for r in db.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name=?", (t,))}
        return {r[1] for r in db.execute(f"PRAGMA table_info({t})")}
    for t, c, ddl in [("holidays", "name", "TEXT"), ("holidays", "kind", "TEXT DEFAULT 'holiday'"),
                      ("holidays", "semesters", "TEXT"), ("holidays", "source", "TEXT DEFAULT 'admin'"),
                      ("students", "parent_lang", "TEXT DEFAULT 'en'"), ("outpasses", "parent_token", "TEXT"),
                      ("outpasses", "late_ack", "INTEGER NOT NULL DEFAULT 0"),
                      ("students", "activated", "INTEGER NOT NULL DEFAULT 1")]:
        if c not in cols(t):
            db.execute(f"ALTER TABLE {t} ADD COLUMN {c} {ddl}")
    db.commit()


def init_db():
    with app.app_context():
        db = get_db()
        db.executescript(SCHEMA.replace("{SERIAL}", "SERIAL PRIMARY KEY" if USE_PG
                                        else "INTEGER PRIMARY KEY AUTOINCREMENT"))
        db.commit()
        migrate(db)
        if db.execute("SELECT COUNT(*) FROM staff").fetchone()[0] == 0:
            try:
                seed(db)
            except Exception:  # another serverless instance seeded at the same moment
                db.rollback()


def setting(key, default=None):
    row = get_db().execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key, value):
    get_db().execute("INSERT INTO settings (key,value) VALUES (?,?) "
                     "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))


# ═══════════════════════════════════════════════════════════════════
# Time + rule helpers
# ═══════════════════════════════════════════════════════════════════
def now():
    return datetime.now(TZ)


def iso(dt):
    return dt.isoformat(timespec="seconds") if dt else None


def parse_iso(s):
    return datetime.fromisoformat(s) if s else None


def display_time(s):
    """'05:42 pm' style, matching the frontend's formatTime()."""
    dt = parse_iso(s)
    return dt.astimezone(TZ).strftime("%I:%M %p").lower() if dt else None


def cutoff_for(out_date_str):
    d = date.fromisoformat(out_date_str) - timedelta(days=1)
    return datetime(d.year, d.month, d.day, CUTOFF_HOUR, tzinfo=TZ)


def return_deadline_for(out_date_str):
    d = date.fromisoformat(out_date_str)
    return datetime(d.year, d.month, d.day, RETURN_DEADLINE_HOUR, tzinfo=TZ)


def holiday_applies(row, semester):
    return not row["semesters"] or str(semester) in row["semesters"].split(",")


def detect_type(out_date_str, emergency, semester=None):
    if emergency:
        return "emergency"
    d = date.fromisoformat(out_date_str)
    row = get_db().execute("SELECT * FROM holidays WHERE date=?", (out_date_str,)).fetchone()
    is_holiday = row is not None and holiday_applies(row, semester)
    if is_holiday or d.weekday() >= 5:  # Sat/Sun
        return "holiday"
    return "working"


def notify(channel, recipient, message, pass_id=None):
    """Simulated WhatsApp/SMS. Replace with a real provider call later."""
    get_db().execute(
        "INSERT INTO notifications (created_at, channel, recipient, message, pass_id) VALUES (?,?,?,?,?)",
        (iso(now()), channel, recipient, message, pass_id))


def notify_staff(role, dept, headline, body, pass_id):
    """Staff alerts read differently from parent messages: a headline that says what to do,
    the facts on separate lines, and a link that opens the request with Approve / Reject."""
    link = f"/#pass={pass_id}"
    notify("whatsapp", f"{role}:{dept}" if dept else role, f"{headline}\n{body}\nOpen: {link}", pass_id)


def student_of(p):
    return get_db().execute("SELECT * FROM students WHERE id=?", (p["student_id"],)).fetchone()


def finalize_if_complete(pass_id):
    """Recompute overall status after any approval. Central place so no path can leave a pass stuck."""
    db = get_db()
    p = db.execute("SELECT * FROM outpasses WHERE pass_id=?", (pass_id,)).fetchone()
    if p["status"] != "pending":
        return p
    stu = student_of(p)
    statuses = [p["parent_status"], p["teacher_status"], p["hod_status"], p["warden_status"]]
    if "rejected" in statuses:
        db.execute("UPDATE outpasses SET status='rejected' WHERE pass_id=?", (pass_id,))
    elif p["warden_status"] == "approved":
        db.execute("UPDATE outpasses SET status='approved' WHERE pass_id=?", (pass_id,))
    elif p["type"] == "holiday":
        if p["parent_status"] == "approved" and p["warden_status"] == "na":
            if parse_iso(p["parent_time"]) < cutoff_for(p["out_date"]):
                db.execute("UPDATE outpasses SET status='approved' WHERE pass_id=?", (pass_id,))
            else:
                db.execute("UPDATE outpasses SET warden_status='pending' WHERE pass_id=?", (pass_id,))
                notify("whatsapp", "warden", f"{stu['name']} ({pass_id}): parent approved after the 10 PM cutoff. "
                                              "Your decision is needed.", pass_id)
    else:  # working / emergency need all three
        if p["parent_status"] == p["teacher_status"] == p["hod_status"] == "approved":
            db.execute("UPDATE outpasses SET status='approved' WHERE pass_id=?", (pass_id,))
    p = db.execute("SELECT * FROM outpasses WHERE pass_id=?", (pass_id,)).fetchone()
    if p["status"] == "approved":
        notify("whatsapp", stu["parent_phone"],
               f"Outpass {pass_id} for {stu['name']} on {p['out_date']} is APPROVED.", pass_id)
    elif p["status"] == "rejected":
        notify("whatsapp", stu["parent_phone"],
               f"Outpass {pass_id} for {stu['name']} on {p['out_date']} was rejected.", pass_id)
    return p


def sweep():
    """Time-based rules. Runs before every API request (cheap at hostel scale), and via `flask sweep`."""
    db = get_db()
    t = now()
    # 1. Holiday requests with no parent reply by the 10 PM cutoff are rejected.
    for p in db.execute("SELECT * FROM outpasses WHERE status='pending' AND type='holiday' "
                        "AND parent_status='pending'").fetchall():
        if t >= cutoff_for(p["out_date"]):
            db.execute("UPDATE outpasses SET status='rejected', parent_status='expired', "
                       "reject_reason='No parent reply before 10 PM cutoff' WHERE pass_id=?", (p["pass_id"],))
            stu = student_of(p)
            notify("whatsapp", stu["parent_phone"],
                   f"Outpass {p['pass_id']} for {stu['name']} expired: no reply before the 10 PM cutoff.",
                   p["pass_id"])
    # 2. Still out after 6 PM on the outing day -> late alert (once).
    for p in db.execute("SELECT * FROM outpasses WHERE status='active' AND late_alerted=0").fetchall():
        if t >= return_deadline_for(p["out_date"]):
            stu = student_of(p)
            db.execute("UPDATE outpasses SET late_return=1, late_alerted=1 WHERE pass_id=?", (p["pass_id"],))
            msg = f"ALERT: {stu['name']} ({stu['reg_no']}) has not returned by 6 PM. Pass {p['pass_id']}."
            notify("whatsapp", "warden", msg, p["pass_id"])
            notify("whatsapp", stu["parent_phone"], msg, p["pass_id"])
    db.commit()


# ═══════════════════════════════════════════════════════════════════
# Serialisation — same shape the prototype's APP.db used
# ═══════════════════════════════════════════════════════════════════
def student_json(s):
    return {"id": s["id"], "email": s["email"], "name": s["name"], "regNo": s["reg_no"],
            "semester": s["semester"], "branch": s["branch"],
            "parentName": s["parent_name"], "parentPhone": s["parent_phone"],
            "parentLang": s["parent_lang"] or "en", "activated": bool(s["activated"])}


def staff_json(s):
    return {"id": s["id"], "email": s["email"], "name": s["name"], "role": s["role"],
            "department": s["department"], "isClassTeacher": bool(s["is_class_teacher"]),
            "classSection": s["class_section"]}


def pass_json(p):
    approvals = {
        "parent": p["parent_status"], "teacher": p["teacher_status"],
        "hod": p["hod_status"], "warden": p["warden_status"],
    }
    for role in ("parent", "teacher", "hod", "warden"):
        if p[f"{role}_time"]:
            approvals[f"{role}Time"] = p[f"{role}_time"]
    if p["parent_method"]:
        approvals["parentMethod"] = p["parent_method"]
    return {
        "passId": p["pass_id"], "studentId": p["student_id"], "outDate": p["out_date"],
        "reason": p["reason"], "type": p["type"], "status": p["status"],
        "rejectReason": p["reject_reason"], "createdAt": p["created_at"], "approvals": approvals,
        "exitTime": display_time(p["exit_at"]), "returnTime": display_time(p["return_at"]),
        "exitAt": p["exit_at"], "returnAt": p["return_at"],
        "lateReturn": bool(p["late_return"]), "qrToken": p["qr_token"],
        # Demo only: lets the prototype open the parent's page. Never expose this in production.
        "parentLink": f"/p/{p['parent_token']}" if DEMO_MODE and p["parent_token"] else None,
    }


# ═══════════════════════════════════════════════════════════════════
# Auth
# ═══════════════════════════════════════════════════════════════════
def current_user():
    uid, role = session.get("uid"), session.get("role")
    if not uid:
        return None, None
    db = get_db()
    if role == "student":
        row = db.execute("SELECT * FROM students WHERE id=?", (uid,)).fetchone()
        return (student_json(row) if row else None), role
    row = db.execute("SELECT * FROM staff WHERE id=?", (uid,)).fetchone()
    return (staff_json(row) if row else None), role


def require(*roles):
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            user, role = current_user()
            if not user:
                return err("Please sign in", 401)
            if roles and role not in roles:
                return err("You don't have permission for this action", 403)
            g.user, g.role = user, role
            return fn(*a, **kw)
        return wrapper
    return deco


def err(msg, code=400):
    return jsonify({"ok": False, "error": msg}), code


def ok(**kw):
    return jsonify({"ok": True, **kw})


@app.before_request
def _sweep():
    if request.path.startswith("/api/") and request.path != "/api/__tunnel":
        sweep()


@app.post("/api/login")
def login():
    d = request.get_json(force=True)
    email = (d.get("email") or "").strip().lower()
    password = d.get("password") or ""
    role = d.get("role") or "student"
    db = get_db()
    if role == "student":
        # Students can sign in with their college email or their register number.
        row = db.execute("SELECT * FROM students WHERE email=? OR lower(reg_no)=?", (email, email)).fetchone()
    else:
        row = db.execute("SELECT * FROM staff WHERE email=? AND role=?", (email, role)).fetchone()
    if row and role == "student" and not row["activated"]:
        return err("Your account isn't activated yet. Tap 'Activate your account' below.", 401)
    if not row:
        return err("Account not found. Check your register number / email, or the Student/Staff tab.", 401)
    if not check_password_hash(row["password_hash"], password):
        return err("Incorrect password. Demo password: pass123", 401)
    session.clear()
    session["uid"], session["role"] = row["id"], role
    user = student_json(row) if role == "student" else staff_json(row)
    return ok(user=user, role=role)


@app.post("/api/logout")
def logout():
    session.clear()
    return ok()


@app.get("/api/me")
def me():
    user, role = current_user()
    return ok(user=user, role=role)


@app.post("/api/register")
def register():
    """Activate an account that the hostel office already created from its records.
    Name, branch, semester and — above all — the parent's phone come from those records,
    so a student can't sign up with a friend's number as 'parent'."""
    d = request.get_json(force=True)
    email = (d.get("email") or "").strip().lower()
    reg_no = (d.get("regNo") or "").strip()
    password = d.get("password") or ""
    if len(password) < 6:
        return err("Choose a password of at least 6 characters")
    db = get_db()
    row = db.execute("SELECT * FROM students WHERE lower(reg_no)=lower(?)", (reg_no,)).fetchone()
    if not row:
        return err("This register number isn't in the hostel records. Please contact the hostel office.")
    if row["email"].lower() != email:
        return err("This email doesn't match the hostel records for that register number.")
    if row["activated"]:
        return err("This account is already active. Sign in, or ask the hostel office to reset your password.")
    db.execute("UPDATE students SET password_hash=?, activated=1 WHERE id=?", (generate_password_hash(password), row["id"]))
    db.commit()
    phone = re.sub(r"\d(?=(?:\D*\d){3})", "•", row["parent_phone"] or "")
    return ok(name=row["name"], parentName=row["parent_name"], parentPhone=phone)


def next_student_id(db):
    n = db.execute("SELECT COUNT(*) FROM students").fetchone()[0] + 1
    while db.execute("SELECT 1 FROM students WHERE id=?", (f"STU{n:03d}",)).fetchone():
        n += 1
    return f"STU{n:03d}"


# ═══════════════════════════════════════════════════════════════════
# State (what the frontend renders from)
# ═══════════════════════════════════════════════════════════════════
@app.get("/api/state")
@require()
def state():
    db = get_db()
    if g.role == "student":
        students = [g.user]
        passes = db.execute("SELECT * FROM outpasses WHERE student_id=? ORDER BY created_at",
                            (g.user["id"],)).fetchall()
        staff = []
    else:
        students = [student_json(s) for s in db.execute("SELECT * FROM students ORDER BY id")]
        passes = db.execute("SELECT * FROM outpasses ORDER BY created_at").fetchall()
        staff = [staff_json(s) for s in db.execute("SELECT * FROM staff ORDER BY id")]
    return ok(state={
        "students": students,
        "staff": staff,
        "outpasses": [pass_json(p) for p in passes],
        "holidays": [r["date"] for r in db.execute("SELECT * FROM holidays ORDER BY date")
                     if g.role != "student" or holiday_applies(r, g.user["semester"])],
        "holidayInfo": [dict(r) for r in db.execute("SELECT * FROM holidays ORDER BY date")],
        "calendar": {"source": CVV_CALENDAR_PAGE, "syncedAt": setting("calendar_synced_at")},
        "totalStudents": int(setting("total_students", 500)),
        "serverTime": iso(now()),
    })


# ═══════════════════════════════════════════════════════════════════
# Outpass workflow
# ═══════════════════════════════════════════════════════════════════
def get_pass(pass_id):
    return get_db().execute("SELECT * FROM outpasses WHERE pass_id=?", (pass_id,)).fetchone()


@app.post("/api/outpasses")
@require("student")
def create_pass():
    d = request.get_json(force=True)
    out_date, reason = (d.get("outDate") or "").strip(), (d.get("reason") or "").strip()
    emergency = bool(d.get("emergency"))
    if not out_date or not reason:
        return err("Please fill in all fields")
    try:
        od = date.fromisoformat(out_date)
    except ValueError:
        return err("Invalid date")
    if od < now().date():
        return err("The outing date can't be in the past")
    ptype = detect_type(out_date, emergency, g.user["semester"])
    if ptype == "holiday" and now() >= cutoff_for(out_date):
        return err("The deadline for this date was 10 PM the day before. Apply as an emergency if it's urgent.")
    db = get_db()
    dup = db.execute("SELECT pass_id FROM outpasses WHERE student_id=? AND out_date=? "
                     "AND status IN ('pending','approved','active')", (g.user["id"], out_date)).fetchone()
    if dup:
        return err(f"You already have outpass {dup['pass_id']} for this date")
    n = int(setting("next_pass_id", 1))
    set_setting("next_pass_id", n + 1)
    pass_id = f"CVV-{n:05d}"
    staff_status = "na" if ptype == "holiday" else "pending"
    db.execute("INSERT INTO outpasses (pass_id,student_id,out_date,reason,type,created_at,"
               "teacher_status,hod_status,qr_token,parent_token) VALUES (?,?,?,?,?,?,?,?,?,?)",
               (pass_id, g.user["id"], out_date, reason, ptype, iso(now()), staff_status, staff_status,
                "TKN-" + secrets.token_hex(6).upper(), secrets.token_urlsafe(16)))
    send_parent_request(get_pass(pass_id))
    if ptype == "emergency":
        for r in ("teacher", "hod"):
            notify_staff(r, g.user["branch"], "🚨 EMERGENCY — approve now",
                         f"{g.user['name']} ({g.user['regNo']}) · {out_date}\n{reason}", pass_id)
    db.commit()
    return ok(outpass=pass_json(get_pass(pass_id)))


# ═══════════════════════════════════════════════════════════════════
# Parent — no app, no login. Three ways to answer, easiest first:
#   1. Reply "1" (allow) or "2" (don't allow) to the WhatsApp/SMS message
#   2. Tap the link -> big Yes/No buttons in their language -> 4-digit SMS code
#   3. Call the warden, who records a phone approval
# ═══════════════════════════════════════════════════════════════════
PARENT_MSG = {
    "en": "CVV Hostel: {name} wants to go out on {date}.\nReason: {reason}\n\nReply 1 to ALLOW\nReply 2 to NOT ALLOW\n\nOr tap: {link}",
    "ml": "CVV ഹോസ്റ്റൽ: {name} {date}-ന് പുറത്തുപോകാൻ അനുവാദം ചോദിക്കുന്നു.\nകാരണം: {reason}\n\nഅനുവദിക്കാൻ 1 അയയ്ക്കുക\nഅനുവദിക്കാതിരിക്കാൻ 2 അയയ്ക്കുക\n\nഅല്ലെങ്കിൽ ഇവിടെ തൊടുക: {link}",
    "hi": "CVV हॉस्टल: {name} {date} को बाहर जाना चाहता/चाहती है।\nकारण: {reason}\n\nअनुमति देने के लिए 1 भेजें\nमना करने के लिए 2 भेजें\n\nया यहाँ दबाएँ: {link}",
    "kn": "CVV ಹಾಸ್ಟೆಲ್: {name} {date} ರಂದು ಹೊರಗೆ ಹೋಗಲು ಅನುಮತಿ ಕೇಳುತ್ತಿದ್ದಾರೆ.\nಕಾರಣ: {reason}\n\nಅನುಮತಿಸಲು 1 ಕಳುಹಿಸಿ\nನಿರಾಕರಿಸಲು 2 ಕಳುಹಿಸಿ\n\nಅಥವಾ ಇಲ್ಲಿ ಒತ್ತಿ: {link}",
    "te": "CVV హాస్టల్: {name} {date} న బయటికి వెళ్లడానికి అనుమతి అడుగుతున్నారు.\nకారణం: {reason}\n\nఅనుమతించడానికి 1 పంపండి\nవద్దనడానికి 2 పంపండి\n\nలేదా ఇక్కడ నొక్కండి: {link}",
    "ta": "CVV விடுதி: {name} {date} அன்று வெளியே செல்ல அனுமதி கேட்கிறார்.\nகாரணம்: {reason}\n\nஅனுமதிக்க 1 அனுப்பவும்\nமறுக்க 2 அனுப்பவும்\n\nஅல்லது இங்கே தொடவும்: {link}",
}
YES_WORDS = {"1", "yes", "y", "ok", "allow", "haan", "ha", "han", "sari", "shari", "athe", "aam", "avunu", "houdu"}
NO_WORDS = {"2", "no", "n", "nahi", "nahin", "venda", "illa", "vaddu", "beda", "kooda"}


def parent_link(p):
    try:
        return url_for("parent_page", token=p["parent_token"], _external=True)
    except RuntimeError:
        return f"/p/{p['parent_token']}"


def send_parent_request(p):
    stu = student_of(p)
    lang = stu["parent_lang"] if stu["parent_lang"] in PARENT_MSG else "en"
    d = date.fromisoformat(p["out_date"]).strftime("%a %d %b")
    notify("whatsapp", stu["parent_phone"],
           PARENT_MSG[lang].format(name=stu["name"], date=d, reason=p["reason"], link=parent_link(p)), p["pass_id"])


def record_parent_decision(p, action, method):
    db = get_db()
    status = "approved" if action == "approve" else "rejected"
    db.execute("UPDATE outpasses SET parent_status=?, parent_time=?, parent_method=?, otp_hash=NULL "
               "WHERE pass_id=?", (status, iso(now()), method, p["pass_id"]))
    if status == "rejected":
        db.execute("UPDATE outpasses SET reject_reason='Rejected by parent' WHERE pass_id=?", (p["pass_id"],))
    elif p["type"] == "working":
        stu = student_of(p)
        notify_staff("teacher", stu["branch"], "📝 Step 2 of 3 — your approval",
                     f"{stu['name']} ({stu['reg_no']}) · {p['out_date']}\nParent approved ✓\n{p['reason']}", p["pass_id"])
    p = finalize_if_complete(p["pass_id"])
    db.commit()
    return p


def parent_view(p):
    stu = student_of(p)
    return {
        "student": stu["name"], "regNo": stu["reg_no"], "parentName": stu["parent_name"],
        "lang": stu["parent_lang"] or "en", "date": p["out_date"], "reason": p["reason"], "type": p["type"],
        "status": p["status"], "parentStatus": p["parent_status"], "rejectReason": p["reject_reason"],
        "wardenPhone": setting("warden_phone", ""), "passId": p["pass_id"],
        "exitTime": display_time(p["exit_at"]), "returnTime": display_time(p["return_at"]),
    }


def pass_by_parent_token(token):
    return get_db().execute("SELECT * FROM outpasses WHERE parent_token=?", (token,)).fetchone()


@app.get("/p/<token>")
def parent_page(token):
    return html_page("parent.html")


@app.get("/api/p/<token>")
def parent_get(token):
    p = pass_by_parent_token(token)
    return ok(request=parent_view(p)) if p else err("This link is not valid", 404)


@app.post("/api/p/<token>/lang")
def parent_set_lang(token):
    p = pass_by_parent_token(token)
    lang = request.get_json(force=True).get("lang")
    if not p or lang not in PARENT_MSG:
        return err("Invalid")
    get_db().execute("UPDATE students SET parent_lang=? WHERE id=?", (lang, p["student_id"]))
    get_db().commit()
    return ok()


@app.post("/api/p/<token>/otp")
def parent_otp(token):
    p = pass_by_parent_token(token)
    if not p:
        return err("This link is not valid", 404)
    if p["status"] != "pending" or p["parent_status"] != "pending":
        return err("Already answered")
    otp = f"{secrets.randbelow(9000) + 1000}"
    db = get_db()
    db.execute("UPDATE outpasses SET otp_hash=?, otp_expires=? WHERE pass_id=?",
               (generate_password_hash(otp), iso(now() + timedelta(seconds=OTP_TTL_SECONDS)), p["pass_id"]))
    notify("sms", student_of(p)["parent_phone"], f"CVV outpass code: {otp}", p["pass_id"])
    db.commit()
    return ok(otp=otp if DEMO_MODE else None)


@app.post("/api/p/<token>/decision")
def parent_decide(token):
    d = request.get_json(force=True)
    action = d.get("action")
    p = pass_by_parent_token(token)
    if not p:
        return err("This link is not valid", 404)
    if p["status"] != "pending" or p["parent_status"] != "pending":
        return err("Already answered")
    if action not in ("approve", "reject"):
        return err("Unknown action")
    if action == "approve":  # saying "no" needs no code; saying "yes" must be the real parent
        if not p["otp_hash"] or now() > parse_iso(p["otp_expires"]):
            return err("code_expired")
        if not check_password_hash(p["otp_hash"], str(d.get("otp", "")).strip()):
            return err("code_wrong")
    p = record_parent_decision(p, action, "link")
    return ok(request=parent_view(p))


def normalise_phone(s):
    digits = re.sub(r"\D", "", s or "")
    return digits[-10:]


@app.post("/api/inbound")
def inbound_reply():
    """Webhook for a WhatsApp/SMS provider: {"from": "+91...", "text": "1"}.
    The message comes from the parent's registered number, so it is as strong as an OTP.
    Set OUTPASS_INBOUND_SECRET in production and have the provider send it as X-Inbound-Secret."""
    if INBOUND_SECRET and request.headers.get("X-Inbound-Secret") != INBOUND_SECRET:
        return err("Forbidden", 403)
    if not INBOUND_SECRET and not DEMO_MODE:
        return err("Inbound webhook not configured", 403)
    d = request.get_json(force=True)
    phone, text = normalise_phone(d.get("from")), (d.get("text") or "").strip().lower()
    word = re.split(r"[\s.,!]+", text)[0] if text else ""
    action = "approve" if word in YES_WORDS else "reject" if word in NO_WORDS else None
    db = get_db()
    candidates = [p for p in db.execute(
        "SELECT o.* FROM outpasses o JOIN students s ON s.id=o.student_id "
        "WHERE o.status='pending' AND o.parent_status='pending' ORDER BY o.created_at DESC").fetchall()
        if normalise_phone(student_of(p)["parent_phone"]) == phone]
    if not candidates:
        return ok(reply="There is no request waiting for your answer.")
    p = candidates[0]
    if not action:
        notify("whatsapp", d.get("from"), "Please reply 1 to allow or 2 to not allow.", p["pass_id"])
        db.commit()
        return ok(reply="Please reply 1 to allow or 2 to not allow.")
    p = record_parent_decision(p, action, "reply")
    msg = "Thank you. Allowed." if action == "approve" else "Thank you. Not allowed."
    if p["warden_status"] == "pending":
        msg += " The warden will confirm because the 10 PM time has passed."
    notify("whatsapp", d.get("from"), msg, p["pass_id"])
    db.commit()
    return ok(reply=msg, outpass=pass_json(p))


@app.post("/api/outpasses/<pass_id>/resend")
@require("student", "warden")
def resend_parent(pass_id):
    p = get_pass(pass_id)
    if not p or (g.role == "student" and p["student_id"] != g.user["id"]):
        return err("Outpass not found", 404)
    if p["status"] != "pending" or p["parent_status"] != "pending":
        return err("Parent has already answered")
    send_parent_request(p)
    get_db().commit()
    return ok()


@app.post("/api/outpasses/<pass_id>/otp")
@require("warden")
def send_otp(pass_id):
    """Send an OTP to the parent's phone (simulated). In DEMO_MODE the OTP is returned for the on-screen sim."""
    p = get_pass(pass_id)
    if not p or (g.role == "student" and p["student_id"] != g.user["id"]):
        return err("Outpass not found", 404)
    if p["parent_status"] != "pending" or p["status"] != "pending":
        return err("This request no longer needs parent approval")
    otp = f"{secrets.randbelow(9000) + 1000}"
    db = get_db()
    db.execute("UPDATE outpasses SET otp_hash=?, otp_expires=? WHERE pass_id=?",
               (generate_password_hash(otp), iso(now() + timedelta(seconds=OTP_TTL_SECONDS)), pass_id))
    notify("sms", student_of(p)["parent_phone"], f"Your CVV outpass OTP is {otp}. Valid for 2 minutes.", pass_id)
    db.commit()
    return ok(otp=otp if DEMO_MODE else None, expiresIn=OTP_TTL_SECONDS)


@app.post("/api/outpasses/<pass_id>/parent")
@require("warden")
def parent_action(pass_id):
    """Warden records a parent's answer given over a phone call (parents without smartphones)."""
    d = request.get_json(force=True)
    action, method = d.get("action"), d.get("method", "otp")
    p = get_pass(pass_id)
    if not p or (g.role == "student" and p["student_id"] != g.user["id"]):
        return err("Outpass not found", 404)
    if p["status"] != "pending" or p["parent_status"] != "pending":
        return err("This request no longer needs parent approval")
    if action not in ("approve", "reject"):
        return err("Unknown action")
    if action == "approve":
        if method == "phone":
            if g.role != "warden":
                return err("Only the warden can record a phone approval", 403)
        else:
            if not p["otp_hash"] or now() > parse_iso(p["otp_expires"]):
                return err("OTP expired. Please resend.")
            if not check_password_hash(p["otp_hash"], str(d.get("otp", ""))):
                return err("The OTP entered is incorrect. Please try again.")
    p = record_parent_decision(p, action, method)
    return ok(outpass=pass_json(p))


def can_act(p, role, user):
    """Mirror of the workflow rules: returns the approval column this user may set, or None."""
    if p["status"] != "pending":
        return None
    if role in ("teacher", "hod"):
        if student_of(p)["branch"] != user["department"]:
            return None
        col = f"{role}_status"
        if p[col] != "pending":
            return None
        if p["type"] == "emergency":
            return role if p["parent_status"] != "rejected" else None
        if role == "teacher":
            return role if p["parent_status"] == "approved" else None
        return role if p["teacher_status"] == "approved" else None
    if role == "warden":
        if p["warden_status"] == "pending":
            return "warden"
        if p["type"] == "emergency" and "rejected" not in (p["parent_status"], p["teacher_status"], p["hod_status"]):
            waited = now() - parse_iso(p["created_at"])
            if waited >= timedelta(hours=EMERGENCY_OVERRIDE_HOURS):
                return "warden"
    return None


@app.post("/api/outpasses/<pass_id>/decision")
@require("teacher", "hod", "warden")
def decide(pass_id):
    d = request.get_json(force=True)
    action = d.get("action")
    if action not in ("approve", "reject"):
        return err("Unknown action")
    p = get_pass(pass_id)
    if not p:
        return err("Outpass not found", 404)
    col = can_act(p, g.role, g.user)
    if not col:
        return err("This request isn't waiting for your decision", 409)
    status = "approved" if action == "approve" else "rejected"
    db = get_db()
    db.execute(f"UPDATE outpasses SET {col}_status=?, {col}_time=?, {col}_by=? WHERE pass_id=?",
               (status, iso(now()), g.user["id"], pass_id))
    if status == "rejected":
        db.execute("UPDATE outpasses SET reject_reason=? WHERE pass_id=?",
                   (f"Rejected by {col if col != 'hod' else 'HOD'}", pass_id))
    elif col == "teacher" and p["type"] == "working":
        stu = student_of(p)
        notify_staff("hod", stu["branch"], "🎓 Final step — HOD approval",
                     f"{stu['name']} ({stu['reg_no']}) · {p['out_date']}\nParent ✓  Class teacher ✓\n{p['reason']}", pass_id)
    p = finalize_if_complete(pass_id)
    db.commit()
    return ok(outpass=pass_json(p))


# ═══════════════════════════════════════════════════════════════════
# Inbox — what each person must act on, most urgent first
# ═══════════════════════════════════════════════════════════════════
PRIORITY = {"urgent": 0, "high": 1, "normal": 2, "info": 3}


@app.get("/api/inbox")
@require()
def inbox():
    db, t, items = get_db(), now(), []

    def item(p, kind, priority, title, body, actions):
        stu = student_of(p)
        items.append({"id": f"{kind}:{p['pass_id']}", "kind": kind, "priority": priority, "title": title,
                      "body": body, "passId": p["pass_id"], "student": stu["name"], "regNo": stu["reg_no"],
                      "outDate": p["out_date"], "reason": p["reason"], "type": p["type"],
                      "parentPhone": stu["parent_phone"] if g.role != "student" else None,
                      "createdAt": p["created_at"], "actions": actions})

    if g.role == "student":
        for p in db.execute("SELECT * FROM outpasses WHERE student_id=? ORDER BY created_at DESC LIMIT 10",
                            (g.user["id"],)):
            if p["status"] == "approved":
                item(p, "approved", "normal", "✅ Your pass is approved", f"Show the QR at the gate on {p['out_date']}.", ["open"])
            elif p["status"] == "rejected":
                item(p, "rejected", "info", "❌ Pass not approved", p["reject_reason"] or "Rejected", ["open"])
            elif p["status"] == "pending":
                waiting = "parent" if p["parent_status"] == "pending" else \
                          "class teacher" if p["teacher_status"] == "pending" else \
                          "HOD" if p["hod_status"] == "pending" else "warden"
                item(p, "waiting", "info", f"⏳ Waiting for {waiting}", f"Pass {p['pass_id']} for {p['out_date']}",
                     ["resend"] if waiting == "parent" else ["open"])
    else:
        for p in db.execute("SELECT * FROM outpasses WHERE status IN ('pending','active','completed') "
                            "ORDER BY created_at").fetchall():
            col = can_act(p, g.role, g.user) if g.role in ("teacher", "hod", "warden") else None
            if col and g.role in ("teacher", "hod"):
                if p["type"] == "emergency":
                    item(p, "emergency", "urgent", "🚨 Emergency — approve now",
                         "Parent, class teacher and HOD are asked together.", ["approve", "reject"])
                else:
                    step = "Step 2 of 3 · parent approved ✓" if g.role == "teacher" else \
                           "Final step · parent ✓ class teacher ✓"
                    item(p, "approval", "normal", "📝 Waiting for your approval", step, ["approve", "reject"])
            elif col == "warden":
                if p["warden_status"] == "pending":
                    item(p, "late_approval", "high", "🌙 Parent approved after 10 PM",
                         "The pass needs your decision.", ["approve", "reject"])
                else:
                    hrs = int((t - parse_iso(p["created_at"])).total_seconds() // 3600)
                    item(p, "emergency_override", "urgent", f"🚨 Emergency waiting {hrs}h",
                         "No one has rejected it. You can approve it directly.", ["approve", "call"])
            if g.role == "warden":
                if p["late_return"] and not p["late_ack"]:
                    out = p["status"] == "active"
                    item(p, "late", "urgent", "🚨 Still out after 6 PM" if out else "⚠️ Came back late",
                         f"Left {display_time(p['exit_at']) or '—'}" +
                         ("" if out else f", returned {display_time(p['return_at'])}"), ["call", "ack"])
                if p["status"] == "pending" and p["parent_status"] == "pending" and p["type"] == "holiday":
                    left = cutoff_for(p["out_date"]) - t
                    if left <= timedelta(hours=3):
                        mins = max(0, int(left.total_seconds() // 60))
                        item(p, "no_reply", "high", "📵 Parent hasn't replied",
                             f"Closes at 10 PM ({mins // 60}h {mins % 60}m left)", ["remind", "phone"])
    items.sort(key=lambda i: (PRIORITY[i["priority"]], i["createdAt"]))
    return ok(items=items, count=sum(1 for i in items if i["priority"] in ("urgent", "high", "normal")))


@app.post("/api/outpasses/<pass_id>/ack")
@require("warden")
def ack_late(pass_id):
    get_db().execute("UPDATE outpasses SET late_ack=1 WHERE pass_id=?", (pass_id,))
    get_db().commit()
    return ok()


@app.post("/api/outpasses/<pass_id>/remind")
@require("warden")
def remind(pass_id):
    p = get_pass(pass_id)
    if not p or p["parent_status"] != "pending":
        return err("No pending parent reply for this pass")
    send_parent_request(p)  # same simple message again: reply 1 / 2, or tap the link
    get_db().commit()
    return ok()


# ═══════════════════════════════════════════════════════════════════
# Gate
# ═══════════════════════════════════════════════════════════════════
@app.post("/api/scan")
@require("guard")
def scan():
    code = (request.get_json(force=True).get("code") or "").strip()
    if not code:
        return err("Please enter a Pass ID or token")
    db = get_db()
    p = db.execute("SELECT * FROM outpasses WHERE lower(pass_id)=lower(?) OR qr_token=?", (code, code)).fetchone()
    if not p:
        return ok(result="invalid")
    stu = student_of(p)
    t = now()
    if p["status"] == "approved":
        if p["out_date"] != t.date().isoformat():
            return ok(result="wrong_date", outpass=pass_json(p), student=student_json(stu))
        db.execute("UPDATE outpasses SET status='active', exit_at=? WHERE pass_id=?", (iso(t), p["pass_id"]))
        db.execute("INSERT INTO gate_scans (pass_id,kind,at,guard_id) VALUES (?,?,?,?)",
                   (p["pass_id"], "exit", iso(t), g.user["id"]))
        notify("whatsapp", stu["parent_phone"], f"{stu['name']} left campus at {t:%I:%M %p}.", p["pass_id"])
        db.commit()
        return ok(result="exit", outpass=pass_json(get_pass(p["pass_id"])), student=student_json(stu))
    if p["status"] == "active":
        late = t >= return_deadline_for(p["out_date"])
        db.execute("UPDATE outpasses SET status='completed', return_at=?, late_return=CASE WHEN late_return=1 THEN 1 ELSE ? END "
                   "WHERE pass_id=?", (iso(t), int(late), p["pass_id"]))
        db.execute("INSERT INTO gate_scans (pass_id,kind,at,guard_id) VALUES (?,?,?,?)",
                   (p["pass_id"], "return", iso(t), g.user["id"]))
        msg = f"{stu['name']} returned to campus at {t:%I:%M %p}."
        if late:
            msg = "LATE RETURN: " + msg + " (deadline 6 PM)"
            notify("whatsapp", "warden", msg, p["pass_id"])
        notify("whatsapp", stu["parent_phone"], msg, p["pass_id"])
        db.commit()
        return ok(result="late" if late else "return", outpass=pass_json(get_pass(p["pass_id"])),
                  student=student_json(stu))
    return ok(result=p["status"], outpass=pass_json(p), student=student_json(stu))


# ═══════════════════════════════════════════════════════════════════
# Kitchen
# ═══════════════════════════════════════════════════════════════════
@app.get("/api/kitchen")
@require("kitchen", "warden", "admin")
def kitchen():
    t = now()
    target = (t.date() + timedelta(days=1)).isoformat()
    out = get_db().execute("SELECT COUNT(*) FROM outpasses WHERE out_date=? AND status IN ('approved','active')",
                           (target,)).fetchone()[0]
    total = int(setting("total_students", 500))
    return ok(date=target, out=out, eating=total - out, total=total, final=t.hour >= CUTOFF_HOUR)


# ═══════════════════════════════════════════════════════════════════
# Admin
# ═══════════════════════════════════════════════════════════════════
@app.put("/api/students/<sid>/parent")
@require("admin")
def update_parent(sid):
    d = request.get_json(force=True)
    db = get_db()
    old = db.execute("SELECT parent_phone FROM students WHERE id=?", (sid,)).fetchone()
    if old and old["parent_phone"] != (d.get("parentPhone") or "").strip():
        log_contact_change(db, sid, old["parent_phone"], (d.get("parentPhone") or "").strip(), g.user["id"])
    lang = d.get("parentLang") if d.get("parentLang") in PARENT_MSG else "en"
    cur = db.execute("UPDATE students SET parent_name=?, parent_phone=?, parent_lang=? WHERE id=?",
                     ((d.get("parentName") or "").strip(), (d.get("parentPhone") or "").strip(), lang, sid))
    db.commit()
    return ok() if cur.rowcount else err("Student not found", 404)


def log_contact_change(db, sid, old, new, who):
    db.execute("INSERT INTO parent_contact_log (student_id, old_phone, new_phone, changed_by, at) VALUES (?,?,?,?,?)",
               (sid, old, new, who, iso(now())))


@app.get("/api/students/<sid>/contact-log")
@require("admin", "warden")
def contact_log(sid):
    rows = get_db().execute("SELECT * FROM parent_contact_log WHERE student_id=? ORDER BY id DESC", (sid,)).fetchall()
    return ok(log=[dict(r) for r in rows])


def insert_student(db, row):
    db.execute("INSERT INTO students (id,email,name,reg_no,password_hash,semester,branch,parent_name,parent_phone,"
               "parent_lang) VALUES (?,?,?,?,?,?,?,?,?,?)",
               (next_student_id(db), row["email"].lower(), row["name"], row["regNo"],
                "!", int(row.get("semester") or 1), row.get("branch") or "CSE",
                row.get("parentName") or "Parent", row["parentPhone"],
                row.get("parentLang") if row.get("parentLang") in PARENT_MSG else "en"))


@app.post("/api/students")
@require("admin")
def add_student():
    d = request.get_json(force=True)
    if not all((d.get(k) or "").strip() for k in ("name", "regNo", "email", "parentPhone")):
        return err("Please fill all required fields")
    db = get_db()
    if db.execute("SELECT 1 FROM students WHERE email=? OR reg_no=?", (d["email"].lower(), d["regNo"])).fetchone():
        return err("A student with this email or registration number already exists")
    insert_student(db, {k: (v.strip() if isinstance(v, str) else v) for k, v in d.items()})
    db.commit()
    return ok()


@app.post("/api/students/import")
@require("admin")
def import_students():
    """CSV columns: RegNo, Name, Email, Branch, Semester, ParentName, ParentPhone[, ParentLanguage]
    (header row optional; language = en/ml/hi/kn/te/ta).
    Existing students (matched by RegNo) get their parent details updated; new ones are added."""
    text = request.get_data(as_text=True)
    rows = list(csv.reader(io.StringIO(text)))
    if rows and rows[0] and rows[0][0].strip().lower().replace(" ", "") in ("regno", "registrationnumber"):
        rows = rows[1:]
    db = get_db()
    added = updated = 0
    errors = []
    for i, r in enumerate(rows, 1):
        r = [c.strip() for c in r]
        if not any(r):
            continue
        if len(r) < 7 or not all((r[0], r[1], r[2], r[6])):
            errors.append(f"Row {i}: expected 7 columns with RegNo, Name, Email and ParentPhone")
            continue
        reg, name, email, branch, sem, pname, pphone = r[:7]
        plang = (r[7].lower()[:2] if len(r) > 7 and r[7] else "en")
        existing = db.execute("SELECT id, parent_phone FROM students WHERE reg_no=?", (reg,)).fetchone()
        if existing:
            if existing["parent_phone"] != pphone:
                log_contact_change(db, existing["id"], existing["parent_phone"], pphone, g.user["id"] + " (CSV)")
            db.execute("UPDATE students SET parent_name=?, parent_phone=?, branch=?, semester=?, parent_lang=? "
                       "WHERE id=?", (pname, pphone, branch, int(sem or 1), plang, existing["id"]))
            updated += 1
        elif db.execute("SELECT 1 FROM students WHERE email=?", (email.lower(),)).fetchone():
            errors.append(f"Row {i}: email {email} already belongs to another student")
        else:
            insert_student(db, {"regNo": reg, "name": name, "email": email, "branch": branch,
                                "semester": sem, "parentName": pname, "parentPhone": pphone, "parentLang": plang})
            added += 1
    db.commit()
    return ok(added=added, updated=updated, errors=errors)


@app.post("/api/holidays/toggle")
@require("admin")
def toggle_holiday():
    d = (request.get_json(force=True).get("date") or "").strip()
    try:
        date.fromisoformat(d)
    except ValueError:
        return err("Invalid date")
    db = get_db()
    if db.execute("SELECT 1 FROM holidays WHERE date=?", (d,)).fetchone():
        db.execute("DELETE FROM holidays WHERE date=?", (d,))
        added = False
    else:
        name = (request.get_json(force=True).get("name") or "Holiday (added by admin)").strip()
        db.execute("INSERT INTO holidays (date,name,kind,source) VALUES (?,?,'holiday','admin')", (d, name))
        added = True
    db.commit()
    return ok(added=added)


# ── Academic calendar from cvv.ac.in ──────────────────────────────
DATE_RX = r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})"
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug",
                                       "sep", "oct", "nov", "dec"], 1)}
WORD_DATE_RX = r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})"


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (CVV Outpass calendar sync)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def find_calendar_pdf(html):
    """Pick the 'All UG, PG & PhD' calendar PDF (not B.Ed./Music/campus-specific) for the newest year."""
    links = re.findall(r'href="([^"]+\.pdf)"', html, re.I)
    best = None
    for u in links:
        name = u.rsplit("/", 1)[-1].lower()
        if "academic-calendar" not in name or any(x in name for x in ("bed", "music", "ceg", "cnbg", "daywise")):
            continue
        yr = re.search(r"(20\d\d)-(\d\d)", name)
        key = int(yr.group(1)) if yr else 0
        if not best or key > best[0]:
            best = (key, u)
    return best[1] if best else None


def parse_calendar_pdf(data):
    """Extract holiday rows ('12.08.2026 Wednesday Karkidaka Vavu') and named breaks/vacations."""
    from pypdf import PdfReader  # pip install pypdf
    text = "\n".join((pg.extract_text() or "") for pg in PdfReader(io.BytesIO(data)).pages)

    def to_date(m, words=False):
        try:
            if words:
                return date(int(m[2]), MONTHS[m[1][:3].lower()], int(m[0]))
            return date(int(m[2]), int(m[1]), int(m[0]))
        except (KeyError, ValueError):
            return None

    holidays, breaks = [], []
    for line in text.splitlines():
        line = " ".join(line.split())
        found = [to_date(m) for m in re.findall(DATE_RX, line)] or \
                [to_date(m, True) for m in re.findall(WORD_DATE_RX, line)]
        found = [d for d in found if d]
        if not found:
            continue
        label = re.sub(DATE_RX + "|" + WORD_DATE_RX, " ", line)
        label = re.sub(r"\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\bto\b|\b\d+\b|[-–*()]", " ", label, flags=re.I)
        label = " ".join(label.split()).strip(" .:,")
        low = line.lower()
        entry = {"date": found[0].isoformat(), "name": label or "Holiday"}
        if len(found) > 1 and found[1] > found[0]:
            entry["to"] = found[1].isoformat()
        if "*" in line:
            entry["name"] += " (tentative)"
        if "break" in low or "vacation" in low:
            if "s3" in low and "s5" in low and "s7" in low:
                entry["semesters"] = [3, 5, 7]
            breaks.append(entry)
        elif low.lstrip("0123456789. ").startswith(found[0].strftime("%d").lstrip("0")) or \
                re.search(r"(mon|tues|wednes|thurs|fri|satur|sun)day", low) or "holiday" in low:
            if not any(k in low for k in ("assessment", "fee", "result", "last date", "commence", "teaching", "exam")):
                holidays.append(entry)
    return {"holidays": holidays, "breaks": breaks}


@app.post("/api/calendar/sync")
@require("admin")
def calendar_sync():
    """Download CVV's academic calendar from cvv.ac.in and load its holidays and breaks."""
    try:
        html = fetch(CVV_CALENDAR_PAGE).decode("utf-8", "replace")
        pdf_url = find_calendar_pdf(html)
        if not pdf_url:
            return err("Couldn't find the academic calendar PDF on cvv.ac.in")
        cal = parse_calendar_pdf(fetch(pdf_url))
    except ImportError:
        return err("Calendar sync needs the pypdf package: pip install pypdf")
    except Exception as e:  # network errors, PDF format changes
        return err(f"Couldn't read the CVV calendar ({e.__class__.__name__}). The saved calendar is unchanged.")
    if len(cal["holidays"]) < 3:
        return err("The CVV calendar PDF didn't look like the usual format, so nothing was changed. "
                   "Edit cvv_calendar.json or add holidays by hand.")
    cal["source_pdf"] = pdf_url
    db = get_db()
    n = load_calendar_entries(db, cal, "cvv.ac.in")
    set_setting("calendar_synced_at", iso(now()))
    db.commit()
    try:  # keep the bundled file in step when running locally (read-only on Vercel, which is fine)
        json.dump(cal, open(CALENDAR_FILE, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    except OSError:
        pass
    return ok(days=n, holidays=len(cal["holidays"]), breaks=len(cal["breaks"]), pdf=pdf_url)


@app.put("/api/settings/warden-phone")
@require("admin", "warden")
def set_warden_phone():
    set_setting("warden_phone", (request.get_json(force=True).get("phone") or "").strip())
    get_db().commit()
    return ok()


@app.post("/api/reset")
@require("admin")
def reset():
    seed(get_db(), wipe=True)
    return ok()


@app.get("/api/notifications")
@require("warden", "admin")
def notifications():
    rows = get_db().execute("SELECT * FROM notifications ORDER BY id DESC LIMIT 100").fetchall()
    return ok(notifications=[dict(r) for r in rows])


# ═══════════════════════════════════════════════════════════════════
# No-database mode (online prototype)
# The browser sends its saved copy of the data with each request. We load it into a throwaway
# in-memory database, run the normal endpoint, and send the updated copy back.
# ═══════════════════════════════════════════════════════════════════
TABLES = ("settings", "holidays", "staff", "students", "outpasses", "gate_scans", "notifications", "parent_contact_log")
_tunnel_lock = threading.Lock()


def fresh_memory_db():
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA.replace("{SERIAL}", "INTEGER PRIMARY KEY AUTOINCREMENT"))
    return conn


def dump_state(conn):
    conn.execute("DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT 150)")
    data = {}
    for t in TABLES:
        cur = conn.execute(f"SELECT * FROM {t}")
        data[t] = {"cols": [c[0] for c in cur.description], "rows": [list(r) for r in cur.fetchall()]}
    return base64.b64encode(zlib.compress(json.dumps(data, separators=(",", ":")).encode(), 9)).decode()


def load_state(conn, blob):
    data = json.loads(zlib.decompress(base64.b64decode(blob)))
    for t in TABLES:
        if data.get(t, {}).get("rows"):
            cols = data[t]["cols"]
            conn.executemany(f"INSERT INTO {t} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                             data[t]["rows"])
    conn.commit()


@app.post("/api/__tunnel")
def tunnel():
    if not TUNNEL:
        return err("Not found", 404)
    env = request.get_json(force=True)
    path = env.get("path") or "/"
    if not path.startswith("/api/") or path.startswith("/api/__tunnel"):
        return err("Bad path")
    with _tunnel_lock:
        conn = fresh_memory_db()
        try:
            try:
                if not env.get("state"):
                    raise ValueError("no saved data yet")
                load_state(conn, env["state"])
            except Exception as e:  # first visit, or a damaged copy: start from the demo data
                app.logger.warning("tunnel %s %s: starting fresh demo data (%s)", env.get("method"), path, e)
                conn.close()
                conn = fresh_memory_db()
                seed(conn)
            _tunnel.conn = conn
            # The inner request shares this request's app context (and its `g`), so make sure it
            # can't pick up a connection to the server's own database file.
            old = g.pop("db", None)
            if old is not None:
                old.close()
            client = app.test_client()
            if env.get("session"):
                with client.session_transaction() as s:
                    s.update(env["session"])
            kw = {"method": env.get("method", "GET")}
            if env.get("body") is not None:
                kw["data"] = env["body"]
                kw["content_type"] = env.get("contentType") or "application/json"
            resp = client.open(path, **kw)
            with client.session_transaction() as s:
                new_session = dict(s)
            state = dump_state(conn)
        finally:
            _tunnel.conn = None
            g.pop("db", None)
            conn.close()
    return jsonify({"status": resp.status_code, "contentType": resp.content_type,
                    "body": resp.get_data(as_text=True), "state": state, "session": new_session})


# ═══════════════════════════════════════════════════════════════════
# Static frontend

# ═══════════════════════════════════════════════════════════════════
TUNNEL_TAGS = '<script>window.OUTPASS_TUNNEL=true</script><script src="/demo-tunnel.js"></script>'


def html_page(name):
    """Serve a page. In no-database mode, load the tunnel script before the page's own code."""
    html = open(os.path.join(BASE_DIR, name), encoding="utf-8").read()
    if TUNNEL:
        html = html.replace("<head>", "<head>\n  " + TUNNEL_TAGS, 1)
    return app.response_class(html, mimetype="text/html")


@app.get("/")
def index():
    return html_page("index.html")


@app.get("/<path:name>")
def static_files(name):
    clean_name = name.removeprefix("api/index").strip("/")
    if not clean_name or clean_name == "index.html":
        return html_page("index.html")
    if clean_name == "parent.html":
        return html_page("parent.html")
    if clean_name in ("app.js", "style.css", "demo-tunnel.js"):
        return send_from_directory(BASE_DIR, clean_name)
    return err("Not found", 404)


@app.cli.command("sweep")
def sweep_cmd():
    """Apply time-based rules now (cutoff rejections, late alerts). Safe to run from cron."""
    with app.app_context():
        sweep()
    print("Sweep done.")


init_db()

if __name__ == "__main__":
    # Port 5000 is taken by AirPlay Receiver on macOS, so default to 8000.
    port = int(os.environ.get("PORT", 8000))
    print(f"\n  CVV Outpass is running →  http://localhost:{port}\n  (keep this window open; press Ctrl+C to stop)\n")
    app.run(host="0.0.0.0", port=port, debug=True)

"""End-to-end workflow tests. Run:  python test_flows.py"""
import os, tempfile
from datetime import datetime, timedelta

os.environ["OUTPASS_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")
import app as A

CLOCK = {"t": datetime(2026, 10, 12, 15, 0, tzinfo=A.TZ)}  # Monday 3 PM
A.now = lambda: CLOCK["t"]

def at(y, m, d, h, mi=0):
    CLOCK["t"] = datetime(y, m, d, h, mi, tzinfo=A.TZ)

def client(email, role):
    c = A.app.test_client()
    r = c.post("/api/login", json={"email": email, "password": "pass123", "role": role})
    assert r.json["ok"], r.json
    return c

def reset():
    with A.app.app_context():
        A.seed(A.get_db(), wipe=True)

def new_pass(stu, date, emergency=False, reason="Going home"):
    r = stu.post("/api/outpasses", json={"outDate": date, "reason": reason, "emergency": emergency}).json
    assert r["ok"], r
    return r["outpass"]

def link_of(stu, pid):
    return next(p for p in stu.get("/api/state").json["state"]["outpasses"] if p["passId"] == pid)["parentLink"]

def parent_ok(stu, pid):
    """Parent taps the WhatsApp link (no login) -> Yes -> types SMS code."""
    tok = link_of(stu, pid).rsplit("/", 1)[1]
    par = A.app.test_client()
    r = par.post(f"/api/p/{tok}/otp").json
    if not r["ok"]:
        return r
    r = par.post(f"/api/p/{tok}/decision", json={"action": "approve", "otp": r["otp"]}).json
    if r.get("ok"):
        r["outpass"] = {"status": r["request"]["status"]}
    return r

def status(c, pid):
    return next(p for p in c.get("/api/state").json["state"]["outpasses"] if p["passId"] == pid)

passed = 0
def check(name, cond):
    global passed
    assert cond, name
    passed += 1
    print("  ✓", name)

reset()
stu = client("rahul@cvv.edu.in", "student")
teacher = client("teacher@cvv.edu.in", "teacher")
hod = client("hod@cvv.edu.in", "hod")
ece_hod = client("ece.hod@cvv.edu.in", "hod")
warden = client("warden@cvv.edu.in", "warden")
guard = client("guard@cvv.edu.in", "guard")
admin = client("admin@cvv.edu.in", "admin")

print("Type detection")
p = new_pass(stu, "2026-10-19")  # Pooja Holidays (CVV calendar)
check("CVV calendar holiday (Pooja) -> holiday", p["type"] == "holiday")
p2 = new_pass(stu, "2026-10-13")  # Tuesday
check("weekday -> working", p2["type"] == "working")
p3 = new_pass(stu, "2026-10-17")  # Saturday
check("Saturday -> holiday", p3["type"] == "holiday")
r = stu.post("/api/outpasses", json={"outDate": "2026-10-19", "reason": "x"}).json
check("duplicate pass for same date blocked", not r["ok"])

print("Holiday: parent approval before cutoff auto-generates pass")
tok = link_of(stu, p["passId"]).rsplit("/", 1)[1]
par = A.app.test_client()
check("parent page loads without login", par.get(f"/api/p/{tok}").json["request"]["student"] == "Rahul Sharma")
check("parent HTML served", par.get(f"/p/{tok}").status_code == 200)
otp = par.post(f"/api/p/{tok}/otp").json["otp"]
bad = "1000" if otp != "1000" else "1001"
check("wrong code refused", par.post(f"/api/p/{tok}/decision", json={"action": "approve", "otp": bad}).json["error"] == "code_wrong")
r = par.post(f"/api/p/{tok}/decision", json={"action": "approve", "otp": otp}).json
check("approved before 10 PM", r["request"]["status"] == "approved")
check("student can no longer approve for parent", stu.post(f"/api/outpasses/{p['passId']}/otp").status_code == 403)

print("Working day: parent -> teacher -> HOD, in order")
r = teacher.post(f"/api/outpasses/{p2['passId']}/decision", json={"action": "approve"}).json
check("teacher can't act before parent", not r["ok"])
parent_ok(stu, p2["passId"])
r = hod.post(f"/api/outpasses/{p2['passId']}/decision", json={"action": "approve"}).json
check("HOD can't act before teacher", not r["ok"])
r = ece_hod.post(f"/api/outpasses/{p2['passId']}/decision", json={"action": "approve"})
check("other department's HOD blocked", r.status_code == 409)
teacher.post(f"/api/outpasses/{p2['passId']}/decision", json={"action": "approve"})
r = hod.post(f"/api/outpasses/{p2['passId']}/decision", json={"action": "approve"}).json
check("approved after HOD", r["outpass"]["status"] == "approved")

print("Emergency: parallel, parent approving LAST still finalises (bug fix)")
reset(); stu = client("rahul@cvv.edu.in", "student")
e = new_pass(stu, "2026-10-12", emergency=True, reason="Family emergency")
check("emergency type", e["type"] == "emergency")
teacher.post(f"/api/outpasses/{e['passId']}/decision", json={"action": "approve"})
hod.post(f"/api/outpasses/{e['passId']}/decision", json={"action": "approve"})
check("still pending without parent", status(warden, e["passId"])["status"] == "pending")
r = parent_ok(stu, e["passId"])
check("parent last -> approved", r["outpass"]["status"] == "approved")

print("Any rejection stops the request")
e2 = new_pass(stu, "2026-10-13", emergency=True)
teacher.post(f"/api/outpasses/{e2['passId']}/decision", json={"action": "reject"})
check("rejected", status(warden, e2["passId"])["status"] == "rejected")
r = parent_ok(stu, e2["passId"])
check("parent can't revive rejected pass", not r["ok"])

print("Emergency waiting > 2h: warden override")
e3 = new_pass(stu, "2026-10-15", emergency=True)
r = warden.post(f"/api/outpasses/{e3['passId']}/decision", json={"action": "approve"}).json
check("warden blocked before 2h", not r["ok"])
at(2026, 10, 12, 17, 5)
r = warden.post(f"/api/outpasses/{e3['passId']}/decision", json={"action": "approve"}).json
check("warden approves after 2h", r["ok"] and r["outpass"]["status"] == "approved")

print("10 PM cutoff")
at(2026, 10, 12, 15, 0)
h1 = new_pass(stu, "2026-10-25", reason="no reply case")       # Sunday
h2 = new_pass(stu, "2026-10-24", reason="phone approval case")  # Saturday
at(2026, 10, 24, 23, 0)  # after cutoff for 10-25 and 10-24
st = status(warden, h1["passId"])
check("no parent reply -> rejected at cutoff", st["status"] == "rejected" and "cutoff" in st["rejectReason"])
r = stu.post("/api/outpasses", json={"outDate": "2026-10-25", "reason": "late"}).json
check("new holiday request after cutoff refused", not r["ok"])

print("Warden phone approval")
reset(); stu = client("rahul@cvv.edu.in", "student")
at(2026, 10, 12, 15, 0)
h3 = new_pass(stu, "2026-10-13", emergency=False)  # working day
w = new_pass(stu, "2026-10-18")  # Sunday
at(2026, 10, 17, 21, 59)
r = warden.post(f"/api/outpasses/{w['passId']}/parent", json={"action": "approve", "method": "phone"}).json
check("phone approval before cutoff -> approved", r["outpass"]["status"] == "approved")
r = stu.post(f"/api/outpasses/{h3['passId']}/parent", json={"action": "approve", "method": "phone"}).json
check("student can't fake phone approval", not r["ok"])

print("Gate: exit, return, late alert")
reset(); stu = client("rahul@cvv.edu.in", "student")
at(2026, 10, 13, 9, 0)
s = new_pass(stu, "2026-10-17")  # Saturday
parent_ok(stu, s["passId"])
r = guard.post("/api/scan", json={"code": s["qrToken"]}).json
check("scan on wrong day refused", r["result"] == "wrong_date")
at(2026, 10, 17, 10, 0)
r = guard.post("/api/scan", json={"code": s["qrToken"]}).json
check("exit recorded", r["result"] == "exit" and r["outpass"]["status"] == "active")
at(2026, 10, 17, 18, 30)
st = status(warden, s["passId"])
check("still out after 6 PM flagged late", st["lateReturn"])
r = guard.post("/api/scan", json={"code": s["passId"].lower()}).json
check("late return recorded", r["result"] == "late" and r["outpass"]["status"] == "completed")
r = guard.post("/api/scan", json={"code": s["qrToken"]}).json
check("used pass can't be reused", r["result"] == "completed")
r = guard.post("/api/scan", json={"code": "nope"}).json
check("unknown code invalid", r["result"] == "invalid")
notes = warden.get("/api/notifications").json["notifications"]
check("warden alert in outbox", any(n["recipient"] == "warden" and "6 PM" in n["message"] for n in notes))

print("Kitchen")
at(2026, 10, 16, 20, 0)
k = client("kitchen@cvv.edu.in", "kitchen").get("/api/kitchen").json
check("tomorrow's count is live", k["date"] == "2026-10-17" and not k["final"])

print("Permissions + admin")
check("student can't see others' passes", all(p["studentId"] == "STU001" for p in stu.get("/api/state").json["state"]["outpasses"]))
check("student can't approve", stu.post(f"/api/outpasses/{s['passId']}/decision", json={"action": "approve"}).status_code == 403)
check("guard can't edit parent phone", guard.put("/api/students/STU001/parent", json={}).status_code == 403)
csv_text = "RegNo,Name,Email,Branch,Semester,ParentName,ParentPhone\nCVV2024001,Rahul Sharma,rahul@cvv.edu.in,CSE,5,Mr. A Sharma,+91 11111 11111\n241160078,P S Manthan,manthan.cvv241207@cvv.ac.in,AIML,5,Parent,+91 22222 22222\nbad,row\n"
r = admin.post("/api/students/import", data=csv_text).json
check("CSV import adds/updates/skips", (r["added"], r["updated"], len(r["errors"])) == (1, 1, 1))
r = admin.post("/api/holidays/toggle", json={"date": "2026-10-28"}).json
check("holiday toggle", r["added"])
anon = A.app.test_client()
r = anon.post("/api/register", json={"email": "new@cvv.ac.in", "regNo": "999", "password": "secret1"}).json
check("register no. not in hostel records -> refused", not r["ok"] and "hostel records" in r["error"])
r = anon.post("/api/login", json={"email": "241160078", "password": "secret1", "role": "student"}).json
check("imported student can't log in before activating", not r["ok"] and "activated" in r["error"])
r = anon.post("/api/register", json={"email": "friend@cvv.ac.in", "regNo": "241160078", "password": "secret1"}).json
check("email must match records", not r["ok"])
r = anon.post("/api/register", json={"email": "manthan.cvv241207@cvv.ac.in", "regNo": "241160078", "password": "secret1"}).json
check("activation works, parent number masked", r["ok"] and r["parentPhone"].endswith("222") and "•" in r["parentPhone"])
r = anon.post("/api/register", json={"email": "manthan.cvv241207@cvv.ac.in", "regNo": "241160078", "password": "hijack1"}).json
check("can't re-activate someone's account", not r["ok"])
r = anon.post("/api/login", json={"email": "241160078", "password": "secret1", "role": "student"}).json
check("login with register number", r["ok"])
log = admin.get("/api/students/STU001/contact-log").json["log"]
check("parent number change logged", log and log[0]["new_phone"] == "+91 11111 11111")

print("CVV academic calendar")
st = admin.get("/api/state").json["state"]
names = {h["name"] for h in st["holidayInfo"]}
check("CVV holidays loaded", {"Gandhi Jayanti", "Pooja Holidays", "Diwali", "Vishu"} <= names)
at(2026, 11, 1, 10, 0)
r5 = new_pass(stu, "2026-12-10")          # Thursday, in the S3/S5/S7 semester break
check("S5 student: semester break -> holiday", r5["type"] == "holiday")
priya = client("priya@cvv.edu.in", "student")  # semester 3
r3 = new_pass(priya, "2026-12-10")
check("S3 student also on break", r3["type"] == "holiday")
admin.put("/api/students/STU002/parent", json={"parentName": "Mrs. Lakshmi Reddy", "parentPhone": "+91 91234 56789"})
amit_sem1 = client("amit@cvv.edu.in", "student")
with A.app.app_context():
    A.get_db().execute("UPDATE students SET semester=1 WHERE id='STU005'"); A.get_db().commit()
r1 = new_pass(amit_sem1, "2026-12-10")
check("S1 student still has classes -> working", r1["type"] == "working")

print("Parent replies 1/2 on WhatsApp")
r = A.app.test_client().post("/api/inbound", json={"from": "+91 11111 11111", "text": "1"}).json
check("reply 1 approves the parent's pending request", r["ok"] and r["outpass"]["approvals"]["parent"] == "approved")
r = A.app.test_client().post("/api/inbound", json={"from": "919999999999", "text": "1"}).json
check("unknown number gets a polite reply", "no request" in r["reply"].lower())
r = A.app.test_client().post("/api/inbound", json={"from": "+91 91234 56789", "text": "maybe"}).json
check("unclear reply asks again", "reply 1" in r["reply"].lower())
r = A.app.test_client().post("/api/inbound", json={"from": "+91 91234 56789", "text": "2"}).json
check("reply 2 rejects", r["outpass"]["status"] == "rejected")

print("Role-specific alerts")
e9 = new_pass(stu, "2026-11-02", emergency=True, reason="Grandmother in hospital")
inbox = teacher.get("/api/inbox").json["items"]
check("teacher: emergency first, marked urgent", inbox[0]["priority"] == "urgent" and inbox[0]["passId"] == e9["passId"])
check("HOD sees emergency too", any(i["passId"] == e9["passId"] for i in hod.get("/api/inbox").json["items"]))
check("other dept HOD doesn't", not any(i["passId"] == e9["passId"] for i in ece_hod.get("/api/inbox").json["items"]))
at(2026, 11, 1, 13, 0)
w = warden.get("/api/inbox").json["items"]
check("warden: emergency override after 2h", any(i["kind"] == "emergency_override" for i in w))
s_items = stu.get("/api/inbox").json["items"]
check("student sees who they're waiting for", any(i["title"].startswith("⏳ Waiting for") for i in s_items))
outbox = warden.get("/api/notifications").json["notifications"]
check("staff WhatsApp alert has headline + open link", any(n["recipient"] == "teacher:CSE" and n["message"].startswith("🚨 EMERGENCY") and "#pass=" in n["message"] for n in outbox))
check("parent message is reply-1/2 style", any("Reply 1" in n["message"] for n in outbox))

print("Calendar PDF parser (synthetic sample in CVV's layout)")
try:
    from reportlab.pdfgen import canvas
except ImportError:
    print("  (skipped — pip install reportlab to run the parser tests)"); print(f"\nAll {passed} checks passed."); raise SystemExit

buf = __import__("io").BytesIO(); c = canvas.Canvas(buf)
lines = ["ACADEMIC CALENDAR (2026-27)", "1 Commencement of classes 01.07.2026", "Mid semester break 23.08.2026 to 30.08.2026",
         "Holidays - Dakshinayanam", "12.08.2026 Wednesday Karkidaka Vavu", "02.10.2026 Friday Gandhi Jayanti",
         "19.10.2026 to 21.10.2026 Pooja Holidays", "09.11.2026 Monday Diwali", "Last date of fee payment 10.07.2026",
         "10.03.2027 Wednesday Eid ul-Fitr*"]
for k, ln in enumerate(lines): c.drawString(40, 800 - 20 * k, ln)
c.save()
cal = A.parse_calendar_pdf(buf.getvalue())
hn = {h["name"]: h for h in cal["holidays"]}
check("parser finds holidays", {"Karkidaka Vavu", "Gandhi Jayanti", "Pooja Holidays", "Diwali"} <= set(hn))
check("parser reads ranges", hn["Pooja Holidays"].get("to") == "2026-10-21")
check("parser marks tentative", any("tentative" in n for n in hn))
check("parser skips fee/commencement rows", not any("fee" in n.lower() or "commencement" in n.lower() for n in hn))
check("parser finds breaks", any(b["name"].lower().startswith("mid semester break") for b in cal["breaks"]))
html = '<a href="/x/Academic-Calendar-BEd-Programme-2026-27.pdf">B</a><a href="https://www.cvv.ac.in/wp-content/uploads/2026/06/Academic-Calendar-2026-27.pdf">A</a><a href="/CVV_Academic-Calendar-2025-26_Revised.pdf">C</a>'
check("picks the all-UG/PG PDF", A.find_calendar_pdf(html).endswith("2026/06/Academic-Calendar-2026-27.pdf"))

print(f"\nAll {passed} checks passed.")

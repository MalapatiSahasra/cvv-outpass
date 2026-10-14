/* ================================================================
   CVV Smart Outpass System — Application Logic (app.js)
   ================================================================

   This is the complete prototype with:
   • State management (Flask API + SQLite — see app.py)
   • Multi-role authentication (Student, Teacher, HOD, Warden, Guard, Kitchen, Admin)
   • Outpass request → multi-step approval workflow
   • Simulated OTP / WhatsApp / QR
   • Academic calendar awareness
   • 10 PM cutoff logic
   • Kitchen live count
   • Guard scanner
   • Warden dashboard with alerts
   ================================================================ */

// ═══════════════════════════════════════════════════════════════════
// 0. DATA STORE — simulated backend
// ═══════════════════════════════════════════════════════════════════
// All data now lives in the Flask backend (app.py, SQLite). The server enforces
// every workflow rule; the browser only renders the state it returns.
async function api(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    if (typeof body === 'string') { opts.headers['Content-Type'] = 'text/plain'; opts.body = body; }
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  let res, data;
  try {
    res = await fetch(url, opts);
    data = await res.json();
  } catch (e) {
    showToast('Server unreachable', 'Is the Flask server running? (python app.py)', 'error');
    throw e;
  }
  if (res.status === 401 && url !== '/api/login') {
    APP.currentUser = null; APP.currentRole = null;
    renderAuth();
  }
  if (!data.ok) {
    const err = new Error(data.error || 'Request failed');
    err.handled = true;
    throw err;
  }
  return data;
}

// Run an API call; show the server's error as a toast and return null on failure.
async function apiOrToast(method, url, body, title = 'Error') {
  try { return await api(method, url, body); }
  catch (e) { if (e.handled) showToast(title, e.message, 'error'); return null; }
}

const DB = {
  async load() {
    const r = await api('GET', '/api/state');
    return r.state;
  },
};

async function refreshDB() {
  APP.db = await DB.load();
}

// ═══════════════════════════════════════════════════════════════════
// 1. APP STATE
// ═══════════════════════════════════════════════════════════════════
let APP = {
  db: null,
  currentUser: null,
  currentRole: null,
  currentPage: null,
  toastTimeout: null,
};

async function init() {
  APP.db = { students: [], staff: [], outpasses: [], holidays: [], totalStudents: 0 };
  try {
    const r = await api('GET', '/api/me');
    if (r && r.user) {
      APP.currentUser = r.user;
      APP.currentRole = r.role;
      await refreshDB();
      renderDashboard();
      return;
    }
  } catch (e) {
    console.error('Initialization error:', e);
  }
  renderAuth();
}

// ═══════════════════════════════════════════════════════════════════
// 2. RENDERING HELPERS
// ═══════════════════════════════════════════════════════════════════
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

function setPage(html) {
  document.getElementById('app').innerHTML = html;
}

function showToast(title, message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = el('div', 'toast-container');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
  const toast = el('div', `toast ${type}`, `
    <span class="toast-icon">${icons[type]}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
  `);
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ═══════════════════════════════════════════════════════════════════
// 3. AUTH SCREENS
// ═══════════════════════════════════════════════════════════════════
function renderAuth(mode = 'login', who) {
  const isLogin = mode === 'login';
  const isStaff = isLogin && (who || APP.authWho) === 'staff';
  APP.authWho = isStaff ? 'staff' : 'student';
  setPage(`
    <div class="portal">
      <header class="portal-top">
        <div class="portal-brand">
          <div class="portal-crest">CVV</div>
          <div>
            <div class="portal-uni">Chinmaya Vishwa Vidyapeeth</div>
            <div class="portal-sub">Hostel Outpass Portal</div>
          </div>
        </div>
        <div class="portal-top-note">Ernakulam, Kerala</div>
      </header>

      <main class="portal-main">
        <section class="portal-info">
          <h1>Leave the hostel without the paperwork.</h1>
          <p>Apply for holiday, working-day and emergency outpasses online. Parents approve on WhatsApp, approvals come to you, and the gate scans your QR pass.</p>
          <ul class="portal-points">
            <li><span>1</span>Apply before <strong>10:00 PM</strong> the day before</li>
            <li><span>2</span>Parent approves with an OTP</li>
            <li><span>3</span>Show your QR pass at the gate, back by <strong>6:00 PM</strong></li>
          </ul>
        </section>

        <section class="portal-card">
          ${isLogin ? `
          <div class="portal-switch" role="tablist">
            <button type="button" class="${!isStaff ? 'on' : ''}" onclick="renderAuth('login','student')">Student Login</button>
            <button type="button" class="${isStaff ? 'on' : ''}" onclick="renderAuth('login','staff')">Staff Login</button>
          </div>` : `
          <div class="portal-card-head">
            <h2>Activate your account</h2>
            <p>Your details and your parent's phone number are already in the hostel records. Enter your register number and college email to set a password.</p>
          </div>`}

          <form onsubmit="event.preventDefault(); ${isLogin ? 'handleLogin()' : 'handleRegister()'}">
            ${!isLogin ? `
            <div class="form-group">
              <label for="regNo">Register Number</label>
              <input class="form-input" id="regNo" placeholder="e.g. 241160078" autocomplete="username" required>
            </div>
            ` : ''}

            ${isStaff ? `
            <div class="form-group">
              <label for="staffRole">Login as</label>
              <select class="form-select" id="staffRole">
                <option value="teacher">Class Teacher</option>
                <option value="hod">HOD</option>
                <option value="warden">Warden</option>
                <option value="guard">Security / Gate</option>
                <option value="kitchen">Annakshetra (Kitchen)</option>
                <option value="admin">Admin Office</option>
              </select>
            </div>` : ''}

            <div class="form-group">
              <label for="authEmail">${isLogin && !isStaff ? 'Register Number or College Email' : 'College Email'}</label>
              <input class="form-input" id="authEmail" type="text" autocomplete="username"
                placeholder="${isLogin && !isStaff ? 'Register number or name@cvv.ac.in' : 'name@cvv.ac.in'}" required>
            </div>
            <div class="form-group">
              <label for="authPass">Password</label>
              <input class="form-input" id="authPass" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" placeholder="${isLogin ? 'Password' : 'At least 6 characters'}" required>
            </div>
            ${isLogin ? `<div class="portal-row"><a href="#" onclick="event.preventDefault();showToast('Forgot password','Contact the hostel office to reset your password.','info')">Forgot password?</a></div>` : ''}

            <button type="submit" class="btn btn-primary btn-block btn-lg portal-submit">${isLogin ? 'Sign In' : 'Activate Account'}</button>
          </form>

          <div class="auth-link">
            ${isLogin
              ? (isStaff ? '' : 'First time here? <a href="#" onclick="event.preventDefault();renderAuth(\'register\')">Activate your account</a>')
              : 'Already activated? <a href="#" onclick="event.preventDefault();renderAuth(\'login\',\'student\')">Sign in</a>'}
          </div>

          ${isLogin ? `
          <details class="portal-demo">
            <summary>Demo accounts (password: pass123)</summary>
            <div class="portal-demo-grid">
              <button type="button" class="btn btn-ghost btn-sm" onclick="quickLogin('malapatisahasra162@gmail.com','student')">Student</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick="quickLogin('teacher@cvv.edu.in','teacher')">Teacher</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick="quickLogin('hod@cvv.edu.in','hod')">HOD</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick="quickLogin('warden@cvv.edu.in','warden')">Warden</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick="quickLogin('guard@cvv.edu.in','guard')">Guard</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick="quickLogin('kitchen@cvv.edu.in','kitchen')">Kitchen</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick="quickLogin('admin@cvv.edu.in','admin')">Admin</button>
            </div>
            ${window.OUTPASS_TUNNEL ? `<p class="portal-demo-note">Online demo: data is saved in this browser only.
              <a href="#" onclick="event.preventDefault();resetOutpassDemo()">Reset demo data</a></p>` : ''}
          </details>` : ''}
        </section>
      </main>

      <footer class="portal-foot">© Chinmaya Vishwa Vidyapeeth · Hostel Outpass Portal · For help, contact the hostel office</footer>
    </div>
  `);
}

function switchRoleTab(btn) {
  $$('.role-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
}

async function quickLogin(email, role) {
  renderAuth('login', role === 'student' ? 'student' : 'staff');
  if (role !== 'student') $('#staffRole').value = role;
  $('#authEmail').value = email;
  $('#authPass').value = 'pass123';
  await handleLogin();
}

async function handleLogin() {
  const email = $('#authEmail').value.trim().toLowerCase();
  const password = $('#authPass').value;
  const role = APP.authWho === 'staff' ? ($('#staffRole')?.value || 'teacher') : 'student';

  const r = await apiOrToast('POST', '/api/login', { email, password, role }, 'Login Failed');
  if (!r) return;

  APP.currentUser = r.user;
  APP.currentRole = r.role;
  await refreshDB();
  showToast('Welcome!', `Logged in as ${r.user.name}`, 'success');
  renderDashboard();
}

async function handleRegister() {
  const body = {
    regNo: $('#regNo').value.trim(),
    email: $('#authEmail').value.trim().toLowerCase(),
    password: $('#authPass').value,
  };
  const r = await apiOrToast('POST', '/api/register', body, 'Could not activate');
  if (!r) return;
  showToast(`Welcome, ${r.name}!`, `Account active. Outpass requests will go to ${r.parentName} (${r.parentPhone}). Wrong number? Tell the hostel office.`, 'success');
  renderAuth('login', 'student');
  $('#authEmail').value = body.regNo;
}

async function logout() {
  clearInterval(INBOX.timer);
  document.title = 'CVV Outpass';
  try { await api('POST', '/api/logout'); } catch (e) {}
  APP.currentUser = null;
  APP.currentRole = null;
  renderAuth('login', 'student');
}

// ═══════════════════════════════════════════════════════════════════
// 4. DASHBOARD LAYOUT
// ═══════════════════════════════════════════════════════════════════
function renderDashboard() {
  const nav = getNavItems();
  const user = APP.currentUser;
  const initials = user.name.split(' ').map(n => n[0]).join('').slice(0, 2);
  const roleBadge = APP.currentRole.charAt(0).toUpperCase() + APP.currentRole.slice(1);

  setPage(`
    <div class="app-layout">
      <!-- Sidebar -->
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <div class="sidebar-logo">C</div>
          <div class="sidebar-brand">
            <h2>CVV Outpass</h2>
            <span>Smart Management</span>
          </div>
        </div>
        <nav class="sidebar-nav">
          <div class="sidebar-section-label">Navigation</div>
          ${nav.map(item => `
            <a href="#" class="sidebar-link ${item.id === nav[0].id ? 'active' : ''}" data-page="${item.id}" onclick="navigateTo('${item.id}', this)">
              <span class="icon">${item.icon}</span>
              <span>${item.label}</span>
              ${item.badge ? `<span class="badge">${item.badge}</span>` : ''}
            </a>
          `).join('')}
        </nav>
        <div class="sidebar-footer">
          <div class="sidebar-user" onclick="logout()">
            <div class="sidebar-avatar">${initials}</div>
            <div class="sidebar-user-info">
              <div class="name">${user.name}</div>
              <div class="role">${roleBadge}</div>
            </div>
            <span style="color:var(--navy-400)">↪</span>
          </div>
        </div>
      </aside>

      <!-- Main -->
      <div class="main-content">
        <header class="top-header">
          <button class="menu-toggle" onclick="document.getElementById('sidebar').classList.toggle('open')">☰</button>
          <div class="header-title" id="headerTitle">
            <h1>${nav[0].label}</h1>
            <p>${getGreeting()}</p>
          </div>
          <div class="header-actions">
            <button class="notification-btn" id="bellBtn" onclick="showNotifications()" aria-label="Alerts">
              🔔
              <span class="bell-count" id="bellCount" hidden></span>
            </button>
          </div>
        </header>
        <div class="page-content" id="pageContent">
        </div>
      </div>
    </div>
    <div id="modal-root"></div>
  `);

  navigateTo(nav[0].id);
  startInbox();
  openDeepLink();
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning ☀️';
  if (h < 17) return 'Good afternoon 🌤️';
  return 'Good evening 🌙';
}

function getNavItems() {
  const pendingCount = APP.db.outpasses.filter(o => o.status === 'pending').length;
  const role = APP.currentRole;

  const items = {
    student: [
      { id: 'dashboard', icon: '📊', label: 'Dashboard' },
      { id: 'new-request', icon: '📝', label: 'New Request' },
      { id: 'my-passes', icon: '🎫', label: 'My Passes' },
      { id: 'my-pass-card', icon: '💳', label: 'Digital Pass' },
    ],
    teacher: [
      { id: 'dashboard', icon: '📊', label: 'Dashboard' },
      { id: 'pending-approvals', icon: '📋', label: 'Pending Approvals', badge: pendingCount || null },
      { id: 'all-requests', icon: '📁', label: 'All Requests' },
    ],
    hod: [
      { id: 'dashboard', icon: '📊', label: 'Dashboard' },
      { id: 'pending-approvals', icon: '📋', label: 'Pending Approvals', badge: pendingCount || null },
      { id: 'all-requests', icon: '📁', label: 'Department Requests' },
    ],
    warden: [
      { id: 'dashboard', icon: '📊', label: 'Dashboard' },
      { id: 'pending-approvals', icon: '📋', label: 'Approvals', badge: pendingCount || null },
      { id: 'active-outings', icon: '🚶', label: 'Active Outings' },
      { id: 'alerts', icon: '🚨', label: 'Alerts' },
      { id: 'all-requests', icon: '📁', label: 'All Requests' },
      { id: 'phone-approval', icon: '📞', label: 'Phone Approval' },
    ],
    guard: [
      { id: 'dashboard', icon: '📊', label: 'Dashboard' },
      { id: 'scanner', icon: '📷', label: 'QR Scanner' },
      { id: 'gate-log', icon: '📋', label: 'Gate Log' },
    ],
    kitchen: [
      { id: 'kitchen-count', icon: '🍽️', label: 'Meal Count' },
      { id: 'history', icon: '📊', label: 'History' },
    ],
    admin: [
      { id: 'dashboard', icon: '📊', label: 'Dashboard' },
      { id: 'manage-students', icon: '👥', label: 'Students' },
      { id: 'manage-calendar', icon: '📅', label: 'Calendar' },
      { id: 'upload-data', icon: '📤', label: 'Upload Data' },
      { id: 'all-requests', icon: '📁', label: 'All Requests' },
    ],
  };

  return items[role] || items.student;
}

async function navigateTo(pageId, linkEl) {
  APP.currentPage = pageId;
  try { await refreshDB(); } catch (e) { return; }
  if (APP.currentPage !== pageId) return;

  // Update active link
  $$('.sidebar-link').forEach(l => l.classList.remove('active'));
  if (linkEl) {
    linkEl.classList.add('active');
  } else {
    const link = $(`.sidebar-link[data-page="${pageId}"]`);
    if (link) link.classList.add('active');
  }

  // Update header
  const nav = getNavItems();
  const item = nav.find(n => n.id === pageId);
  if (item && $('#headerTitle')) {
    $('#headerTitle').innerHTML = `<h1>${item.label}</h1><p>${getGreeting()}</p>`;
  }

  // Render page
  const pageContent = $('#pageContent');
  if (!pageContent) return;

  const pages = {
    'dashboard': renderDashboardPage,
    'new-request': renderNewRequest,
    'my-passes': renderMyPasses,
    'my-pass-card': renderDigitalPass,
    'pending-approvals': renderPendingApprovals,
    'all-requests': renderAllRequests,
    'active-outings': renderActiveOutings,
    'alerts': renderAlerts,
    'phone-approval': renderPhoneApproval,
    'scanner': renderScanner,
    'gate-log': renderGateLog,
    'kitchen-count': renderKitchenCount,
    'history': renderKitchenHistory,
    'manage-students': renderManageStudents,
    'manage-calendar': renderManageCalendar,
    'upload-data': renderUploadData,
  };

  const renderer = pages[pageId];
  if (renderer) renderer();
}

// ═══════════════════════════════════════════════════════════════════
// 5. DASHBOARD PAGE (role-specific)
// ═══════════════════════════════════════════════════════════════════
function renderDashboardPage() {
  const role = APP.currentRole;

  if (role === 'student') renderStudentDashboard();
  else if (role === 'teacher') renderStaffDashboard('Teacher');
  else if (role === 'hod') renderStaffDashboard('HOD');
  else if (role === 'warden') renderWardenDashboard();
  else if (role === 'guard') renderGuardDashboard();
  else if (role === 'admin') renderAdminDashboard();
}

function renderStudentDashboard() {
  const myPasses = APP.db.outpasses.filter(o => o.studentId === APP.currentUser.id);
  const pending = myPasses.filter(o => o.status === 'pending').length;
  const approved = myPasses.filter(o => o.status === 'approved').length;
  const active = myPasses.filter(o => o.status === 'active').length;

  $('#pageContent').innerHTML = `
    <div class="stagger">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon blue">📝</div>
          <div class="stat-info">
            <div class="stat-value">${myPasses.length}</div>
            <div class="stat-label">Total Requests</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon amber">⏳</div>
          <div class="stat-info">
            <div class="stat-value">${pending}</div>
            <div class="stat-label">Pending</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">✅</div>
          <div class="stat-info">
            <div class="stat-value">${approved}</div>
            <div class="stat-label">Approved</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon purple">🚶</div>
          <div class="stat-info">
            <div class="stat-value">${active}</div>
            <div class="stat-label">Active Outings</div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="card" style="cursor:pointer" onclick="navigateTo('new-request')">
          <div class="card-body" style="text-align:center;padding:32px;">
            <div style="font-size:2.5rem;margin-bottom:12px;">📝</div>
            <h3 style="font-size:1rem;font-weight:700;margin-bottom:4px;">Request New Pass</h3>
            <p style="font-size:0.8rem;color:var(--text-secondary);">Create a holiday, working day, or emergency outpass request</p>
          </div>
        </div>
        <div class="card" style="cursor:pointer" onclick="navigateTo('my-pass-card')">
          <div class="card-body" style="text-align:center;padding:32px;">
            <div style="font-size:2.5rem;margin-bottom:12px;">💳</div>
            <h3 style="font-size:1rem;font-weight:700;margin-bottom:4px;">Digital Pass</h3>
            <p style="font-size:0.8rem;color:var(--text-secondary);">View your QR outpass card for the guard to scan</p>
          </div>
        </div>
      </div>

      ${myPasses.length > 0 ? `
      <div class="card" style="margin-top:16px;">
        <div class="card-header">
          <h3>Recent Requests</h3>
          <button class="btn btn-ghost btn-sm" onclick="navigateTo('my-passes')">View All →</button>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-wrapper">
            <table>
              <thead>
                <tr><th>ID</th><th>Date</th><th>Type</th><th>Reason</th><th>Status</th></tr>
              </thead>
              <tbody>
                ${myPasses.slice(-5).reverse().map(p => `
                  <tr>
                    <td><code style="font-family:'JetBrains Mono';font-size:0.75rem;">${p.passId}</code></td>
                    <td>${formatDate(p.outDate)}</td>
                    <td><span class="badge badge-${p.type}">${capitalize(p.type)}</span></td>
                    <td>${truncate(p.reason, 30)}</td>
                    <td><span class="badge badge-${p.status}">${capitalize(p.status)}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      ` : `
      <div class="card" style="margin-top:16px;">
        <div class="empty-state">
          <div class="empty-icon">🎫</div>
          <h3>No requests yet</h3>
          <p>Create your first outpass request to get started.</p>
          <button class="btn btn-primary" style="margin-top:16px" onclick="navigateTo('new-request')">📝 New Request</button>
        </div>
      </div>
      `}
    </div>
  `;
}

function renderStaffDashboard(roleLabel) {
  const dept = APP.currentUser.department;
  const relevant = APP.db.outpasses.filter(o => {
    const stu = APP.db.students.find(s => s.id === o.studentId);
    return stu && stu.branch === dept;
  });

  const pending = relevant.filter(o => {
    if (APP.currentRole === 'teacher') return o.approvals.teacher === 'pending';
    if (APP.currentRole === 'hod') return o.approvals.hod === 'pending' && (o.type === 'emergency' || o.approvals.teacher === 'approved');
    return false;
  }).length;

  const todayOut = relevant.filter(o => o.status === 'active').length;

  $('#pageContent').innerHTML = `
    <div class="stagger">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon amber">📋</div>
          <div class="stat-info">
            <div class="stat-value">${pending}</div>
            <div class="stat-label">Pending Your Approval</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon blue">📁</div>
          <div class="stat-info">
            <div class="stat-value">${relevant.length}</div>
            <div class="stat-label">Total ${dept} Requests</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">🚶</div>
          <div class="stat-info">
            <div class="stat-value">${todayOut}</div>
            <div class="stat-label">Currently Out</div>
          </div>
        </div>
      </div>

      ${pending > 0 ? `
      <div class="info-banner warning">
        <span class="banner-icon">⚠️</span>
        <div>You have <strong>${pending}</strong> pending approval(s) that need your attention. <a href="#" onclick="navigateTo('pending-approvals')">Review now →</a></div>
      </div>
      ` : `
      <div class="info-banner success">
        <span class="banner-icon">✅</span>
        <div>All caught up! No pending approvals at the moment.</div>
      </div>
      `}

      <div class="card">
        <div class="card-header">
          <h3>Recent ${dept} Requests</h3>
        </div>
        <div class="card-body" style="padding:0;">
          ${relevant.length > 0 ? `
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Student</th><th>Date</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                ${relevant.slice(-5).reverse().map(p => {
                  const stu = APP.db.students.find(s => s.id === p.studentId);
                  return `<tr>
                    <td><strong>${stu?.name}</strong><br><span style="font-size:0.7rem;color:var(--text-muted)">${stu?.regNo}</span></td>
                    <td>${formatDate(p.outDate)}</td>
                    <td><span class="badge badge-${p.type}">${capitalize(p.type)}</span></td>
                    <td><span class="badge badge-${p.status}">${capitalize(p.status)}</span></td>
                    <td><button class="btn btn-ghost btn-sm" onclick="viewRequestDetail('${p.passId}')">View</button></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
          ` : '<div class="empty-state"><div class="empty-icon">📋</div><h3>No requests</h3></div>'}
        </div>
      </div>
    </div>
  `;
}

function renderWardenDashboard() {
  const all = APP.db.outpasses;
  const active = all.filter(o => o.status === 'active');
  const pendingWarden = all.filter(o => o.approvals.warden === 'pending').length;
  const lateReturns = active.filter(o => o.lateReturn);
  const todayApproved = all.filter(o => o.status === 'approved' && o.outDate === getTodayStr()).length;

  $('#pageContent').innerHTML = `
    <div class="stagger">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon purple">🚶</div>
          <div class="stat-info">
            <div class="stat-value">${active.length}</div>
            <div class="stat-label">Currently Out</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon amber">⏳</div>
          <div class="stat-info">
            <div class="stat-value">${pendingWarden}</div>
            <div class="stat-label">Pending Your Decision</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon red">🚨</div>
          <div class="stat-info">
            <div class="stat-value">${lateReturns.length}</div>
            <div class="stat-label">Late Returns</div>
            ${lateReturns.length > 0 ? '<div class="stat-trend down">⚠️ Needs attention</div>' : ''}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">✅</div>
          <div class="stat-info">
            <div class="stat-value">${todayApproved}</div>
            <div class="stat-label">Today's Passes</div>
          </div>
        </div>
      </div>

      ${lateReturns.length > 0 ? `
      <div class="card" style="margin-bottom:16px;">
        <div class="card-header" style="background:rgba(239,68,68,0.05);">
          <h3 style="color:var(--danger);">🚨 Late Return Alerts</h3>
        </div>
        <div class="card-body">
          ${lateReturns.map(p => {
            const stu = APP.db.students.find(s => s.id === p.studentId);
            return `
            <div class="alert-card">
              <span class="alert-icon">🚨</span>
              <div class="alert-body">
                <h4>${stu?.name} — ${stu?.regNo}</h4>
                <p>Left at ${p.exitTime || 'Unknown'} | Expected by 6:00 PM | Parent: ${stu?.parentPhone}</p>
              </div>
              <button class="btn btn-danger btn-sm" onclick="simulateWhatsAppAlert('${stu?.parentPhone}', '${stu?.name}')">Alert Parent</button>
            </div>`;
          }).join('')}
        </div>
      </div>
      ` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="card">
          <div class="card-header"><h3>10 PM Cutoff Status</h3></div>
          <div class="card-body" style="text-align:center;">
            <div class="countdown-display" id="cutoffCountdown">--:--:--</div>
            <div class="countdown-label">Time until cutoff</div>
            <p style="font-size:0.8rem;color:var(--text-secondary);margin-top:12px;">Holiday requests approved after 10 PM require your decision.</p>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Quick Actions</h3></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:10px;">
            <button class="btn btn-primary btn-block" onclick="navigateTo('pending-approvals')">📋 Review Pending (${pendingWarden})</button>
            <button class="btn btn-outline btn-block" onclick="navigateTo('active-outings')">🚶 Active Outings (${active.length})</button>
            <button class="btn btn-outline btn-block" onclick="navigateTo('phone-approval')">📞 Record Phone Approval</button>
            <button class="btn btn-outline btn-block" onclick="sendWardenWhatsAppList()">📲 Send WhatsApp List</button>
          </div>
        </div>
      </div>
    </div>
  `;

  startCutoffCountdown();
}

function renderGuardDashboard() {
  const active = APP.db.outpasses.filter(o => o.status === 'active');
  const todayScans = APP.db.outpasses.filter(o => o.exitTime && o.outDate === getTodayStr());

  $('#pageContent').innerHTML = `
    <div class="stagger">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon purple">🚶</div>
          <div class="stat-info">
            <div class="stat-value">${active.length}</div>
            <div class="stat-label">Currently Out</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">📷</div>
          <div class="stat-info">
            <div class="stat-value">${todayScans.length}</div>
            <div class="stat-label">Today's Scans</div>
          </div>
        </div>
      </div>

      <div class="card" style="cursor:pointer" onclick="navigateTo('scanner')">
        <div class="card-body" style="text-align:center;padding:40px;">
          <div style="font-size:3rem;margin-bottom:16px;">📷</div>
          <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:6px;">Scan QR Code</h3>
          <p style="font-size:0.85rem;color:var(--text-secondary);">Tap to open the scanner and verify student outpasses</p>
          <button class="btn btn-primary btn-lg" style="margin-top:16px;">Open Scanner</button>
        </div>
      </div>
    </div>
  `;
}

function renderAdminDashboard() {
  const totalStudents = APP.db.students.length;
  const totalStaff = APP.db.staff.length;
  const totalPasses = APP.db.outpasses.length;
  const holidays = APP.db.holidays.length;

  $('#pageContent').innerHTML = `
    <div class="stagger">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon blue">👥</div>
          <div class="stat-info">
            <div class="stat-value">${totalStudents}</div>
            <div class="stat-label">Registered Students</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">👩‍🏫</div>
          <div class="stat-info">
            <div class="stat-value">${totalStaff}</div>
            <div class="stat-label">Staff Members</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon amber">🎫</div>
          <div class="stat-info">
            <div class="stat-value">${totalPasses}</div>
            <div class="stat-label">Total Outpasses</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon red">📅</div>
          <div class="stat-info">
            <div class="stat-value">${holidays}</div>
            <div class="stat-label">Holidays Set</div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="card" style="cursor:pointer" onclick="navigateTo('upload-data')">
          <div class="card-body" style="text-align:center;padding:32px;">
            <div style="font-size:2rem;margin-bottom:12px;">📤</div>
            <h3>Upload Student Data</h3>
            <p style="font-size:0.8rem;color:var(--text-secondary)">Upload parent phone numbers from admission records</p>
          </div>
        </div>
        <div class="card" style="cursor:pointer" onclick="navigateTo('manage-calendar')">
          <div class="card-body" style="text-align:center;padding:32px;">
            <div style="font-size:2rem;margin-bottom:12px;">📅</div>
            <h3>Manage Calendar</h3>
            <p style="font-size:0.8rem;color:var(--text-secondary)">Set holidays for automatic outpass type detection</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
// 6. STUDENT — NEW REQUEST
// ═══════════════════════════════════════════════════════════════════
function renderNewRequest() {
  const today = getTodayStr();
  const tomorrow = getDateStr(1);

  $('#pageContent').innerHTML = `
    <div class="card anim-fade-in" style="max-width:600px;">
      <div class="card-header">
        <h3>📝 New Outpass Request</h3>
      </div>
      <div class="card-body">
        <div class="info-banner info">
          <span class="banner-icon">ℹ️</span>
          <div>The system automatically detects the outpass type based on the academic calendar. You can also mark it as emergency.</div>
        </div>

        <form onsubmit="event.preventDefault(); submitOutpassRequest()">
          <div class="form-group">
            <label>Outing Date <span class="required">*</span></label>
            <input class="form-input" id="reqDate" type="date" min="${today}" value="${tomorrow}" required onchange="detectOutpassType()">
          </div>

          <div class="form-group">
            <label>Detected Type</label>
            <div id="detectedType" style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--gray-50);border-radius:var(--radius-md);">
              <span class="badge badge-holiday">Holiday</span>
              <span style="font-size:0.8rem;color:var(--text-secondary);">Checking calendar...</span>
            </div>
          </div>

          <div class="form-check">
            <input type="checkbox" id="isEmergency" onchange="toggleEmergency()">
            <label for="isEmergency">🚨 This is an emergency request</label>
          </div>

          <div class="form-group">
            <label>Reason <span class="required">*</span></label>
            <textarea class="form-input" id="reqReason" rows="3" placeholder="Explain why you need an outpass..." required style="resize:vertical;"></textarea>
          </div>

          <div class="form-group">
            <label>Parent Contact (read-only)</label>
            <input class="form-input" value="${APP.currentUser.parentPhone} — ${APP.currentUser.parentName}" disabled style="background:var(--gray-50);">
          </div>

          <div class="divider">Approval Flow Preview</div>
          <div id="approvalPreview" class="approval-timeline">
          </div>

          <button type="submit" class="btn btn-primary btn-block btn-lg" style="margin-top:24px;">
            🚀 Submit Request
          </button>
        </form>
      </div>
    </div>
  `;

  detectOutpassType();
}

function detectOutpassType() {
  const dateVal = $('#reqDate')?.value;
  if (!dateVal) return;

  const isHoliday = APP.db.holidays.includes(dateVal);
  const dayOfWeek = new Date(dateVal).getDay();
  const isSunday = dayOfWeek === 0;
  const isSaturday = dayOfWeek === 6;
  const isEmergency = $('#isEmergency')?.checked;

  let type, flow;

  if (isEmergency) {
    type = 'emergency';
    flow = [
      { label: 'Parent Approval', detail: 'OTP verification via WhatsApp/SMS' },
      { label: 'Class Teacher', detail: 'Notified simultaneously' },
      { label: 'HOD Approval', detail: 'Notified simultaneously' },
    ];
  } else if (isHoliday || isSunday || isSaturday) {
    type = 'holiday';
    flow = [
      { label: 'Parent Approval', detail: 'OTP verification via WhatsApp/SMS' },
      { label: 'Auto-generated', detail: 'Pass generated if approved before 10 PM' },
    ];
  } else {
    type = 'working';
    flow = [
      { label: 'Parent Approval', detail: 'OTP verification via WhatsApp/SMS' },
      { label: 'Class Teacher', detail: 'Sequential approval' },
      { label: 'HOD Approval', detail: 'Final approval' },
    ];
  }

  const typeDisplay = $('#detectedType');
  if (typeDisplay) {
    typeDisplay.innerHTML = `
      <span class="badge badge-${type}">${capitalize(type)}${type === 'holiday' && isSunday ? ' (Sunday)' : type === 'holiday' && isSaturday ? ' (Saturday)' : ''}</span>
      <span style="font-size:0.8rem;color:var(--text-secondary);">
        ${type === 'holiday' ? 'Only parent approval needed' : type === 'working' ? 'Sequential: Parent → Teacher → HOD' : 'Parent + Teacher + HOD (simultaneous)'}
      </span>
    `;
  }

  const preview = $('#approvalPreview');
  if (preview) {
    preview.innerHTML = flow.map((step, i) => `
      <div class="timeline-step" style="animation-delay:${i * 0.1}s">
        <div class="timeline-dot pending">${i + 1}</div>
        <div class="timeline-content">
          <h4>${step.label}</h4>
          <p>${step.detail}</p>
        </div>
      </div>
    `).join('');
  }
}

function toggleEmergency() {
  detectOutpassType();
}

async function submitOutpassRequest() {
  const dateVal = $('#reqDate').value;
  const reason = $('#reqReason').value.trim();
  const isEmergency = $('#isEmergency').checked;

  if (!dateVal || !reason) {
    showToast('Error', 'Please fill in all fields', 'error');
    return;
  }

  const r = await apiOrToast('POST', '/api/outpasses', { outDate: dateVal, reason, emergency: isEmergency });
  if (!r) return;
  await refreshDB();

  showToast('Request Submitted!', `Outpass ${r.outpass.passId} created. Parent notification sent.`, 'success');

  // Show WhatsApp simulation
  showParentWhatsAppSim(r.outpass);
}

// ═══════════════════════════════════════════════════════════════════
// 7. PARENT WHATSAPP & OTP SIMULATION
// ═══════════════════════════════════════════════════════════════════
function showParentWhatsAppSim(outpass) {
  const student = APP.db.students.find(s => s.id === outpass.studentId) || APP.currentUser;
  const modal = document.getElementById('modal-root');
  const d = new Date(outpass.outDate + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  modal.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:420px;">
        <div class="modal-header">
          <h3>📲 What your parent receives</h3>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body" style="padding:0;">
          <div class="whatsapp-sim">
            <div class="wa-header">
              <div class="wa-avatar">🎓</div>
              <div class="wa-header-info"><h4>CVV Hostel</h4><span>to ${student.parentName} · ${student.parentPhone}</span></div>
            </div>
            <div class="wa-messages" id="waMessages">
              <div class="wa-msg received" style="animation:fadeIn 0.3s ease 0.2s both">
                CVV Hostel: <strong>${student.name}</strong> wants to go out on <strong>${d}</strong>.<br>
                Reason: ${outpass.reason}<br><br>
                Reply <strong>1</strong> to ALLOW<br>
                Reply <strong>2</strong> to NOT ALLOW<br><br>
                Or tap: <a href="${outpass.parentLink}" target="_blank" rel="noopener">${location.host}${outpass.parentLink}</a>
                <div class="wa-time">${formatTime(new Date())}</div>
              </div>
            </div>
            <div class="wa-actions" style="flex-wrap:wrap;">
              <p style="width:100%;margin:0 0 8px;font-size:0.75rem;color:var(--text-secondary);">Demo — act as the parent:</p>
              <button class="btn btn-success btn-sm" onclick="simulateParentReply('${outpass.passId}','1')">Reply "1"</button>
              <button class="btn btn-danger btn-sm" onclick="simulateParentReply('${outpass.passId}','2')">Reply "2"</button>
              <a class="btn btn-outline btn-sm" href="${outpass.parentLink}" target="_blank" rel="noopener">Open parent page ↗</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Demo of the parent answering by WhatsApp/SMS reply (the server webhook /api/inbound).
async function simulateParentReply(passId, text) {
  const student = APP.db.students.find(s => s.id === APP.currentUser.id) || APP.currentUser;
  const r = await apiOrToast('POST', '/api/inbound', { from: student.parentPhone, text });
  if (!r) return;
  const box = document.getElementById('waMessages');
  if (box) box.insertAdjacentHTML('beforeend', `
    <div class="wa-msg sent" style="margin-left:auto;">${text}<div class="wa-time">${formatTime(new Date())} ✓✓</div></div>
    <div class="wa-msg received">${r.reply}<div class="wa-time">${formatTime(new Date())}</div></div>`);
  await refreshDB();
  pollInbox();
  if (r.outpass) showToast(r.outpass.status === 'approved' ? 'Pass Approved!' : (text === '1' ? 'Parent allowed' : 'Parent did not allow'),
    r.outpass.status === 'approved' ? 'Your outpass is ready.' : r.reply, r.outpass.status === 'rejected' ? 'error' : 'success');
}













// ═══════════════════════════════════════════════════════════════════
// 8. MY PASSES (Student)
// ═══════════════════════════════════════════════════════════════════
function renderMyPasses() {
  const myPasses = APP.db.outpasses.filter(o => o.studentId === APP.currentUser.id);

  $('#pageContent').innerHTML = `
    <div class="anim-fade-in">
      <div class="card">
        <div class="card-header">
          <h3>My Outpass Requests</h3>
          <button class="btn btn-primary btn-sm" onclick="navigateTo('new-request')">+ New Request</button>
        </div>
        <div class="card-body" style="padding:0;">
          ${myPasses.length > 0 ? `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr><th>Pass ID</th><th>Date</th><th>Type</th><th>Reason</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                ${myPasses.map(p => `
                  <tr>
                    <td><code style="font-family:'JetBrains Mono';font-size:0.75rem;">${p.passId}</code></td>
                    <td>${formatDate(p.outDate)}</td>
                    <td><span class="badge badge-${p.type}">${capitalize(p.type)}</span></td>
                    <td style="max-width:200px;">${truncate(p.reason, 40)}</td>
                    <td><span class="badge badge-${p.status}">${capitalize(p.status)}</span></td>
                    <td>
                      <button class="btn btn-ghost btn-sm" onclick="viewRequestDetail('${p.passId}')">View</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : `
          <div class="empty-state">
            <div class="empty-icon">🎫</div>
            <h3>No requests yet</h3>
            <p>Your outpass requests will appear here.</p>
          </div>
          `}
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
// 9. REQUEST DETAIL VIEW (with approval timeline)
// ═══════════════════════════════════════════════════════════════════
function viewRequestDetail(passId) {
  const outpass = APP.db.outpasses.find(o => o.passId === passId);
  if (!outpass) return;

  const student = APP.db.students.find(s => s.id === outpass.studentId);
  const modal = document.getElementById('modal-root');

  const approvalSteps = buildApprovalSteps(outpass);

  modal.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:560px;">
        <div class="modal-header">
          <h3>Outpass Detail — ${outpass.passId}</h3>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="pass-card" style="margin-bottom:20px;">
            <div class="pass-card-header">
              <span class="college">Chinmaya Vishwavidyapeeth</span>
              <span class="pass-id">${outpass.passId}</span>
            </div>
            <div class="pass-card-body">
              <div class="student-name">${student?.name}</div>
              <div class="student-reg">${student?.regNo} • ${student?.branch} • Sem ${student?.semester}</div>
            </div>
            <div class="pass-card-info">
              <div class="info-item"><label>Date</label><span>${formatDate(outpass.outDate)}</span></div>
              <div class="info-item"><label>Type</label><span>${capitalize(outpass.type)}</span></div>
              <div class="info-item"><label>Reason</label><span>${outpass.reason}</span></div>
              <div class="info-item"><label>Status</label><span>${capitalize(outpass.status)}</span></div>
            </div>
            <div class="pass-card-footer">
              <div style="font-size:0.75rem;color:var(--navy-200);">
                Created: ${formatDateTime(outpass.createdAt)}
              </div>
              <span class="pass-status-stamp ${outpass.status}">${outpass.status.toUpperCase()}</span>
            </div>
          </div>

          <h4 style="font-size:0.9rem;font-weight:700;margin-bottom:12px;">Approval Timeline</h4>
          <div class="approval-timeline">
            ${approvalSteps.map((step, i) => `
              <div class="timeline-step">
                <div class="timeline-dot ${step.state}">${step.state === 'approved' ? '✓' : step.state === 'rejected' ? '✕' : step.state === 'active' ? '⏳' : (i+1)}</div>
                <div class="timeline-content">
                  <h4>${step.label}</h4>
                  <p>${step.detail}</p>
                  ${step.time ? `<span class="time">${step.time}</span>` : ''}
                </div>
              </div>
            `).join('')}
          </div>

          ${canApproveRequest(outpass) ? `
          <div style="display:flex;gap:10px;margin-top:20px;">
            <button class="btn btn-success btn-block" onclick="approveRequest('${passId}')">✅ Approve</button>
            <button class="btn btn-danger btn-block" onclick="rejectRequest('${passId}')">❌ Reject</button>
          </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function buildApprovalSteps(outpass) {
  const steps = [];

  // Parent
  const parentState = outpass.approvals.parent === 'approved' ? 'approved'
    : outpass.approvals.parent === 'rejected' ? 'rejected'
    : 'active';
  steps.push({
    label: 'Parent Approval',
    detail: parentState === 'approved' ? 'Approved via OTP' : parentState === 'rejected' ? 'Rejected' : 'Awaiting parent response via WhatsApp/SMS',
    state: parentState,
    time: outpass.approvals.parentTime ? formatDateTime(outpass.approvals.parentTime) : null,
  });

  if (outpass.type !== 'holiday') {
    // Teacher
    const teacherState = outpass.approvals.teacher === 'approved' ? 'approved'
      : outpass.approvals.teacher === 'rejected' ? 'rejected'
      : (outpass.type === 'emergency' || outpass.approvals.parent === 'approved') ? 'active' : 'pending';
    steps.push({
      label: 'Class Teacher',
      detail: teacherState === 'approved' ? 'Approved' : teacherState === 'rejected' ? 'Rejected' : outpass.type === 'emergency' ? 'Notified simultaneously' : 'Sequential approval pending',
      state: teacherState,
      time: outpass.approvals.teacherTime ? formatDateTime(outpass.approvals.teacherTime) : null,
    });

    // HOD
    const hodState = outpass.approvals.hod === 'approved' ? 'approved'
      : outpass.approvals.hod === 'rejected' ? 'rejected'
      : (outpass.type === 'emergency' || outpass.approvals.teacher === 'approved') ? 'active' : 'pending';
    steps.push({
      label: 'HOD',
      detail: hodState === 'approved' ? 'Approved' : hodState === 'rejected' ? 'Rejected' : outpass.type === 'emergency' ? 'Notified simultaneously' : 'Waiting for teacher approval first',
      state: hodState,
      time: outpass.approvals.hodTime ? formatDateTime(outpass.approvals.hodTime) : null,
    });
  }

  if (outpass.approvals.warden !== 'na') {
    const wardenState = outpass.approvals.warden === 'approved' ? 'approved'
      : outpass.approvals.warden === 'rejected' ? 'rejected' : 'active';
    steps.push({
      label: 'Warden',
      detail: wardenState === 'approved' ? 'Approved' : wardenState === 'rejected' ? 'Rejected' : 'After 10 PM cutoff — warden decision required',
      state: wardenState,
      time: outpass.approvals.wardenTime ? formatDateTime(outpass.approvals.wardenTime) : null,
    });
  }

  return steps;
}

function canApproveRequest(outpass) {
  if (outpass.status === 'rejected') return false;

  const role = APP.currentRole;

  if (role === 'teacher') {
    if (outpass.approvals.teacher !== 'pending') return false;
    if (outpass.type === 'emergency') return outpass.approvals.parent !== 'rejected';
    return outpass.approvals.parent === 'approved';
  }

  if (role === 'hod') {
    if (outpass.approvals.hod !== 'pending') return false;
    if (outpass.type === 'emergency') return outpass.approvals.parent !== 'rejected';
    return outpass.approvals.teacher === 'approved';
  }

  if (role === 'warden') {
    if (outpass.approvals.warden === 'pending') return true;
    // Emergency override
    if (outpass.type === 'emergency' && outpass.status === 'pending') {
      const created = new Date(outpass.createdAt);
      const hoursWaiting = (Date.now() - created.getTime()) / (1000 * 60 * 60);
      if (hoursWaiting >= 2 && outpass.status !== 'rejected') return true;
    }
    return false;
  }

  return false;
}

async function approveRequest(passId) {
  const r = await apiOrToast('POST', `/api/outpasses/${passId}/decision`, { action: 'approve' });
  if (!r) return;
  if (r.outpass.status === 'approved') {
    showToast('Fully Approved!', 'All approvals complete. Outpass generated.', 'success');
  } else {
    showToast('Approved!', `${APP.currentRole === 'hod' ? 'HOD' : capitalize(APP.currentRole)} approval recorded`, 'success');
  }
  closeModal();
  navigateTo(APP.currentPage);
}

async function rejectRequest(passId) {
  const r = await apiOrToast('POST', `/api/outpasses/${passId}/decision`, { action: 'reject' });
  if (!r) return;
  showToast('Rejected', 'The outpass request has been rejected.', 'error');
  closeModal();
  navigateTo(APP.currentPage);
}

// ═══════════════════════════════════════════════════════════════════
// 10. PENDING APPROVALS (Teacher / HOD / Warden)
// ═══════════════════════════════════════════════════════════════════
function renderPendingApprovals() {
  const role = APP.currentRole;
  let pending = [];

  APP.db.outpasses.forEach(o => {
    if (o.status === 'rejected') return;
    const stu = APP.db.students.find(s => s.id === o.studentId);

    if (role === 'teacher' && o.approvals.teacher === 'pending' && stu?.branch === APP.currentUser.department) {
      if (o.type === 'emergency' || o.approvals.parent === 'approved') {
        pending.push({ ...o, student: stu });
      }
    }

    if (role === 'hod' && o.approvals.hod === 'pending' && stu?.branch === APP.currentUser.department) {
      if (o.type === 'emergency' || o.approvals.teacher === 'approved') {
        pending.push({ ...o, student: stu });
      }
    }

    if (role === 'warden' && o.approvals.warden === 'pending') {
      pending.push({ ...o, student: stu });
    }
  });

  $('#pageContent').innerHTML = `
    <div class="anim-fade-in">
      ${pending.length > 0 ? `
      <div class="info-banner warning">
        <span class="banner-icon">⚠️</span>
        <div>You have <strong>${pending.length}</strong> request(s) awaiting your approval.</div>
      </div>
      ` : ''}

      <div class="card">
        <div class="card-header">
          <h3>Pending Approvals</h3>
          <span class="badge badge-pending">${pending.length} pending</span>
        </div>
        <div class="card-body" style="padding:0;">
          ${pending.length > 0 ? `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr><th>Student</th><th>Date</th><th>Type</th><th>Reason</th><th>Actions</th></tr>
              </thead>
              <tbody>
                ${pending.map(p => `
                  <tr>
                    <td>
                      <strong>${p.student?.name}</strong><br>
                      <span style="font-size:0.7rem;color:var(--text-muted)">${p.student?.regNo} • ${p.student?.branch}</span>
                    </td>
                    <td>${formatDate(p.outDate)}</td>
                    <td><span class="badge badge-${p.type}">${capitalize(p.type)}</span></td>
                    <td style="max-width:200px;">${truncate(p.reason, 35)}</td>
                    <td>
                      <div style="display:flex;gap:6px;">
                        <button class="btn btn-success btn-sm" onclick="approveRequest('${p.passId}')">✅</button>
                        <button class="btn btn-danger btn-sm" onclick="rejectRequest('${p.passId}')">❌</button>
                        <button class="btn btn-ghost btn-sm" onclick="viewRequestDetail('${p.passId}')">👁</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ` : `
          <div class="empty-state">
            <div class="empty-icon">✅</div>
            <h3>All caught up!</h3>
            <p>No pending approvals at the moment.</p>
          </div>
          `}
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
// 11. ALL REQUESTS
// ═══════════════════════════════════════════════════════════════════
function renderAllRequests() {
  let requests = APP.db.outpasses;

  if (APP.currentRole === 'teacher' || APP.currentRole === 'hod') {
    const dept = APP.currentUser.department;
    requests = requests.filter(o => {
      const stu = APP.db.students.find(s => s.id === o.studentId);
      return stu && stu.branch === dept;
    });
  }

  $('#pageContent').innerHTML = `
    <div class="anim-fade-in">
      <div class="card">
        <div class="card-header">
          <h3>All Requests</h3>
          <div class="filter-bar">
            <button class="filter-chip active" onclick="filterRequests('all', this)">All</button>
            <button class="filter-chip" onclick="filterRequests('pending', this)">Pending</button>
            <button class="filter-chip" onclick="filterRequests('approved', this)">Approved</button>
            <button class="filter-chip" onclick="filterRequests('rejected', this)">Rejected</button>
            <button class="filter-chip" onclick="filterRequests('active', this)">Active</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;" id="requestsTableBody">
          ${renderRequestsTable(requests)}
        </div>
      </div>
    </div>
  `;
}

function renderRequestsTable(requests) {
  if (requests.length === 0) {
    return '<div class="empty-state"><div class="empty-icon">📋</div><h3>No requests found</h3></div>';
  }

  return `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr><th>Pass ID</th><th>Student</th><th>Date</th><th>Type</th><th>Reason</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          ${requests.map(p => {
            const stu = APP.db.students.find(s => s.id === p.studentId);
            return `
              <tr data-status="${p.status}">
                <td><code style="font-family:'JetBrains Mono';font-size:0.7rem;">${p.passId}</code></td>
                <td><strong>${stu?.name || 'Unknown'}</strong><br><span style="font-size:0.7rem;color:var(--text-muted)">${stu?.regNo || ''}</span></td>
                <td>${formatDate(p.outDate)}</td>
                <td><span class="badge badge-${p.type}">${capitalize(p.type)}</span></td>
                <td style="max-width:150px;">${truncate(p.reason, 25)}</td>
                <td><span class="badge badge-${p.status}">${capitalize(p.status)}</span></td>
                <td><button class="btn btn-ghost btn-sm" onclick="viewRequestDetail('${p.passId}')">View</button></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function filterRequests(status, btn) {
  $$('.filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');

  let requests = APP.db.outpasses;
  if (APP.currentRole === 'teacher' || APP.currentRole === 'hod') {
    const dept = APP.currentUser.department;
    requests = requests.filter(o => {
      const stu = APP.db.students.find(s => s.id === o.studentId);
      return stu && stu.branch === dept;
    });
  }

  if (status !== 'all') {
    requests = requests.filter(o => o.status === status);
  }

  const body = document.getElementById('requestsTableBody');
  if (body) body.innerHTML = renderRequestsTable(requests);
}

// ═══════════════════════════════════════════════════════════════════
// 12. DIGITAL PASS (QR)
// ═══════════════════════════════════════════════════════════════════
function renderDigitalPass() {
  const approved = APP.db.outpasses.filter(o =>
    o.studentId === APP.currentUser.id &&
    (o.status === 'approved' || o.status === 'active')
  );

  const latestPass = approved[approved.length - 1];

  if (!latestPass) {
    $('#pageContent').innerHTML = `
      <div class="card anim-fade-in">
        <div class="empty-state">
          <div class="empty-icon">💳</div>
          <h3>No Active Pass</h3>
          <p>You don't have an approved outpass. Request one to get your digital pass card.</p>
          <button class="btn btn-primary" style="margin-top:16px" onclick="navigateTo('new-request')">📝 Request Pass</button>
        </div>
      </div>
    `;
    return;
  }

  const student = APP.currentUser;

  $('#pageContent').innerHTML = `
    <div class="anim-fade-in" style="max-width:480px;margin:0 auto;">
      <div class="pass-card">
        <div class="pass-card-header">
          <span class="college">Chinmaya Vishwavidyapeeth</span>
          <span class="pass-id">${latestPass.passId}</span>
        </div>
        <div class="pass-card-body">
          <div class="student-name">${student.name}</div>
          <div class="student-reg">${student.regNo} • ${student.branch} • Semester ${student.semester}</div>
        </div>
        <div class="pass-card-info">
          <div class="info-item"><label>Outing Date</label><span>${formatDate(latestPass.outDate)}</span></div>
          <div class="info-item"><label>Type</label><span>${capitalize(latestPass.type)}</span></div>
          <div class="info-item"><label>Reason</label><span>${latestPass.reason}</span></div>
          <div class="info-item"><label>Status</label><span>${capitalize(latestPass.status)}</span></div>
        </div>
        <div class="pass-card-footer">
          <div class="pass-card-qr">
            <canvas id="qrCanvas"></canvas>
          </div>
          <span class="pass-status-stamp ${latestPass.status}">${latestPass.status.toUpperCase()}</span>
        </div>
      </div>

      <div style="text-align:center;margin-top:16px;">
        <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:12px;">
          Show this QR code to the gate guard for scanning
        </p>
        <button class="btn btn-outline" onclick="window.print()">🖨️ Print Pass</button>
      </div>
    </div>
  `;

  // Generate QR code (simple canvas pattern simulation)
  setTimeout(() => generateQRCode('qrCanvas', latestPass.qrToken), 100);
}

// ═══════════════════════════════════════════════════════════════════
// 13. GUARD — QR SCANNER
// ═══════════════════════════════════════════════════════════════════
function renderScanner() {
  $('#pageContent').innerHTML = `
    <div class="anim-fade-in" style="max-width:500px;margin:0 auto;">
      <div class="card">
        <div class="card-header"><h3>📷 QR Scanner</h3></div>
        <div class="card-body">
          <div class="scanner-view" id="scannerView">
            <div class="scanner-frame">
              <div class="corner tl"></div>
              <div class="corner tr"></div>
              <div class="corner bl"></div>
              <div class="corner br"></div>
              <div style="color:#666;font-size:0.85rem;">Camera Preview Area</div>
              <div class="scan-line"></div>
            </div>
            <p style="font-size:0.85rem;color:var(--text-secondary);margin-top:16px;">
              Point camera at the student's QR outpass code
            </p>
          </div>

          <div class="divider">Simulate Scan</div>

          <div class="form-group">
            <label>Enter Pass ID or Token</label>
            <div style="display:flex;gap:8px;">
              <input class="form-input" id="scanInput" placeholder="CVV-00001 or token">
              <button class="btn btn-primary" onclick="simulateScan()">Scan</button>
            </div>
          </div>

          ${APP.db.outpasses.filter(o => o.status === 'approved' || o.status === 'active').length > 0 ? `
          <div class="divider">Quick Scan (Active Passes)</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${APP.db.outpasses.filter(o => o.status === 'approved' || o.status === 'active').map(p => {
              const stu = APP.db.students.find(s => s.id === p.studentId);
              return `<button class="btn btn-outline btn-sm" onclick="document.getElementById('scanInput').value='${p.passId}';simulateScan();">${stu?.name} (${p.passId})</button>`;
            }).join('')}
          </div>
          ` : ''}

          <div id="scanResult"></div>
        </div>
      </div>
    </div>
  `;
}

async function simulateScan() {
  const input = $('#scanInput').value.trim();
  if (!input) {
    showToast('Error', 'Please enter a Pass ID or token', 'error');
    return;
  }

  const r = await apiOrToast('POST', '/api/scan', { code: input });
  if (!r) return;
  const resultDiv = document.getElementById('scanResult');
  const outpass = r.outpass;
  const student = r.student;
  const card = (icon, iconCls, title, color, body) => `
    <div class="scanner-result" style="margin-top:20px;">
      <div class="check-icon ${iconCls}">${icon}</div>
      <h3 style="color:${color};">${title}</h3>
      ${body}
    </div>`;

  if (r.result === 'invalid') {
    resultDiv.innerHTML = card('❌', 'danger', 'Invalid Pass', 'var(--danger)',
      '<p style="color:var(--text-secondary);">No outpass found with this ID or token.</p>');
    showToast('Invalid', 'No matching outpass found', 'error');
  } else if (r.result === 'exit') {
    resultDiv.innerHTML = card('✅', 'success', 'Exit Recorded', 'var(--success)', `
      <div style="margin-top:12px;text-align:left;font-size:0.85rem;">
        <p><strong>Student:</strong> ${student.name} (${student.regNo})</p>
        <p><strong>Time:</strong> ${outpass.exitTime}</p>
        <p><strong>Expected return:</strong> Before 6:00 PM</p>
      </div>`);
    showToast('Exit Recorded', `${student.name} has exited the campus`, 'success');
  } else if (r.result === 'late') {
    resultDiv.innerHTML = card('⚠️', 'danger', 'LATE RETURN', 'var(--danger)', `
      <div style="margin-top:12px;text-align:left;font-size:0.85rem;">
        <p><strong>Student:</strong> ${student.name} (${student.regNo})</p>
        <p><strong>Return time:</strong> ${outpass.returnTime}</p>
        <p style="color:var(--danger);font-weight:600;">⚠️ Alert sent to warden and parent</p>
      </div>`);
    showToast('🚨 Late Return!', `${student.name} returned after 6 PM. Warden & parent alerted.`, 'error');
  } else if (r.result === 'return') {
    resultDiv.innerHTML = card('✅', 'success', 'Return Recorded', 'var(--success)', `
      <div style="margin-top:12px;text-align:left;font-size:0.85rem;">
        <p><strong>Student:</strong> ${student.name} (${student.regNo})</p>
        <p><strong>Return time:</strong> ${outpass.returnTime}</p>
      </div>`);
    showToast('Return Recorded', `${student.name} has returned to campus`, 'success');
  } else if (r.result === 'wrong_date') {
    resultDiv.innerHTML = card('📅', 'danger', 'Not Valid Today', 'var(--warning)',
      `<p style="color:var(--text-secondary);">This pass is for ${formatDate(outpass.outDate)}.</p>`);
    showToast('Warning', 'Outpass is for a different date', 'warning');
  } else if (r.result === 'pending') {
    resultDiv.innerHTML = card('⏳', 'danger', 'Not Yet Approved', 'var(--warning)',
      '<p style="color:var(--text-secondary);">This outpass is still pending approval.</p>');
    showToast('Warning', 'Outpass not yet approved', 'warning');
  } else {
    resultDiv.innerHTML = card('ℹ️', 'danger', `Pass Status: ${capitalize(outpass.status)}`, 'inherit',
      `<p style="color:var(--text-secondary);">This pass has already been used or is ${outpass.status}.</p>`);
  }
  await refreshDB();
}

// ═══════════════════════════════════════════════════════════════════
// 14. GUARD — GATE LOG
// ═══════════════════════════════════════════════════════════════════
function renderGateLog() {
  const logged = APP.db.outpasses.filter(o => o.exitTime);

  $('#pageContent').innerHTML = `
    <div class="anim-fade-in">
      <div class="card">
        <div class="card-header"><h3>Gate Log</h3></div>
        <div class="card-body" style="padding:0;">
          ${logged.length > 0 ? `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr><th>Student</th><th>Pass ID</th><th>Exit</th><th>Return</th><th>Status</th></tr>
              </thead>
              <tbody>
                ${logged.map(p => {
                  const stu = APP.db.students.find(s => s.id === p.studentId);
                  return `
                  <tr>
                    <td><strong>${stu?.name}</strong></td>
                    <td><code>${p.passId}</code></td>
                    <td>${p.exitTime || '—'}</td>
                    <td>${p.returnTime || '<span class="badge badge-out">Still Out</span>'}</td>
                    <td>
                      ${p.lateReturn ? '<span class="badge badge-late">🚨 Late</span>'
                        : p.returnTime ? '<span class="badge badge-returned">Returned</span>'
                        : '<span class="badge badge-out">Out</span>'}
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
          ` : '<div class="empty-state"><div class="empty-icon">📋</div><h3>No gate log entries</h3></div>'}
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
// 15. WARDEN — ACTIVE OUTINGS
// ═══════════════════════════════════════════════════════════════════
function renderActiveOutings() {
  const active = APP.db.outpasses.filter(o => o.status === 'active');

  $('#pageContent').innerHTML = `
    <div class="anim-fade-in">
      <div class="info-banner info">
        <span class="banner-icon">ℹ️</span>
        <div><strong>${active.length}</strong> student(s) currently outside campus. Expected return by 6:00 PM.</div>
      </div>
      <div class="card">
        <div class="card-header"><h3>🚶 Currently Out</h3></div>
        <div class="card-body" style="padding:0;">
          ${active.length > 0 ? `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr><th>Student</th><th>Reg No</th><th>Exit Time</th><th>Type</th><th>Contact Parent</th></tr>
              </thead>
              <tbody>
                ${active.map(p => {
                  const stu = APP.db.students.find(s => s.id === p.studentId);
                  return `
                  <tr>
                    <td><strong>${stu?.name}</strong></td>
                    <td>${stu?.regNo}</td>
                    <td>${p.exitTime || '—'}</td>
                    <td><span class="badge badge-${p.type}">${capitalize(p.type)}</span></td>
                    <td>
                      <button class="btn btn-ghost btn-sm" onclick="simulateWhatsAppAlert('${stu?.parentPhone}','${stu?.name}')">📲 ${stu?.parentPhone}</button>
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
          ` : '<div class="empty-state"><div class="empty-icon">✅</div><h3>All students on campus</h3><p>No active outings right now.</p></div>'}
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
// 16. WARDEN — ALERTS
// ═══════════════════════════════════════════════════════════════════
function renderAlerts() {
  const lateReturns = APP.db.outpasses.filter(o => o.lateReturn);
  const emergencyPending = APP.db.outpasses.filter(o => {
    if (o.type !== 'emergency' || o.status === 'rejected' || o.status === 'approved') return false;
    const created = new Date(o.createdAt);
    return (Date.now() - created.getTime()) / (1000 * 60 * 60) >= 2;
  });

  const noParentReply = APP.db.outpasses.filter(o =>
    o.status === 'pending' && o.approvals.parent === 'pending'
  );

  $('#pageContent').innerHTML = `
    <div class="stagger">
      ${lateReturns.length > 0 ? `
      <div class="card">
        <div class="card-header" style="background:rgba(239,68,68,0.05);">
          <h3 style="color:var(--danger);">🚨 Late Returns</h3>
        </div>
        <div class="card-body">
          ${lateReturns.map(p => {
            const stu = APP.db.students.find(s => s.id === p.studentId);
            return `
            <div class="alert-card">
              <span class="alert-icon">🚨</span>
              <div class="alert-body">
                <h4>${stu?.name} (${stu?.regNo})</h4>
                <p>Returned at ${p.returnTime} — after 6 PM deadline</p>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      ` : ''}

      ${emergencyPending.length > 0 ? `
      <div class="card">
        <div class="card-header" style="background:rgba(245,158,11,0.05);">
          <h3 style="color:var(--warning);">⏰ Emergency — Over 2 Hours</h3>
          <span class="badge badge-emergency">${emergencyPending.length}</span>
        </div>
        <div class="card-body">
          <div class="info-banner warning">
            <span class="banner-icon">⚠️</span>
            <div>These emergency requests have been waiting over 2 hours. You can approve directly unless someone has already rejected.</div>
          </div>
          ${emergencyPending.map(p => {
            const stu = APP.db.students.find(s => s.id === p.studentId);
            return `
            <div class="alert-card" style="border-left-color:var(--warning);">
              <span class="alert-icon">⏰</span>
              <div class="alert-body">
                <h4>${stu?.name} — ${p.passId}</h4>
                <p>${p.reason}</p>
              </div>
              <button class="btn btn-success btn-sm" onclick="wardenEmergencyApprove('${p.passId}')">Approve</button>
            </div>`;
          }).join('')}
        </div>
      </div>
      ` : ''}

      ${noParentReply.length > 0 ? `
      <div class="card">
        <div class="card-header"><h3>📵 No Parent Reply</h3></div>
        <div class="card-body">
          ${noParentReply.map(p => {
            const stu = APP.db.students.find(s => s.id === p.studentId);
            return `
            <div class="alert-card" style="border-left-color:var(--info);">
              <span class="alert-icon">📵</span>
              <div class="alert-body">
                <h4>${stu?.name} — ${p.passId}</h4>
                <p>Parent: ${stu?.parentPhone} | Created: ${formatDateTime(p.createdAt)}</p>
              </div>
              <button class="btn btn-outline btn-sm" onclick="sendReminder('${p.passId}')">Send Reminder</button>
            </div>`;
          }).join('')}
        </div>
      </div>
      ` : ''}

      ${lateReturns.length === 0 && emergencyPending.length === 0 && noParentReply.length === 0 ? `
      <div class="card">
        <div class="empty-state">
          <div class="empty-icon">🎉</div>
          <h3>No Alerts</h3>
          <p>Everything is running smoothly. No late returns, overdue emergencies, or missing parent replies.</p>
        </div>
      </div>
      ` : ''}
    </div>
  `;
}

async function wardenEmergencyApprove(passId) {
  const r = await apiOrToast('POST', `/api/outpasses/${passId}/decision`, { action: 'approve' }, 'Cannot Approve');
  if (!r) return;
  showToast('Approved', `Emergency outpass ${passId} approved by warden.`, 'success');
  navigateTo('alerts');
}

async function sendReminder(passId) {
  const r = await apiOrToast('POST', `/api/outpasses/${passId}/remind`);
  if (r) showToast('Reminder Sent', 'A reminder has been sent to the parent via WhatsApp/SMS.', 'info');
}

// ═══════════════════════════════════════════════════════════════════
// 17. WARDEN — PHONE APPROVAL
// ═══════════════════════════════════════════════════════════════════
function renderPhoneApproval() {
  const pendingParent = APP.db.outpasses.filter(o =>
    o.status === 'pending' && o.approvals.parent === 'pending'
  );

  $('#pageContent').innerHTML = `
    <div class="anim-fade-in" style="max-width:600px;">
      <div class="card">
        <div class="card-header"><h3>📞 Record Phone Approval</h3></div>
        <div class="card-body">
          <div class="info-banner info">
            <span class="banner-icon">ℹ️</span>
            <div>For parents without smartphones, the warden can record a verbal phone approval here.</div>
          </div>

          ${pendingParent.length > 0 ? `
          <div class="form-group">
            <label>Select Request</label>
            <select class="form-select" id="phoneApprovalSelect">
              ${pendingParent.map(p => {
                const stu = APP.db.students.find(s => s.id === p.studentId);
                return `<option value="${p.passId}">${p.passId} — ${stu?.name} (${stu?.parentPhone})</option>`;
              }).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>Verbal Confirmation</label>
            <div class="form-check">
              <input type="checkbox" id="phoneConfirm">
              <label for="phoneConfirm">I confirm that I spoke to the parent on the phone and they verbally approved this outpass.</label>
            </div>
          </div>

          <button class="btn btn-primary btn-block" onclick="recordPhoneApproval()">📞 Record Approval</button>
          ` : `
          <div class="empty-state">
            <div class="empty-icon">✅</div>
            <h3>No pending parent approvals</h3>
            <p>All parent approvals are either completed or not needed.</p>
          </div>
          `}
        </div>
      </div>
    </div>
  `;
}

async function recordPhoneApproval() {
  const passId = $('#phoneApprovalSelect')?.value;
  const confirmed = $('#phoneConfirm')?.checked;

  if (!confirmed) {
    showToast('Error', 'Please confirm the verbal approval', 'error');
    return;
  }
  if (!passId) return;

  const r = await apiOrToast('POST', `/api/outpasses/${passId}/parent`, { action: 'approve', method: 'phone' });
  if (!r) return;
  await refreshDB();
  showToast('Recorded', r.outpass.approvals.warden === 'pending'
    ? 'Phone approval recorded — after cutoff, so it now needs your decision'
    : 'Phone approval recorded successfully', 'success');
  renderPhoneApproval();
}

// ═══════════════════════════════════════════════════════════════════
// 18. KITCHEN — MEAL COUNT
// ═══════════════════════════════════════════════════════════════════
function renderKitchenCount() {
  const totalStudents = APP.db.totalStudents;
  const lunchDate = getDateStr(1);
  const activeOut = APP.db.outpasses.filter(o => o.outDate === lunchDate && (o.status === 'active' || o.status === 'approved')).length;
  const eating = totalStudents - activeOut;
  const pct = Math.round((eating / totalStudents) * 100);

  const now = new Date();
  const cutoffPassed = now.getHours() >= 22;

  $('#pageContent').innerHTML = `
    <div class="stagger">
      <div class="info-banner ${cutoffPassed ? 'success' : 'warning'}">
        <span class="banner-icon">${cutoffPassed ? '✅' : '⏳'}</span>
        <div>
          ${cutoffPassed
            ? '<strong>Count is FINAL.</strong> 10 PM cutoff has passed. This is the confirmed count for tomorrow\'s lunch.'
            : '<strong>Count is LIVE.</strong> Numbers may change until 10 PM cutoff.'}
        </div>
      </div>

      <div class="card">
        <div class="card-body">
          <div class="kitchen-counter">
            <div class="counter-circle" style="--pct: ${pct}">
              <div class="count">${eating}</div>
              <div class="label">Eating in hostel</div>
            </div>
            <div class="kitchen-stats">
              <div class="kitchen-stat">
                <div class="value" style="color:var(--info);">${totalStudents}</div>
                <div class="label">Total Students</div>
              </div>
              <div class="kitchen-stat">
                <div class="value" style="color:var(--warning);">${activeOut}</div>
                <div class="label">Going Out</div>
              </div>
              <div class="kitchen-stat">
                <div class="value" style="color:var(--success);">${eating}</div>
                <div class="label">Eating In</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px;">
        <div class="card-header">
          <h3>Breakdown by Type</h3>
        </div>
        <div class="card-body">
          <div style="display:grid;gap:12px;">
            ${['holiday','working','emergency'].map(type => {
              const count = APP.db.outpasses.filter(o => o.type === type && (o.status === 'approved' || o.status === 'active')).length;
              return `
              <div style="display:flex;align-items:center;gap:12px;">
                <span class="badge badge-${type}" style="min-width:90px;justify-content:center;">${capitalize(type)}</span>
                <div class="progress-bar" style="flex:1;"><div class="fill" style="width:${totalStudents > 0 ? (count/totalStudents*100) : 0}%"></div></div>
                <strong style="font-size:0.85rem;min-width:30px;text-align:right;">${count}</strong>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderKitchenHistory() {
  const total = APP.db.totalStudents;
  const byDate = {};
  APP.db.outpasses.forEach(o => {
    if (['approved', 'active', 'completed'].includes(o.status)) byDate[o.outDate] = (byDate[o.outDate] || 0) + 1;
  });
  const tomorrow = getDateStr(1);
  if (!(tomorrow in byDate)) byDate[tomorrow] = 0;
  const dates = Object.keys(byDate).sort().reverse().slice(0, 14);
  const finalAt = d => { const c = new Date(d + 'T22:00:00'); c.setDate(c.getDate() - 1); return c; };

  $('#pageContent').innerHTML = `
    <div class="card anim-fade-in">
      <div class="card-header"><h3>📊 Historical Meal Counts</h3></div>
      <div class="card-body">
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Date</th><th>Total</th><th>Out</th><th>Eating</th><th>Status</th></tr></thead>
            <tbody>
              ${dates.map(d => `<tr><td>${formatDate(d)}</td><td>${total}</td><td>${byDate[d]}</td><td>${total - byDate[d]}</td>
                <td>${new Date() >= finalAt(d) ? '<span class="badge badge-approved">Final</span>' : '<span class="badge badge-active">Live</span>'}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
// 19. ADMIN — MANAGE STUDENTS
// ═══════════════════════════════════════════════════════════════════
// Siblings can share a parent number; anything else sharing one is worth a look by the office.
function sharedPhones(s) {
  const key = p => (p || '').replace(/\D/g, '').slice(-10);
  if (!key(s.parentPhone) || /x/i.test(s.parentPhone)) return [];
  return APP.db.students.filter(o => o.id !== s.id && key(o.parentPhone) === key(s.parentPhone));
}

function renderManageStudents() {
  $('#pageContent').innerHTML = `
    <div class="anim-fade-in">
      <div class="card">
        <div class="card-header">
          <h3>👥 Student Management</h3>
          <button class="btn btn-primary btn-sm" onclick="showAddStudentModal()">+ Add Student</button>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-wrapper">
            <table>
              <thead>
                <tr><th>Reg No</th><th>Name</th><th>Email</th><th>Branch</th><th>Sem</th><th>Parent Phone</th><th>Language</th><th>Account</th><th>Actions</th></tr>
              </thead>
              <tbody>
                ${APP.db.students.map(s => `
                  <tr>
                    <td><code>${s.regNo}</code></td>
                    <td>${s.name}</td>
                    <td>${s.email}</td>
                    <td>${s.branch}</td>
                    <td>${s.semester}</td>
                    <td>${s.parentPhone}${sharedPhones(s).length ? `<div class="shared-flag" title="Also parent number for: ${sharedPhones(s).map(x => x.name).join(', ')}">⚠ Same number as ${sharedPhones(s).map(x => x.name).join(', ')}</div>` : ''}</td>
                    <td>${s.activated ? '<span class="badge badge-approved">Active</span>' : '<span class="badge badge-pending">Not activated</span>'}</td>
                    <td>${({en:'English',ml:'Malayalam',hi:'Hindi',kn:'Kannada',te:'Telugu',ta:'Tamil'})[s.parentLang] || 'English'}</td>
                    <td>
                      <button class="btn btn-ghost btn-sm" onclick="editParentPhone('${s.id}')">📞 Edit</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function editParentPhone(studentId) {
  const student = APP.db.students.find(s => s.id === studentId);
  if (!student) return;

  const modal = document.getElementById('modal-root');
  modal.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:400px;">
        <div class="modal-header">
          <h3>📞 Update Parent Phone</h3>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:16px;">
            Student: <strong>${student.name}</strong> (${student.regNo})
          </p>
          <div class="form-group">
            <label>Parent Name</label>
            <input class="form-input" id="editParentName" value="${student.parentName}">
          </div>
          <div class="form-group">
            <label>Parent Phone Number</label>
            <input class="form-input" id="editParentPhone" value="${student.parentPhone}" placeholder="+91 XXXXX XXXXX">
          </div>
          <div class="form-group">
            <label>Parent's language (for WhatsApp messages)</label>
            <select class="form-select" id="editParentLang">
              ${[['en','English'],['ml','Malayalam'],['hi','Hindi'],['kn','Kannada'],['te','Telugu'],['ta','Tamil']].map(([k, v]) =>
                `<option value="${k}" ${student.parentLang === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="saveParentPhone('${studentId}')">Save</button>
        </div>
      </div>
    </div>
  `;
}

async function saveParentPhone(studentId) {
  const r = await apiOrToast('PUT', `/api/students/${studentId}/parent`, {
    parentName: $('#editParentName').value.trim(),
    parentPhone: $('#editParentPhone').value.trim(),
    parentLang: $('#editParentLang').value,
  });
  if (!r) return;
  await refreshDB();
  showToast('Updated', 'Parent contact updated successfully', 'success');
  closeModal();
  renderManageStudents();
}

function showAddStudentModal() {
  const modal = document.getElementById('modal-root');
  modal.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-header">
          <h3>Add New Student</h3>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Full Name <span class="required">*</span></label>
            <input class="form-input" id="addName" placeholder="Student name">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Reg Number <span class="required">*</span></label>
              <input class="form-input" id="addRegNo" placeholder="CVV2024XXX">
            </div>
            <div class="form-group">
              <label>Email <span class="required">*</span></label>
              <input class="form-input" id="addEmail" placeholder="name@cvv.edu.in">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Branch</label>
              <select class="form-select" id="addBranch">
                <option>CSE</option><option>ECE</option><option>ME</option><option>EEE</option><option>CE</option>
              </select>
            </div>
            <div class="form-group">
              <label>Semester</label>
              <select class="form-select" id="addSem">
                ${[1,2,3,4,5,6,7,8].map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Parent Phone <span class="required">*</span></label>
            <input class="form-input" id="addParentPhone" placeholder="+91 XXXXX XXXXX">
          </div>
          <div class="form-group">
            <label>Parent Name</label>
            <input class="form-input" id="addParentName" placeholder="Parent name">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="addStudent()">Add Student</button>
        </div>
      </div>
    </div>
  `;
}

async function addStudent() {
  const body = {
    name: $('#addName').value.trim(),
    regNo: $('#addRegNo').value.trim(),
    email: $('#addEmail').value.trim(),
    branch: $('#addBranch').value,
    semester: parseInt($('#addSem').value),
    parentPhone: $('#addParentPhone').value.trim(),
    parentName: $('#addParentName').value.trim() || 'Parent',
  };
  if (!body.name || !body.regNo || !body.email || !body.parentPhone) {
    showToast('Error', 'Please fill all required fields', 'error');
    return;
  }
  const r = await apiOrToast('POST', '/api/students', body);
  if (!r) return;
  await refreshDB();
  showToast('Success', `${body.name} added successfully`, 'success');
  closeModal();
  renderManageStudents();
}

// ═══════════════════════════════════════════════════════════════════
// 20. ADMIN — CALENDAR
// ═══════════════════════════════════════════════════════════════════
function renderManageCalendar() {
  const now = new Date();
  renderCalendarMonth(now.getFullYear(), now.getMonth());
}

// Collapse consecutive days with the same name into one row (e.g. Pooja Holidays 19–21 Oct).
function groupHolidays(list) {
  const out = [];
  [...list].sort((a, b) => a.date.localeCompare(b.date)).forEach(h => {
    const last = out[out.length - 1];
    const next = last && new Date(new Date(last.to + 'T12:00:00').getTime() + 864e5).toISOString().slice(0, 10);
    if (last && last.name === h.name && next === h.date) last.to = h.date;
    else out.push({ ...h, from: h.date, to: h.date });
  });
  return out;
}

async function syncCalendar(year, month) {
  showToast('Syncing…', 'Reading the academic calendar from cvv.ac.in', 'info');
  const r = await apiOrToast('POST', '/api/calendar/sync', undefined, 'Sync failed');
  if (!r) return;
  await refreshDB();
  showToast('Calendar updated', `${r.holidays} holidays and ${r.breaks} breaks loaded from cvv.ac.in`, 'success');
  renderCalendarMonth(year, month);
}

function renderCalendarMonth(year, month) {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = getTodayStr();

  let calDays = '';
  for (let i = 0; i < firstDay; i++) {
    calDays += '<div class="cal-day empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const isHoliday = APP.db.holidays.includes(dateStr);
    const isSunday = new Date(year, month, d).getDay() === 0;

    let cls = 'cal-day';
    if (isToday) cls += ' today';
    if (isHoliday) cls += ' selected';
    if (isSunday) cls += ' holiday';

    const info = (APP.db.holidayInfo || []).find(h => h.date === dateStr);
    calDays += `<div class="${cls}" title="${info ? info.name : ''}" onclick="toggleHoliday('${dateStr}', ${year}, ${month})">${d}${isHoliday ? (info && info.kind === 'break' ? ' 🏖️' : ' 🎉') : ''}</div>`;
  }

  $('#pageContent').innerHTML = `
    <div class="anim-fade-in">
      <div class="card" style="max-width:600px;">
        <div class="card-header">
          <h3>📅 Academic Calendar</h3>
          <button class="btn btn-primary btn-sm" onclick="syncCalendar(${year}, ${month})">⟳ Sync from cvv.ac.in</button>
        </div>
        <div class="card-body">
          <div class="info-banner info">
            <span class="banner-icon">ℹ️</span>
            <div>Holidays and breaks come from CVV's official <a href="${APP.db.calendar?.source}" target="_blank" rel="noopener">academic calendar</a>${APP.db.calendar?.syncedAt ? ` (last synced ${formatDateTime(APP.db.calendar.syncedAt)})` : ''}. 🎉 holiday · 🏖️ semester break. Tap a date to add or remove one by hand.</div>
          </div>

          <div class="calendar-mini">
            <div class="cal-header">
              <button class="btn btn-ghost btn-sm" onclick="renderCalendarMonth(${month === 0 ? year-1 : year}, ${month === 0 ? 11 : month-1})">← Prev</button>
              <h4>${monthNames[month]} ${year}</h4>
              <button class="btn btn-ghost btn-sm" onclick="renderCalendarMonth(${month === 11 ? year+1 : year}, ${month === 11 ? 0 : month+1})">Next →</button>
            </div>
            <div class="cal-grid">
              ${dayNames.map(d => `<div class="cal-day-name">${d}</div>`).join('')}
              ${calDays}
            </div>
          </div>

          <div style="margin-top:20px;">
            <h4 style="font-size:0.85rem;font-weight:600;margin-bottom:8px;">Holidays & breaks</h4>
            <div class="table-wrapper"><table>
              <thead><tr><th>Dates</th><th>Name</th><th>Applies to</th><th>Source</th></tr></thead>
              <tbody>${groupHolidays(APP.db.holidayInfo || []).map(h => `
                <tr><td style="white-space:nowrap">${formatDate(h.from)}${h.to !== h.from ? ' – ' + formatDate(h.to) : ''}</td>
                  <td>${h.kind === 'break' ? '🏖️' : '🎉'} ${h.name || 'Holiday'}</td>
                  <td>${h.semesters ? 'S' + h.semesters.split(',').join(', S') : 'Everyone'}</td>
                  <td><span class="badge ${h.source === 'admin' ? 'badge-pending' : 'badge-approved'}">${h.source === 'admin' ? 'Added by admin' : 'cvv.ac.in'}</span></td></tr>`).join('')}
              </tbody></table></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function toggleHoliday(dateStr, year, month) {
  const r = await apiOrToast('POST', '/api/holidays/toggle', { date: dateStr });
  if (!r) return;
  await refreshDB();
  showToast(r.added ? 'Added' : 'Removed',
    r.added ? `${formatDate(dateStr)} marked as holiday` : `${formatDate(dateStr)} removed from holidays`,
    r.added ? 'success' : 'info');
  renderCalendarMonth(year, month);
}

// ═══════════════════════════════════════════════════════════════════
// 21. ADMIN — UPLOAD DATA
// ═══════════════════════════════════════════════════════════════════
function renderUploadData() {
  $('#pageContent').innerHTML = `
    <div class="anim-fade-in" style="max-width:600px;">
      <div class="card">
        <div class="card-header"><h3>📤 Upload Student Data</h3></div>
        <div class="card-body">
          <div class="info-banner info">
            <span class="banner-icon">ℹ️</span>
            <div>Upload the hostel/admission records. Only students in these records can activate an account, and the parent phone number always comes from here — students can't enter or change it. Every change to a parent number is logged.</div>
          </div>

          <div class="upload-area" onclick="document.getElementById('csvFile').click()">
            <div class="upload-icon">📄</div>
            <h4>Drop CSV file here or click to browse</h4>
            <p>Format: RegNo, Name, Email, Branch, Semester, ParentName, ParentPhone, ParentLanguage (en/ml/hi/kn/te/ta, optional)</p>
            <input type="file" id="csvFile" accept=".csv" class="hidden" onchange="handleCSVUpload(event)">
          </div>

          <div class="divider">Or use sample data</div>

          <button class="btn btn-outline btn-block" onclick="loadSampleData()">Reset to Sample Data (wipes all passes)</button>

          <div id="uploadPreview" style="margin-top:16px;"></div>
        </div>
      </div>
    </div>
  `;
}

function handleCSVUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const r = await apiOrToast('POST', '/api/students/import', e.target.result, 'Import failed');
    if (!r) return;
    await refreshDB();
    showToast('Import complete', `${r.added} added, ${r.updated} updated`, 'success');
    document.getElementById('uploadPreview').innerHTML = `
      <div class="info-banner ${r.errors.length ? 'warning' : 'success'}">
        <span class="banner-icon">${r.errors.length ? '⚠️' : '✅'}</span>
        <div><strong>${file.name}:</strong> ${r.added} students added, ${r.updated} updated (parent phone linked from admission records).
        ${r.errors.length ? '<br><br>Skipped:<br>' + r.errors.map(x => '• ' + x).join('<br>') : ''}</div>
      </div>
    `;
  };
  reader.readAsText(file);
}

async function loadSampleData() {
  const r = await apiOrToast('POST', '/api/reset');
  if (!r) return;
  await refreshDB();
  showToast('Data Loaded', 'Database reset to the 5 sample students', 'success');
  renderUploadData();
}

// ═══════════════════════════════════════════════════════════════════
// 22. WHATSAPP SIMULATIONS
// ═══════════════════════════════════════════════════════════════════
function simulateWhatsAppAlert(phone, studentName) {
  const modal = document.getElementById('modal-root');
  modal.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:420px;">
        <div class="modal-header">
          <h3>📲 WhatsApp Alert Simulation</h3>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body" style="padding:0;">
          <div class="whatsapp-sim">
            <div class="wa-header">
              <div class="wa-avatar">🎓</div>
              <div class="wa-header-info">
                <h4>CVV Outpass System</h4>
                <span>Sending to ${phone}</span>
              </div>
            </div>
            <div class="wa-messages">
              <div class="wa-msg received">
                🚨 <strong>ALERT</strong><br><br>
                Dear Parent,<br><br>
                Your ward <strong>${studentName}</strong> has not returned to campus by the 6:00 PM deadline.<br><br>
                Please contact the hostel warden if needed:<br>
                📞 Mr. Krishnan<br><br>
                — CVV Outpass System
                <div class="wa-time">${formatTime(new Date())}</div>
              </div>
            </div>
            <div class="wa-actions">
              <button class="btn btn-primary btn-block btn-sm" onclick="closeModal()">Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function sendWardenWhatsAppList() {
  const approved = APP.db.outpasses.filter(o =>
    o.status === 'approved' &&
    o.outDate === getTodayStr()
  );

  const modal = document.getElementById('modal-root');
  modal.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:420px;">
        <div class="modal-header">
          <h3>📲 Warden's WhatsApp List</h3>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body" style="padding:0;">
          <div class="whatsapp-sim">
            <div class="wa-header">
              <div class="wa-avatar">🎓</div>
              <div class="wa-header-info">
                <h4>CVV Outpass System</h4>
                <span>Final List</span>
              </div>
            </div>
            <div class="wa-messages">
              <div class="wa-msg received">
                📋 <strong>Final Outpass List — ${formatDate(getTodayStr())}</strong><br><br>
                ${approved.length > 0 ? approved.map((p, i) => {
                  const stu = APP.db.students.find(s => s.id === p.studentId);
                  return `${i + 1}. ${stu?.name} (${stu?.regNo}) — ${capitalize(p.type)}`;
                }).join('<br>') : 'No approved outpasses for today.'}
                <br><br>
                Total out: <strong>${approved.length}</strong><br>
                Eating in: <strong>${APP.db.totalStudents - approved.length}</strong>
                <div class="wa-time">${formatTime(new Date())} ✓✓</div>
              </div>
            </div>
            <div class="wa-actions">
              <button class="btn btn-primary btn-block btn-sm" onclick="closeModal()">Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  showToast('List Sent', 'Final outpass list sent to warden\'s WhatsApp', 'success');
}

// ═══ Inbox: each role gets its own alerts, most urgent first, with one-tap actions ═══
const INBOX = { items: [], seen: new Set(), timer: null, first: true, audio: null, armedReject: null };
const PRIO_ICON = { urgent: '🚨', high: '⚠️', normal: '📝', info: 'ℹ️' };

function startInbox() {
  clearInterval(INBOX.timer);
  INBOX.items = []; INBOX.seen = new Set(); INBOX.first = true;
  pollInbox();
  INBOX.timer = setInterval(pollInbox, 15000);
  document.addEventListener('click', unlockAudio, { once: true });
}

function unlockAudio() {
  try { INBOX.audio = INBOX.audio || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
}

// Different sound per urgency: urgent = 3 sharp beeps, high = 2 beeps, normal = soft chime.
function playAlert(priority) {
  const ctx = INBOX.audio; if (!ctx) return;
  const pattern = { urgent: [[880, 0], [880, .22], [880, .44]], high: [[660, 0], [660, .25]], normal: [[523, 0], [784, .15]] }[priority];
  if (!pattern) return;
  pattern.forEach(([f, t]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = priority === 'urgent' ? 'square' : 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
    g.gain.exponentialRampToValueAtTime(priority === 'urgent' ? 0.25 : 0.15, ctx.currentTime + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
    o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
  });
}

async function pollInbox() {
  if (!APP.currentUser) { clearInterval(INBOX.timer); return; }
  let r;
  try { r = await api('GET', '/api/inbox'); } catch (e) { return; }
  const fresh = r.items.filter(i => !INBOX.seen.has(i.id));
  INBOX.items = r.items;
  r.items.forEach(i => INBOX.seen.add(i.id));
  updateBell(r.count);
  if (!INBOX.first && fresh.length) announce(fresh);
  INBOX.first = false;
  if (document.getElementById('inboxList')) renderInboxList();
}

function updateBell(count) {
  const badge = document.getElementById('bellCount');
  const btn = document.getElementById('bellBtn');
  if (!badge) return;
  const top = INBOX.items.find(i => i.priority !== 'info');
  badge.hidden = !count;
  badge.textContent = count > 9 ? '9+' : count;
  badge.className = 'bell-count ' + (top ? top.priority : '');
  btn.classList.toggle('ringing', !!top && top.priority === 'urgent');
  document.title = (count ? `(${count}) ` : '') + 'CVV Outpass';
}

function announce(fresh) {
  const top = fresh[0]; // already sorted by urgency
  playAlert(top.priority);
  showToast(top.title, `${top.student} · ${formatDate(top.outDate)}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`,
    top.priority === 'urgent' ? 'error' : top.priority === 'high' ? 'warning' : 'info');
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    fresh.slice(0, 3).forEach(i => {
      const n = new Notification(i.title, { body: `${i.student} (${i.regNo}) · ${formatDate(i.outDate)}\n${i.reason}`,
        tag: i.id, requireInteraction: i.priority === 'urgent' });
      n.onclick = () => { window.focus(); showNotifications(); };
    });
  }
}

function inboxHeading() {
  return { student: 'Your passes', teacher: 'Waiting for you', hod: 'Waiting for you', warden: 'Hostel alerts' }[APP.currentRole] || 'Alerts';
}

function showNotifications() {
  unlockAudio();
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  const modal = document.getElementById('modal-root');
  modal.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal inbox-modal">
        <div class="modal-header">
          <h3>🔔 ${inboxHeading()}</h3>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body" style="padding:0;" id="inboxList"></div>
      </div>
    </div>`;
  renderInboxList();
  pollInbox();
}

function renderInboxList() {
  const box = document.getElementById('inboxList'); if (!box) return;
  const items = INBOX.items;
  const bulk = items.filter(i => i.kind === 'approval');
  if (!items.length) {
    box.innerHTML = `<div class="inbox-empty">✅ Nothing needs you right now.</div>`;
    return;
  }
  box.innerHTML = (bulk.length > 1 ? `
    <div class="inbox-bulk"><span>${bulk.length} routine requests</span>
      <button class="btn btn-success btn-sm" onclick="approveAllRoutine()">Approve all ${bulk.length}</button></div>` : '') +
    items.map(i => `
    <div class="inbox-item ${i.priority}">
      <div class="inbox-top"><span class="inbox-title">${i.title}</span><span class="inbox-age">${timeAgo(i.createdAt)}</span></div>
      <div class="inbox-who"><strong>${i.student}</strong> · ${i.regNo} · ${formatDate(i.outDate)}${i.type === 'emergency' ? ' · <span class="badge badge-emergency">Emergency</span>' : ''}</div>
      <div class="inbox-reason">“${i.reason}”</div>
      <div class="inbox-body">${i.body}</div>
      <div class="inbox-actions">${i.actions.map(a => inboxButton(i, a)).join('')}</div>
    </div>`).join('');
}

function inboxButton(i, a) {
  const tel = (i.parentPhone || '').replace(/\s/g, '');
  switch (a) {
    case 'approve': return `<button class="btn btn-success btn-sm" onclick="inboxDecide('${i.passId}','approve')">✓ Approve</button>`;
    case 'reject': return INBOX.armedReject === i.passId
      ? `<button class="btn btn-danger btn-sm" onclick="inboxDecide('${i.passId}','reject')">Tap again to reject</button>`
      : `<button class="btn btn-outline btn-sm" onclick="INBOX.armedReject='${i.passId}';renderInboxList()">✕ Reject</button>`;
    case 'call': return `<a class="btn btn-outline btn-sm" href="tel:${tel}">📞 Call parent</a>`;
    case 'remind': return `<button class="btn btn-outline btn-sm" onclick="sendReminder('${i.passId}')">🔁 Remind parent</button>`;
    case 'phone': return `<button class="btn btn-outline btn-sm" onclick="closeModal();navigateTo('phone-approval')">📞 Take answer by phone</button>`;
    case 'ack': return `<button class="btn btn-ghost btn-sm" onclick="inboxAck('${i.passId}')">Mark handled</button>`;
    case 'resend': return `<button class="btn btn-outline btn-sm" onclick="resendToParent('${i.passId}')">🔁 Send to parent again</button>`;
    default: return `<button class="btn btn-ghost btn-sm" onclick="closeModal();viewRequestDetail('${i.passId}')">Open</button>`;
  }
}

function timeAgo(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

async function inboxDecide(passId, action) {
  INBOX.armedReject = null;
  const r = await apiOrToast('POST', `/api/outpasses/${passId}/decision`, { action });
  if (r) showToast(action === 'approve' ? 'Approved' : 'Rejected', `${passId} ${action === 'approve' ? 'approved' : 'rejected'}`, action === 'approve' ? 'success' : 'error');
  await pollInbox();
  if (APP.currentPage) navigateTo(APP.currentPage);
}

async function approveAllRoutine() {
  const ids = INBOX.items.filter(i => i.kind === 'approval').map(i => i.passId);
  let n = 0;
  for (const id of ids) { if (await apiOrToast('POST', `/api/outpasses/${id}/decision`, { action: 'approve' })) n++; }
  showToast('Approved', `${n} request(s) approved`, 'success');
  await pollInbox();
  if (APP.currentPage) navigateTo(APP.currentPage);
}

async function inboxAck(passId) {
  if (await apiOrToast('POST', `/api/outpasses/${passId}/ack`)) await pollInbox();
}

async function resendToParent(passId) {
  if (await apiOrToast('POST', `/api/outpasses/${passId}/resend`)) showToast('Sent', 'Your parent got the message again.', 'success');
}

// Links in staff WhatsApp alerts look like /#pass=CVV-00012 — open that request straight away.
function openDeepLink() {
  const m = location.hash.match(/^#pass=([\w-]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  setTimeout(() => viewRequestDetail(m[1]), 300);
}

// ═══════════════════════════════════════════════════════════════════
// 23. HELPER UTILITIES
// ═══════════════════════════════════════════════════════════════════
function closeModal() {
  const modal = document.getElementById('modal-root');
  if (modal) modal.innerHTML = '';
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function truncate(str, len) {
  return str && str.length > len ? str.slice(0, len) + '…' : str || '';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function formatTime(date) {
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDateStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function generateToken() {
  return 'TKN-' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

function startCutoffCountdown() {
  const update = () => {
    const now = new Date();
    const cutoff = new Date();
    cutoff.setHours(22, 0, 0, 0);
    if (now > cutoff) cutoff.setDate(cutoff.getDate() + 1);

    const diff = cutoff - now;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    const el = document.getElementById('cutoffCountdown');
    if (el) {
      el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
  };

  update();
  setInterval(update, 1000);
}

// Simple QR code generation (canvas pattern — simulated)
function generateQRCode(canvasId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const size = 150;
  canvas.width = size;
  canvas.height = size;

  // Generate deterministic pattern from data
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data.charCodeAt(i);
    hash = hash & hash;
  }

  const cellSize = 5;
  const gridSize = Math.floor(size / cellSize);

  // Draw white background
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);

  // Draw QR-like pattern
  ctx.fillStyle = '#000';

  // Position markers (3 corners)
  drawFinderPattern(ctx, 0, 0, cellSize);
  drawFinderPattern(ctx, (gridSize - 7) * cellSize, 0, cellSize);
  drawFinderPattern(ctx, 0, (gridSize - 7) * cellSize, cellSize);

  // Data pattern
  const rng = mulberry32(Math.abs(hash));
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      // Skip finder patterns
      if ((x < 8 && y < 8) || (x >= gridSize - 8 && y < 8) || (x < 8 && y >= gridSize - 8)) continue;

      if (rng() > 0.55) {
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }
  }
}

function drawFinderPattern(ctx, x, y, cellSize) {
  // Outer black border
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, 7 * cellSize, 7 * cellSize);

  // Inner white
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + cellSize, y + cellSize, 5 * cellSize, 5 * cellSize);

  // Center black
  ctx.fillStyle = '#000';
  ctx.fillRect(x + 2 * cellSize, y + 2 * cellSize, 3 * cellSize, 3 * cellSize);
}

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ═══════════════════════════════════════════════════════════════════
// 24. INITIALIZE
// ═══════════════════════════════════════════════════════════════════
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

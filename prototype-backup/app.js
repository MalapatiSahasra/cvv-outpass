/* ================================================================
   CVV Smart Outpass System — Application Logic (app.js)
   ================================================================

   This is the complete prototype with:
   • State management (localStorage)
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
const DB = {
  _key: 'cvv_outpass_db',

  defaults() {
    return {
      students: [
        { id: 'STU001', email: 'rahul@cvv.edu.in', name: 'Rahul Sharma', regNo: 'CVV2024001', password: 'pass123', semester: 5, branch: 'CSE', parentPhone: '+91 98765 43210', parentName: 'Mr. Anil Sharma' },
        { id: 'STU002', email: 'priya@cvv.edu.in', name: 'Priya Reddy', regNo: 'CVV2024002', password: 'pass123', semester: 3, branch: 'ECE', parentPhone: '+91 91234 56789', parentName: 'Mrs. Lakshmi Reddy' },
        { id: 'STU003', email: 'arjun@cvv.edu.in', name: 'Arjun Nair', regNo: 'CVV2024003', password: 'pass123', semester: 7, branch: 'ME', parentPhone: '+91 87654 32100', parentName: 'Mr. Vijay Nair' },
        { id: 'STU004', email: 'sneha@cvv.edu.in', name: 'Sneha Patel', regNo: 'CVV2024004', password: 'pass123', semester: 5, branch: 'CSE', parentPhone: '+91 99887 65432', parentName: 'Mrs. Kavita Patel' },
        { id: 'STU005', email: 'amit@cvv.edu.in', name: 'Amit Kumar', regNo: 'CVV2024005', password: 'pass123', semester: 3, branch: 'ECE', parentPhone: '+91 90909 09090', parentName: 'Mr. Rajesh Kumar' },
      ],
      staff: [
        { id: 'TCH001', email: 'teacher@cvv.edu.in', name: 'Dr. Meena Iyer', password: 'pass123', role: 'teacher', department: 'CSE', isClassTeacher: true, classSection: 'CSE-5' },
        { id: 'TCH002', email: 'ece.teacher@cvv.edu.in', name: 'Prof. Suresh Rao', password: 'pass123', role: 'teacher', department: 'ECE', isClassTeacher: true, classSection: 'ECE-3' },
        { id: 'HOD001', email: 'hod@cvv.edu.in', name: 'Dr. Ramesh Gupta', password: 'pass123', role: 'hod', department: 'CSE' },
        { id: 'HOD002', email: 'ece.hod@cvv.edu.in', name: 'Dr. Anita Desai', password: 'pass123', role: 'hod', department: 'ECE' },
        { id: 'WAR001', email: 'warden@cvv.edu.in', name: 'Mr. Krishnan', password: 'pass123', role: 'warden' },
        { id: 'GRD001', email: 'guard@cvv.edu.in', name: 'Security - Gate 1', password: 'pass123', role: 'guard' },
        { id: 'KIT001', email: 'kitchen@cvv.edu.in', name: 'Annakshetra Staff', password: 'pass123', role: 'kitchen' },
        { id: 'ADM001', email: 'admin@cvv.edu.in', name: 'Admin Office', password: 'pass123', role: 'admin' },
      ],
      outpasses: [],
      holidays: ['2026-10-14', '2026-10-15', '2026-10-25', '2026-10-26', '2026-11-01', '2026-11-04', '2026-11-14', '2026-12-25'],
      totalStudents: 500,
      nextPassId: 1,
    };
  },

  load() {
    const raw = localStorage.getItem(this._key);
    if (!raw) { const d = this.defaults(); this.save(d); return d; }
    return JSON.parse(raw);
  },

  save(data) {
    localStorage.setItem(this._key, JSON.stringify(data));
  },

  reset() {
    const d = this.defaults();
    this.save(d);
    return d;
  },
};

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

function init() {
  APP.db = DB.load();
  const sess = sessionStorage.getItem('cvv_session');
  if (sess) {
    const s = JSON.parse(sess);
    APP.currentUser = s.user;
    APP.currentRole = s.role;
    renderDashboard();
  } else {
    renderAuth();
  }
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
function renderAuth(mode = 'login') {
  const isLogin = mode === 'login';
  setPage(`
    <div class="auth-screen">
      <div class="auth-container">
        <div class="auth-logo">
          <div class="auth-logo-icon">🎓</div>
          <h1>Chinmaya Vishwavidyapeeth</h1>
          <p>Smart Outpass Management System</p>
        </div>
        <div class="auth-card">
          <h2>${isLogin ? 'Welcome Back' : 'Create Account'}</h2>
          <p class="subtitle">${isLogin ? 'Sign in to manage outpasses' : 'Register with your college email'}</p>

          ${isLogin ? `
          <div class="role-tabs" id="roleTabs">
            <button class="role-tab active" data-role="student" onclick="switchRoleTab(this)">Student</button>
            <button class="role-tab" data-role="teacher" onclick="switchRoleTab(this)">Teacher</button>
            <button class="role-tab" data-role="hod" onclick="switchRoleTab(this)">HOD</button>
            <button class="role-tab" data-role="warden" onclick="switchRoleTab(this)">Warden</button>
            <button class="role-tab" data-role="guard" onclick="switchRoleTab(this)">Guard</button>
            <button class="role-tab" data-role="kitchen" onclick="switchRoleTab(this)">Kitchen</button>
            <button class="role-tab" data-role="admin" onclick="switchRoleTab(this)">Admin</button>
          </div>
          ` : ''}

          <form onsubmit="event.preventDefault(); ${isLogin ? 'handleLogin()' : 'handleRegister()'}">
            ${!isLogin ? `
            <div class="form-group">
              <label>Full Name <span class="required">*</span></label>
              <input class="form-input" id="regName" placeholder="Enter your full name" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Reg. Number <span class="required">*</span></label>
                <input class="form-input" id="regNo" placeholder="CVV2024XXX" required>
              </div>
              <div class="form-group">
                <label>Semester <span class="required">*</span></label>
                <select class="form-select" id="regSem" required>
                  <option value="">Select</option>
                  ${[1,2,3,4,5,6,7,8].map(s => `<option value="${s}">${s}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Branch <span class="required">*</span></label>
              <select class="form-select" id="regBranch" required>
                <option value="">Select branch</option>
                <option>CSE</option><option>ECE</option><option>ME</option><option>EEE</option><option>CE</option>
              </select>
            </div>
            ` : ''}

            <div class="form-group">
              <label>College Email <span class="required">*</span></label>
              <div class="form-input-icon">
                <span class="icon">📧</span>
                <input class="form-input" id="authEmail" type="email" placeholder="${isLogin ? 'yourname@cvv.edu.in' : 'Enter college email'}" required>
              </div>
            </div>
            <div class="form-group">
              <label>Password <span class="required">*</span></label>
              <div class="form-input-icon">
                <span class="icon">🔒</span>
                <input class="form-input" id="authPass" type="password" placeholder="Enter password" required>
              </div>
            </div>

            <button type="submit" class="btn btn-primary btn-block btn-lg" style="margin-top:8px">
              ${isLogin ? '🚀 Sign In' : '✨ Create Account'}
            </button>
          </form>

          <div class="auth-link">
            ${isLogin
              ? 'New student? <a href="#" onclick="renderAuth(\'register\')">Register here</a>'
              : 'Already have an account? <a href="#" onclick="renderAuth(\'login\')">Sign in</a>'
            }
          </div>

          ${isLogin ? `
          <div class="divider">Demo Credentials</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <button class="btn btn-ghost btn-sm" onclick="quickLogin('rahul@cvv.edu.in','student')">👨‍🎓 Student</button>
            <button class="btn btn-ghost btn-sm" onclick="quickLogin('teacher@cvv.edu.in','teacher')">👩‍🏫 Teacher</button>
            <button class="btn btn-ghost btn-sm" onclick="quickLogin('hod@cvv.edu.in','hod')">🎓 HOD</button>
            <button class="btn btn-ghost btn-sm" onclick="quickLogin('warden@cvv.edu.in','warden')">🛡️ Warden</button>
            <button class="btn btn-ghost btn-sm" onclick="quickLogin('guard@cvv.edu.in','guard')">💂 Guard</button>
            <button class="btn btn-ghost btn-sm" onclick="quickLogin('kitchen@cvv.edu.in','kitchen')">🍽️ Kitchen</button>
          </div>
          ` : ''}
        </div>
      </div>
    </div>
  `);
}

function switchRoleTab(btn) {
  $$('.role-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
}

function quickLogin(email, role) {
  $('#authEmail').value = email;
  $('#authPass').value = 'pass123';
  const tabs = $$('.role-tab');
  tabs.forEach(t => {
    t.classList.remove('active');
    if (t.dataset.role === role) t.classList.add('active');
  });
  handleLogin();
}

function handleLogin() {
  const email = $('#authEmail').value.trim().toLowerCase();
  const password = $('#authPass').value;
  const activeTab = $('.role-tab.active');
  const role = activeTab ? activeTab.dataset.role : 'student';

  let user = null;
  if (role === 'student') {
    user = APP.db.students.find(s => s.email === email);
  } else {
    user = APP.db.staff.find(s => s.email === email && s.role === role);
  }

  if (!user) {
    showToast('Login Failed', 'Invalid email or role. Try demo buttons below.', 'error');
    return;
  }

  if (user.password !== password) {
    showToast('Login Failed', 'Incorrect password. Demo password: pass123', 'error');
    return;
  }

  APP.currentUser = user;
  APP.currentRole = role === 'student' ? 'student' : user.role;
  sessionStorage.setItem('cvv_session', JSON.stringify({ user, role: APP.currentRole }));
  showToast('Welcome!', `Logged in as ${user.name}`, 'success');
  renderDashboard();
}

function handleRegister() {
  const name = $('#regName').value.trim();
  const regNo = $('#regNo').value.trim();
  const sem = parseInt($('#regSem').value);
  const branch = $('#regBranch').value;
  const email = $('#authEmail').value.trim().toLowerCase();
  const password = $('#authPass').value;

  if (!email.endsWith('@cvv.edu.in')) {
    showToast('Error', 'Please use your college email (@cvv.edu.in)', 'error');
    return;
  }

  if (APP.db.students.find(s => s.email === email)) {
    showToast('Error', 'This email is already registered', 'error');
    return;
  }

  const newStudent = {
    id: 'STU' + String(APP.db.students.length + 1).padStart(3, '0'),
    email, name, regNo, password,
    semester: sem, branch,
    parentPhone: '+91 XXXXX XXXXX',
    parentName: 'Parent (to be updated by admin)',
  };

  APP.db.students.push(newStudent);
  DB.save(APP.db);
  showToast('Account Created!', 'You can now sign in.', 'success');
  renderAuth('login');
}

function logout() {
  APP.currentUser = null;
  APP.currentRole = null;
  sessionStorage.removeItem('cvv_session');
  renderAuth();
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
            <button class="notification-btn" onclick="showNotifications()">
              🔔
              <span class="dot"></span>
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

function navigateTo(pageId, linkEl) {
  APP.currentPage = pageId;

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

function submitOutpassRequest() {
  const dateVal = $('#reqDate').value;
  const reason = $('#reqReason').value.trim();
  const isEmergency = $('#isEmergency').checked;

  if (!dateVal || !reason) {
    showToast('Error', 'Please fill in all fields', 'error');
    return;
  }

  const isHoliday = APP.db.holidays.includes(dateVal);
  const dayOfWeek = new Date(dateVal).getDay();
  const isSunday = dayOfWeek === 0;
  const isSaturday = dayOfWeek === 6;

  let type;
  if (isEmergency) type = 'emergency';
  else if (isHoliday || isSunday || isSaturday) type = 'holiday';
  else type = 'working';

  const passId = 'CVV-' + String(APP.db.nextPassId++).padStart(5, '0');

  const outpass = {
    passId,
    studentId: APP.currentUser.id,
    outDate: dateVal,
    reason,
    type,
    status: 'pending',
    createdAt: new Date().toISOString(),
    approvals: {
      parent: 'pending',
      teacher: type === 'holiday' ? 'na' : 'pending',
      hod: type === 'holiday' ? 'na' : 'pending',
      warden: 'na',
    },
    exitTime: null,
    returnTime: null,
    lateReturn: false,
    qrToken: generateToken(),
  };

  APP.db.outpasses.push(outpass);
  DB.save(APP.db);

  showToast('Request Submitted!', `Outpass ${passId} created. Parent notification sent.`, 'success');

  // Show WhatsApp simulation
  showParentWhatsAppSim(outpass);
}

// ═══════════════════════════════════════════════════════════════════
// 7. PARENT WHATSAPP & OTP SIMULATION
// ═══════════════════════════════════════════════════════════════════
function showParentWhatsAppSim(outpass) {
  const student = APP.db.students.find(s => s.id === outpass.studentId);
  const modal = document.getElementById('modal-root');

  modal.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:420px;">
        <div class="modal-header">
          <h3>📲 Parent WhatsApp Simulation</h3>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body" style="padding:0;">
          <div class="whatsapp-sim">
            <div class="wa-header">
              <div class="wa-avatar">🎓</div>
              <div class="wa-header-info">
                <h4>CVV Outpass System</h4>
                <span>online</span>
              </div>
            </div>
            <div class="wa-messages" id="waMessages">
              <div class="wa-msg received" style="animation:fadeIn 0.3s ease 0.2s both">
                <strong>Outpass Request</strong><br><br>
                Dear ${student.parentName},<br><br>
                Your ward <strong>${student.name}</strong> (${student.regNo}) has requested an outpass.<br><br>
                📅 Date: ${formatDate(outpass.outDate)}<br>
                📋 Type: ${capitalize(outpass.type)}<br>
                📝 Reason: ${outpass.reason}<br><br>
                Please verify with OTP to approve or reject.
                <div class="wa-time">${formatTime(new Date())}</div>
              </div>
            </div>
            <div class="wa-actions">
              <button class="btn btn-success btn-sm" onclick="showOTPVerification('${outpass.passId}', 'approve')">✅ Approve</button>
              <button class="btn btn-danger btn-sm" onclick="handleParentAction('${outpass.passId}', 'reject')">❌ Reject</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function showOTPVerification(passId, action) {
  const otp = String(Math.floor(1000 + Math.random() * 9000));

  const modal = document.getElementById('modal-root');
  modal.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:400px;">
        <div class="modal-header">
          <h3>🔐 OTP Verification</h3>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="otp-container">
            <div class="otp-icon">🔐</div>
            <h3 style="margin-bottom:4px;">Verify Your Identity</h3>
            <p style="font-size:0.85rem;color:var(--text-secondary);">Enter the OTP sent to parent's phone</p>

            <div class="info-banner info" style="margin-top:16px;text-align:left;">
              <span class="banner-icon">💡</span>
              <div>Simulated OTP: <strong style="font-family:'JetBrains Mono';letter-spacing:0.15em;">${otp}</strong></div>
            </div>

            <div class="otp-inputs">
              <input type="text" maxlength="1" id="otp1" oninput="otpNext(this,2)" autofocus>
              <input type="text" maxlength="1" id="otp2" oninput="otpNext(this,3)">
              <input type="text" maxlength="1" id="otp3" oninput="otpNext(this,4)">
              <input type="text" maxlength="1" id="otp4" oninput="verifyOTP('${passId}','${otp}','${action}')">
            </div>

            <div class="otp-timer">
              Expires in <strong id="otpTimer">02:00</strong>
            </div>

            <button class="btn btn-ghost btn-sm" onclick="showToast('OTP Resent','New OTP sent to parent phone','info')">Resend OTP</button>
          </div>
        </div>
      </div>
    </div>
  `;

  startOTPTimer();
}

function otpNext(current, nextNum) {
  if (current.value.length === 1 && nextNum <= 4) {
    const next = document.getElementById('otp' + nextNum);
    if (next) next.focus();
  }
}

function verifyOTP(passId, correctOTP, action) {
  const entered = [$('#otp1'), $('#otp2'), $('#otp3'), $('#otp4')].map(i => i?.value || '').join('');
  if (entered.length < 4) return;

  if (entered === correctOTP) {
    handleParentAction(passId, action);
  } else {
    showToast('Invalid OTP', 'The OTP entered is incorrect. Please try again.', 'error');
    ['otp1','otp2','otp3','otp4'].forEach(id => { const i = document.getElementById(id); if(i) i.value = ''; });
    const first = document.getElementById('otp1');
    if (first) first.focus();
  }
}

function startOTPTimer() {
  let seconds = 120;
  const timer = setInterval(() => {
    seconds--;
    const el = document.getElementById('otpTimer');
    if (!el) { clearInterval(timer); return; }
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (seconds <= 0) {
      clearInterval(timer);
      el.textContent = 'Expired';
    }
  }, 1000);
}

function handleParentAction(passId, action) {
  const outpass = APP.db.outpasses.find(o => o.passId === passId);
  if (!outpass) return;

  if (action === 'approve') {
    outpass.approvals.parent = 'approved';
    outpass.approvals.parentTime = new Date().toISOString();

    if (outpass.type === 'holiday') {
      // Check 10 PM cutoff
      const now = new Date();
      const cutoff = new Date(outpass.outDate);
      cutoff.setDate(cutoff.getDate() - 1);
      cutoff.setHours(22, 0, 0, 0);

      if (now < cutoff) {
        outpass.status = 'approved';
        showToast('Pass Approved!', 'Holiday outpass auto-generated (before 10 PM cutoff)', 'success');
      } else {
        outpass.approvals.warden = 'pending';
        showToast('Sent to Warden', 'Approval after 10 PM cutoff — warden decision needed', 'warning');
      }
    }
    // For working/emergency, next approvals are needed
  } else {
    outpass.approvals.parent = 'rejected';
    outpass.status = 'rejected';
    showToast('Request Rejected', 'Parent has rejected this outpass request', 'error');
  }

  DB.save(APP.db);
  closeModal();

  // Show WhatsApp confirmation
  showWhatsAppConfirmation(outpass, action);
}

function showWhatsAppConfirmation(outpass, action) {
  const student = APP.db.students.find(s => s.id === outpass.studentId);
  const modal = document.getElementById('modal-root');

  modal.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:420px;">
        <div class="modal-header">
          <h3>📲 WhatsApp Confirmation</h3>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body" style="padding:0;">
          <div class="whatsapp-sim">
            <div class="wa-header">
              <div class="wa-avatar">🎓</div>
              <div class="wa-header-info">
                <h4>CVV Outpass System</h4>
                <span>online</span>
              </div>
            </div>
            <div class="wa-messages">
              <div class="wa-msg sent">
                ${action === 'approve' ? '✅ APPROVED' : '❌ REJECTED'}
                <div class="wa-time">${formatTime(new Date())} ✓✓</div>
              </div>
              <div class="wa-msg received" style="animation:fadeIn 0.3s ease 0.3s both">
                ${action === 'approve'
                  ? `Thank you, ${student.parentName}! You have approved the outpass for ${student.name} on ${formatDate(outpass.outDate)}.${outpass.type !== 'holiday' ? ' The request will now be reviewed by the class teacher.' : ''}`
                  : `Thank you for your response. The outpass request for ${student.name} has been rejected.`}
                <div class="wa-time">${formatTime(new Date())}</div>
              </div>
            </div>
            <div class="wa-actions">
              <button class="btn btn-primary btn-block btn-sm" onclick="closeModal(); navigateTo('${APP.currentRole === 'student' ? 'my-passes' : 'dashboard'}')">Done</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
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

function approveRequest(passId) {
  const outpass = APP.db.outpasses.find(o => o.passId === passId);
  if (!outpass) return;

  const role = APP.currentRole;

  if (role === 'teacher') {
    outpass.approvals.teacher = 'approved';
    outpass.approvals.teacherTime = new Date().toISOString();
    showToast('Approved!', 'Class teacher approval recorded', 'success');
  } else if (role === 'hod') {
    outpass.approvals.hod = 'approved';
    outpass.approvals.hodTime = new Date().toISOString();
    // If all approvals done
    if (outpass.approvals.parent === 'approved' && outpass.approvals.teacher === 'approved') {
      outpass.status = 'approved';
      showToast('Fully Approved!', 'All approvals complete. Outpass generated.', 'success');
    } else {
      showToast('Approved!', 'HOD approval recorded', 'success');
    }
  } else if (role === 'warden') {
    outpass.approvals.warden = 'approved';
    outpass.approvals.wardenTime = new Date().toISOString();
    outpass.status = 'approved';
    showToast('Approved!', 'Warden approval granted. Pass is now active.', 'success');
  }

  // Check if all approvals are done for emergency
  if (outpass.type === 'emergency') {
    if (outpass.approvals.parent === 'approved' &&
        outpass.approvals.teacher === 'approved' &&
        outpass.approvals.hod === 'approved') {
      outpass.status = 'approved';
    }
  }

  DB.save(APP.db);
  closeModal();
  navigateTo(APP.currentPage);
}

function rejectRequest(passId) {
  const outpass = APP.db.outpasses.find(o => o.passId === passId);
  if (!outpass) return;

  const role = APP.currentRole;

  if (role === 'teacher') {
    outpass.approvals.teacher = 'rejected';
    outpass.approvals.teacherTime = new Date().toISOString();
  } else if (role === 'hod') {
    outpass.approvals.hod = 'rejected';
    outpass.approvals.hodTime = new Date().toISOString();
  } else if (role === 'warden') {
    outpass.approvals.warden = 'rejected';
    outpass.approvals.wardenTime = new Date().toISOString();
  }

  outpass.status = 'rejected';
  DB.save(APP.db);

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

function simulateScan() {
  const input = $('#scanInput').value.trim();
  if (!input) {
    showToast('Error', 'Please enter a Pass ID or token', 'error');
    return;
  }

  const outpass = APP.db.outpasses.find(o =>
    o.passId.toLowerCase() === input.toLowerCase() ||
    o.qrToken === input
  );

  const resultDiv = document.getElementById('scanResult');

  if (!outpass) {
    resultDiv.innerHTML = `
      <div class="scanner-result" style="margin-top:20px;">
        <div class="check-icon danger">❌</div>
        <h3 style="color:var(--danger);">Invalid Pass</h3>
        <p style="color:var(--text-secondary);">No outpass found with this ID or token.</p>
      </div>
    `;
    showToast('Invalid', 'No matching outpass found', 'error');
    return;
  }

  const student = APP.db.students.find(s => s.id === outpass.studentId);

  if (outpass.status === 'approved' && !outpass.exitTime) {
    // EXIT scan
    outpass.status = 'active';
    outpass.exitTime = formatTime(new Date());
    DB.save(APP.db);

    resultDiv.innerHTML = `
      <div class="scanner-result" style="margin-top:20px;">
        <div class="check-icon success">✅</div>
        <h3 style="color:var(--success);">Exit Recorded</h3>
        <div style="margin-top:12px;text-align:left;font-size:0.85rem;">
          <p><strong>Student:</strong> ${student?.name} (${student?.regNo})</p>
          <p><strong>Time:</strong> ${outpass.exitTime}</p>
          <p><strong>Expected return:</strong> Before 6:00 PM</p>
        </div>
      </div>
    `;
    showToast('Exit Recorded', `${student?.name} has exited the campus`, 'success');
  } else if (outpass.status === 'active') {
    // RETURN scan
    const now = new Date();
    outpass.returnTime = formatTime(now);
    outpass.status = 'completed';

    const hour = now.getHours();
    if (hour >= 18) {
      outpass.lateReturn = true;
      resultDiv.innerHTML = `
        <div class="scanner-result" style="margin-top:20px;">
          <div class="check-icon danger">⚠️</div>
          <h3 style="color:var(--danger);">LATE RETURN</h3>
          <div style="margin-top:12px;text-align:left;font-size:0.85rem;">
            <p><strong>Student:</strong> ${student?.name} (${student?.regNo})</p>
            <p><strong>Return time:</strong> ${outpass.returnTime}</p>
            <p style="color:var(--danger);font-weight:600;">⚠️ Alert sent to warden and parent</p>
          </div>
        </div>
      `;
      showToast('🚨 Late Return!', `${student?.name} returned after 6 PM. Warden & parent alerted.`, 'error');
    } else {
      resultDiv.innerHTML = `
        <div class="scanner-result" style="margin-top:20px;">
          <div class="check-icon success">✅</div>
          <h3 style="color:var(--success);">Return Recorded</h3>
          <div style="margin-top:12px;text-align:left;font-size:0.85rem;">
            <p><strong>Student:</strong> ${student?.name} (${student?.regNo})</p>
            <p><strong>Return time:</strong> ${outpass.returnTime}</p>
          </div>
        </div>
      `;
      showToast('Return Recorded', `${student?.name} has returned to campus`, 'success');
    }

    DB.save(APP.db);
  } else if (outpass.status === 'pending') {
    resultDiv.innerHTML = `
      <div class="scanner-result" style="margin-top:20px;">
        <div class="check-icon danger">⏳</div>
        <h3 style="color:var(--warning);">Not Yet Approved</h3>
        <p style="color:var(--text-secondary);">This outpass is still pending approval.</p>
      </div>
    `;
    showToast('Warning', 'Outpass not yet approved', 'warning');
  } else {
    resultDiv.innerHTML = `
      <div class="scanner-result" style="margin-top:20px;">
        <div class="check-icon danger">ℹ️</div>
        <h3>Pass Status: ${capitalize(outpass.status)}</h3>
        <p style="color:var(--text-secondary);">This pass has already been used or is ${outpass.status}.</p>
      </div>
    `;
  }
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

function wardenEmergencyApprove(passId) {
  const outpass = APP.db.outpasses.find(o => o.passId === passId);
  if (!outpass) return;
  if (outpass.status === 'rejected') {
    showToast('Cannot Approve', 'This request was already rejected.', 'error');
    return;
  }
  outpass.approvals.warden = 'approved';
  outpass.approvals.wardenTime = new Date().toISOString();
  outpass.status = 'approved';
  DB.save(APP.db);
  showToast('Approved', `Emergency outpass ${passId} approved by warden.`, 'success');
  navigateTo('alerts');
}

function sendReminder(passId) {
  showToast('Reminder Sent', 'A reminder has been sent to the parent via WhatsApp/SMS.', 'info');
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

function recordPhoneApproval() {
  const passId = $('#phoneApprovalSelect')?.value;
  const confirmed = $('#phoneConfirm')?.checked;

  if (!confirmed) {
    showToast('Error', 'Please confirm the verbal approval', 'error');
    return;
  }

  const outpass = APP.db.outpasses.find(o => o.passId === passId);
  if (!outpass) return;

  outpass.approvals.parent = 'approved';
  outpass.approvals.parentTime = new Date().toISOString();
  outpass.approvals.parentMethod = 'phone';

  // Auto-approve for holiday
  if (outpass.type === 'holiday') {
    const now = new Date();
    const cutoff = new Date(outpass.outDate);
    cutoff.setDate(cutoff.getDate() - 1);
    cutoff.setHours(22, 0, 0, 0);

    if (now < cutoff) {
      outpass.status = 'approved';
    } else {
      outpass.approvals.warden = 'pending';
    }
  }

  DB.save(APP.db);
  showToast('Recorded', 'Phone approval recorded successfully', 'success');
  renderPhoneApproval();
}

// ═══════════════════════════════════════════════════════════════════
// 18. KITCHEN — MEAL COUNT
// ═══════════════════════════════════════════════════════════════════
function renderKitchenCount() {
  const totalStudents = APP.db.totalStudents;
  const activeOut = APP.db.outpasses.filter(o => o.status === 'active' || o.status === 'approved').length;
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
  $('#pageContent').innerHTML = `
    <div class="card anim-fade-in">
      <div class="card-header"><h3>📊 Historical Meal Counts</h3></div>
      <div class="card-body">
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Date</th><th>Total</th><th>Out</th><th>Eating</th><th>Status</th></tr></thead>
            <tbody>
              <tr><td>Oct 12, 2026</td><td>500</td><td>${APP.db.outpasses.filter(o => o.status === 'approved' || o.status === 'active').length}</td><td>${500 - APP.db.outpasses.filter(o => o.status === 'approved' || o.status === 'active').length}</td><td><span class="badge badge-active">Live</span></td></tr>
              <tr><td>Oct 11, 2026</td><td>500</td><td>23</td><td>477</td><td><span class="badge badge-approved">Final</span></td></tr>
              <tr><td>Oct 10, 2026</td><td>500</td><td>45</td><td>455</td><td><span class="badge badge-approved">Final</span></td></tr>
              <tr><td>Oct 9, 2026</td><td>500</td><td>12</td><td>488</td><td><span class="badge badge-approved">Final</span></td></tr>
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
                <tr><th>Reg No</th><th>Name</th><th>Email</th><th>Branch</th><th>Sem</th><th>Parent Phone</th><th>Actions</th></tr>
              </thead>
              <tbody>
                ${APP.db.students.map(s => `
                  <tr>
                    <td><code>${s.regNo}</code></td>
                    <td>${s.name}</td>
                    <td>${s.email}</td>
                    <td>${s.branch}</td>
                    <td>${s.semester}</td>
                    <td>${s.parentPhone}</td>
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
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="saveParentPhone('${studentId}')">Save</button>
        </div>
      </div>
    </div>
  `;
}

function saveParentPhone(studentId) {
  const student = APP.db.students.find(s => s.id === studentId);
  if (!student) return;

  student.parentName = $('#editParentName').value.trim();
  student.parentPhone = $('#editParentPhone').value.trim();
  DB.save(APP.db);

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

function addStudent() {
  const name = $('#addName').value.trim();
  const regNo = $('#addRegNo').value.trim();
  const email = $('#addEmail').value.trim();
  const branch = $('#addBranch').value;
  const semester = parseInt($('#addSem').value);
  const parentPhone = $('#addParentPhone').value.trim();
  const parentName = $('#addParentName').value.trim() || 'Parent';

  if (!name || !regNo || !email || !parentPhone) {
    showToast('Error', 'Please fill all required fields', 'error');
    return;
  }

  APP.db.students.push({
    id: 'STU' + String(APP.db.students.length + 1).padStart(3, '0'),
    email, name, regNo, password: 'pass123',
    semester, branch, parentPhone, parentName,
  });

  DB.save(APP.db);
  showToast('Success', `${name} added successfully`, 'success');
  closeModal();
  renderManageStudents();
}

// ═══════════════════════════════════════════════════════════════════
// 20. ADMIN — CALENDAR
// ═══════════════════════════════════════════════════════════════════
function renderManageCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

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

    calDays += `<div class="${cls}" onclick="toggleHoliday('${dateStr}', ${year}, ${month})">${d}${isHoliday ? ' 🎉' : ''}</div>`;
  }

  $('#pageContent').innerHTML = `
    <div class="anim-fade-in">
      <div class="card" style="max-width:600px;">
        <div class="card-header">
          <h3>📅 Academic Calendar</h3>
          <span class="badge badge-holiday">${APP.db.holidays.length} holidays set</span>
        </div>
        <div class="card-body">
          <div class="info-banner info">
            <span class="banner-icon">ℹ️</span>
            <div>Click on a date to mark/unmark it as a holiday. Gold highlighted dates are holidays.</div>
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
            <h4 style="font-size:0.85rem;font-weight:600;margin-bottom:8px;">Marked Holidays:</h4>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${APP.db.holidays.sort().map(h => `
                <span class="badge badge-holiday" style="cursor:pointer;" onclick="toggleHoliday('${h}', ${year}, ${month})">
                  ${formatDate(h)} ✕
                </span>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function toggleHoliday(dateStr, year, month) {
  const idx = APP.db.holidays.indexOf(dateStr);
  if (idx > -1) {
    APP.db.holidays.splice(idx, 1);
    showToast('Removed', `${formatDate(dateStr)} removed from holidays`, 'info');
  } else {
    APP.db.holidays.push(dateStr);
    showToast('Added', `${formatDate(dateStr)} marked as holiday`, 'success');
  }
  DB.save(APP.db);
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
            <div>Upload a CSV file with student admission records including parent phone numbers. Students cannot edit their parent's phone number.</div>
          </div>

          <div class="upload-area" onclick="document.getElementById('csvFile').click()">
            <div class="upload-icon">📄</div>
            <h4>Drop CSV file here or click to browse</h4>
            <p>Format: RegNo, Name, Email, Branch, Semester, ParentName, ParentPhone</p>
            <input type="file" id="csvFile" accept=".csv" class="hidden" onchange="handleCSVUpload(event)">
          </div>

          <div class="divider">Or use sample data</div>

          <button class="btn btn-outline btn-block" onclick="loadSampleData()">Load Sample Data (5 students)</button>

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
  reader.onload = function(e) {
    showToast('File Loaded', `${file.name} parsed successfully`, 'success');
    document.getElementById('uploadPreview').innerHTML = `
      <div class="info-banner success">
        <span class="banner-icon">✅</span>
        <div>File loaded successfully. In a real deployment, student records would be imported and parent phone numbers linked.</div>
      </div>
    `;
  };
  reader.readAsText(file);
}

function loadSampleData() {
  APP.db = DB.reset();
  showToast('Data Loaded', 'Sample data with 5 students has been loaded', 'success');
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

function showNotifications() {
  const modal = document.getElementById('modal-root');
  const notifs = [];

  // Generate contextual notifications
  if (APP.currentRole === 'student') {
    const myPasses = APP.db.outpasses.filter(o => o.studentId === APP.currentUser.id);
    myPasses.forEach(p => {
      if (p.status === 'approved') notifs.push({ icon: '✅', text: `Pass ${p.passId} approved`, time: '2 min ago' });
      if (p.status === 'pending') notifs.push({ icon: '⏳', text: `Pass ${p.passId} pending approval`, time: '5 min ago' });
    });
  } else if (APP.currentRole === 'warden') {
    const pending = APP.db.outpasses.filter(o => o.approvals.warden === 'pending');
    if (pending.length) notifs.push({ icon: '📋', text: `${pending.length} pass(es) need your decision`, time: 'Just now' });
  }

  if (notifs.length === 0) {
    notifs.push({ icon: '🔔', text: 'No new notifications', time: '' });
  }

  modal.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal" style="max-width:380px;">
        <div class="modal-header">
          <h3>🔔 Notifications</h3>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body" style="padding:0;">
          ${notifs.map(n => `
            <div style="padding:12px 20px;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:12px;">
              <span style="font-size:1.2rem;">${n.icon}</span>
              <div style="flex:1;">
                <div style="font-size:0.85rem;">${n.text}</div>
                ${n.time ? `<div style="font-size:0.7rem;color:var(--text-muted);">${n.time}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
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
document.addEventListener('DOMContentLoaded', init);

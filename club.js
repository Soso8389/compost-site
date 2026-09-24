/* ============================================================
   CVHS Can Compost — club.js
   Phase 6: Club page.
   Auth shared with main site via localStorage session.
   ============================================================ */

const CFG = window.CONFIG || {};
const FB  = CFG.firebase || {};
const USE_FIRESTORE = !!(FB.apiKey && FB.projectId);

let db   = null;
let selectedShift = null;

const state = { users: {}, events: [], codes: {}, announcements: [], volunteers: {}, volSettings: {}, ready: false };

/* ── helpers ────────────────────────────────────────────── */
function normPhone(p)  { return (p || '').replace(/\D/g, ''); }
function getSession()  { return localStorage.getItem('cvhs_session') || null; }
function setSession(v) { v ? localStorage.setItem('cvhs_session', v) : localStorage.removeItem('cvhs_session'); }
function isLoggedIn()  { const s = getSession(); return !!(s && s !== 'guest'); }
function fmtDate(iso)  {
  return new Date(iso).toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
}

/* ── Firebase ───────────────────────────────────────────── */
async function initFirebase() {
  if (!USE_FIRESTORE) { state.ready = true; renderAll(); return; }
  try {
    firebase.initializeApp(CFG.firebase);
    db = firebase.firestore();
    await firebase.auth().signInAnonymously();

    db.collection('users').onSnapshot(snap => {
      snap.forEach(doc => { state.users[doc.id] = doc.data(); });
      state.ready = true;
      renderAll();
    });

    db.collection('events').orderBy('date').onSnapshot(snap => {
      state.events = [];
      snap.forEach(doc => state.events.push({ id: doc.id, ...doc.data() }));
      renderCalendar();
    });

    // attendance codes — stored in Firestore by admin
    db.collection('codes').onSnapshot(snap => {
      state.codes = {};
      snap.forEach(doc => { state.codes[doc.id] = doc.data(); });
    });

    // announcements
    db.collection('announcements').orderBy('ts', 'desc').onSnapshot(snap => {
      state.announcements = [];
      snap.forEach(doc => state.announcements.push({ id: doc.id, ...doc.data() }));
      renderAnnouncements();
    }, err => console.warn('Announcements error:', err));

    // volunteer signups
    db.collection('volunteers').onSnapshot(snap => {
      state.volunteers = {};
      snap.forEach(doc => { state.volunteers[doc.id] = doc.data(); });
      renderMyShifts();
      if (typeof VOL !== 'undefined') VOL.update(state.volunteers, state.volSettings, db);
    });

    // volunteer settings
    db.collection('system').doc('volSettings').onSnapshot(doc => {
      state.volSettings = doc.exists ? doc.data() : {};
      applyVolSettings();
    });

  } catch (e) {
    console.error('Firebase failed:', e);
    state.ready = true;
    renderAll();
  }
}

/* ── DB ─────────────────────────────────────────────────── */
const DB = {
  user(phone)  { return state.users[normPhone(phone)] || null; },
  currentUser() {
    const s = getSession();
    if (!s || s === 'guest') return null;
    return this.user(s);
  },
  async upsert(u) {
    state.users[u.phone] = u;
    if (USE_FIRESTORE && db) {
      try { await db.collection('users').doc(u.phone).set(u); }
      catch (e) { console.warn('Save failed:', e); }
    }
  }
};

async function findUser(phone) {
  phone = normPhone(phone);
  if (state.users[phone]) return state.users[phone];
  if (USE_FIRESTORE && db) {
    try {
      const doc = await db.collection('users').doc(phone).get();
      if (doc.exists) { state.users[phone] = doc.data(); return doc.data(); }
    } catch (e) {}
  }
  return null;
}

/* ── render all ─────────────────────────────────────────── */
function renderAll() {
  renderNav();
  renderGuestBanner();
  renderMemberGreeting();
  renderMyShifts();
  renderAttendanceHistory();
  renderCalendar();
  renderAnnouncements();
  applyVolSettings(); // initialises VOL widget
  renderSMSUnsubBtn();
}

function renderSMSUnsubBtn() {
  const wrap = document.getElementById('smsUnsubWrap');
  const btn  = document.getElementById('smsUnsubBtn');
  const u    = DB.currentUser();
  if (!wrap) return;
  if (!u) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (u.smsOptOut) {
    btn.textContent = 'Unsubscribed from texts';
    btn.disabled    = true;
  } else {
    btn.textContent = 'Unsubscribe from texts';
    btn.disabled    = false;
  }
}

/* ── nav ────────────────────────────────────────────────── */
function renderNav() {
  const cta        = document.getElementById('navCta');
  const mobileAuth = document.getElementById('mobileMenuAuth');

  if (isLoggedIn()) {
    cta.innerHTML = `
      <a href="/club" class="btn btn-ghost" style="padding:9px 18px">Club page</a>
      <button class="btn btn-primary" style="padding:9px 18px" onclick="logout()">Log out</button>`;
    if (mobileAuth) mobileAuth.innerHTML = `
      <a href="/club" class="m-primary" onclick="closeMenu()">Club page</a>
      <button onclick="logout();closeMenu()" style="color:var(--muted)">Log out</button>`;
  } else {
    cta.innerHTML = `
      <button class="btn btn-ghost"   style="padding:9px 18px" onclick="openAuth()">Sign in</button>
      <button class="btn btn-primary" style="padding:9px 18px" onclick="openJoin()">Join</button>`;
    if (mobileAuth) mobileAuth.innerHTML = `
      <button onclick="openAuth();closeMenu()">Sign in</button>
      <button class="m-primary" onclick="openJoin();closeMenu()">Join the club</button>`;
  }
}

/* ── mobile menu ─────────────────────────────────────────── */
function toggleMenu() {
  const menu = document.getElementById('mobileMenu');
  const btn  = document.getElementById('hamburger');
  if (!menu) return;
  const open = menu.classList.toggle('open');
  btn.classList.toggle('open', open);
  document.body.style.overflow = open ? 'hidden' : '';
}
function closeMenu() {
  const menu = document.getElementById('mobileMenu');
  const btn  = document.getElementById('hamburger');
  if (!menu) return;
  menu.classList.remove('open');
  if (btn) btn.classList.remove('open');
  document.body.style.overflow = '';
}

/* ── guest banner ───────────────────────────────────────── */
function renderGuestBanner() {
  document.getElementById('guestBanner').style.display = isLoggedIn() ? 'none' : 'block';
}

/* ── join panel ─────────────────────────────────────────── */
function renderMemberGreeting() {
  const greeting = document.getElementById('memberGreeting');
  const nameEl   = document.getElementById('greetingName');
  const u = DB.currentUser();
  if (!greeting) return;
  if (u) {
    greeting.style.display = 'block';
    if (nameEl) nameEl.textContent = 'Hello, ' + u.name.split(' ')[0] + '.';
  } else {
    greeting.style.display = 'none';
  }
}

/* ── volunteer widget ───────────────────────────────────── */
function applyVolSettings() {
  if (typeof VOL !== 'undefined') {
    VOL.init(db, state.volunteers, state.volSettings, 'volWidget');
  }
}

function isAdminUser() {
  const u = DB.currentUser();
  if (!u) return false;
  const adminPhone = (window.CONFIG && window.CONFIG.adminPhone) ? window.CONFIG.adminPhone.replace(/\D/g,'') : '';
  if (u.phone === adminPhone) return true;
  // check secondary admins — stored in state if we had them, use a simpler check
  return false; // secondary admin check happens server-side via Firestore
}

function onVolDateChange() {
  const dateInput = document.getElementById('volDate');
  const infoEl    = document.getElementById('volDateInfo');
  const spotsEl   = document.getElementById('volSpotsLeft');
  const fullEl    = document.getElementById('volDateFull');
  const blockedEl = document.getElementById('volDateBlocked');
  const btn       = document.getElementById('volSignupBtn');
  if (!dateInput || !dateInput.value) { if (infoEl) infoEl.style.display = 'none'; return; }

  const date     = dateInput.value;
  const settings = state.volSettings;
  const maxSlots = settings.maxPerDate || 3;
  const blocked  = (settings.blockedDates || []);

  if (infoEl) infoEl.style.display = 'block';
  fullEl.style.display    = 'none';
  blockedEl.style.display = 'none';
  if (btn) btn.disabled = false;

  // check blocked
  if (blocked.includes(date)) {
    blockedEl.style.display = 'block';
    if (spotsEl) spotsEl.textContent = '';
    if (btn) btn.disabled = true;
    return;
  }

  // count signups for this date (exclude admins from count)
  const dateData   = state.volunteers[date] || {};
  const signups    = dateData.signups || [];
  const u          = DB.currentUser();
  const adminPhone = (window.CONFIG && window.CONFIG.adminPhone) ? window.CONFIG.adminPhone.replace(/\D/g,'') : '';
  const regularCount = signups.filter(s => s.phone !== adminPhone).length;
  const remaining  = Math.max(0, maxSlots - regularCount);

  if (spotsEl) spotsEl.textContent = remaining + ' of ' + maxSlots + ' spot' + (maxSlots === 1 ? '' : 's') + ' remaining';

  // check if full (admins bypass)
  const isAdmin = u && u.phone === adminPhone;
  if (remaining <= 0 && !isAdmin) {
    fullEl.style.display = 'block';
    if (btn) btn.disabled = true;
  }
}

async function confirmShift() {
  if (!isLoggedIn()) { openAuth('Sign in to sign up for a shift.'); return; }
  const dateInput = document.getElementById('volDate');
  if (!dateInput || !dateInput.value) { toast('Please select a date first.', 'bad'); return; }
  if (!requireStudentId(() => confirmShift())) return;

  const u = DB.currentUser();
  if (!u) { openAuth(); return; }

  const date     = dateInput.value;
  const settings = state.volSettings;
  const maxSlots = settings.maxPerDate || 3;
  const adminPhone = (window.CONFIG && window.CONFIG.adminPhone) ? window.CONFIG.adminPhone.replace(/\D/g,'') : '';
  const isAdmin  = u.phone === adminPhone;

  // re-check availability
  const dateData  = state.volunteers[date] || {};
  const signups   = dateData.signups || [];
  const alreadySigned = signups.some(s => s.phone === u.phone);
  if (alreadySigned) { toast('You are already signed up for this date.', 'bad'); return; }

  const regularCount = signups.filter(s => s.phone !== adminPhone).length;
  if (regularCount >= maxSlots && !isAdmin) { toast('This date is full.', 'bad'); return; }

  // add signup
  const newSignup = {
    phone:     u.phone,
    name:      u.name,
    studentId: u.studentId || '',
    ts:        Date.now(),
    isAdmin:   isAdmin
  };

  const newSignups = [...signups, newSignup];
  try {
    await db.collection('volunteers').doc(date).set({ signups: newSignups });
    const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });
    toast('Signed up for ' + dateLabel + '.', 'ok');

    // email notification via FormSubmit AJAX
    fetch('https://formsubmit.co/ajax/cvhs.composting@gmail.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        _subject: 'New Volunteer Signup — ' + u.name,
        name:       u.name,
        phone:      u.phone,
        student_id: u.studentId || 'not set',
        date:       dateLabel,
        source:     'Club page'
      })
    }).catch(() => {});

    dateInput.value = '';
    onVolDateChange();
    renderMyShifts();
  } catch(e) { toast('Failed to sign up. Try again.', 'bad'); console.error(e); }
}

function renderMyShifts() {
  const el   = document.getElementById('myShifts');
  const tags = document.getElementById('myShiftTags');
  const u    = DB.currentUser();
  if (!el) return;

  // find all dates this user is signed up for
  const myDates = Object.entries(state.volunteers)
    .filter(([date, data]) => (data.signups || []).some(s => s.phone === u?.phone))
    .map(([date]) => date)
    .sort();

  if (!u || !myDates.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  tags.innerHTML = myDates.map(d =>
    '<span class="shift-tag">' + new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' }) + '</span>'
  ).join('');
}

/* ── sms unsubscribe ────────────────────────────────────── */
async function unsubscribeSMS() {
  const u = DB.currentUser();
  if (!u) return;
  if (u.smsOptOut) { toast('You are already unsubscribed from texts.', 'ok'); return; }
  u.smsOptOut = true;
  await DB.upsert(u);
  toast('You have been unsubscribed from text announcements.', 'ok');
  document.getElementById('smsUnsubBtn').textContent = 'Unsubscribed from texts';
  document.getElementById('smsUnsubBtn').disabled = true;
}

/* ── attendance ─────────────────────────────────────────── */
async function submitAttendance() {
  if (!isLoggedIn()) { openAuth('Sign in to log attendance.'); return; }
  if (!requireStudentId(() => submitAttendance())) return;

  const input = document.getElementById('attendanceCode');
  const code  = (input.value || '').trim().toUpperCase();

  if (code.length < 4) { toast('Enter the meeting code.', 'bad'); return; }

  const u = DB.currentUser();
  if (!u) { openAuth(); return; }

  // check code exists in Firestore
  const validCode = state.codes[code];
  if (!validCode) { toast('That code is not valid. Check with your club lead.', 'bad'); return; }

  // check not already logged for this meeting
  u.attendance = u.attendance || [];
  const alreadyLogged = u.attendance.some(a => a.code === code);
  if (alreadyLogged) { toast('You already logged attendance for this meeting.', 'bad'); return; }

  u.attendance.push({ code, ts: Date.now(), meeting: validCode.label || 'Meeting' });
  await DB.upsert(u);
  input.value = '';
  toast('Attendance logged for ' + (validCode.label || 'this meeting') + '.', 'ok');
  renderAttendanceHistory();
}

function renderAttendanceHistory() {
  const el = document.getElementById('attendanceHistory');
  const u  = DB.currentUser();
  if (!u || !(u.attendance || []).length) {
    el.innerHTML = '<p class="empty-state">No attendance logged yet.</p>';
    return;
  }
  const sorted = (u.attendance || []).slice().sort((a, b) => b.ts - a.ts);
  el.innerHTML = '<p style="font-size:.82rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Your attendance</p>' +
    sorted.map(a => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--tan-soft)">
        <span style="font-weight:600;color:var(--green-deep);font-size:.92rem">${a.meeting}</span>
        <span style="font-size:.82rem;color:var(--muted)">${new Date(a.ts).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span>
      </div>`).join('');
}

/* ── announcements ──────────────────────────────────────── */
function renderAnnouncements() {
  const list = document.getElementById('announcementsList');
  if (!list) return;

  if (!state.announcements.length) {
    list.innerHTML = '<p class="empty-state">No announcements yet. Check back soon.</p>';
    return;
  }

  const sorted = [...state.announcements].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.ts - a.ts;
  });

  list.innerHTML = sorted.map(a => `
    <div class="announcement${a.pinned ? ' pinned' : ''}">
      <div class="a-dot"></div>
      <div class="a-body">
        <div class="a-title">
          ${a.title}
          ${a.pinned ? '<span class="a-pin">Pinned</span>' : ''}
        </div>
        <div class="a-msg">${(a.message||"").replace(/\n/g,"<br>")}</div>
        <div class="a-date">${new Date(a.ts).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</div>
      </div>
    </div>`).join('');
}

/* ── calendar ───────────────────────────────────────────── */
function to12hr(t) {
  if (!t) return '';
  const parts = t.split(':');
  let h = parseInt(parts[0]);
  const m = parts[1] || '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return h + ':' + m + ' ' + ampm;
}

function renderCalendar() {
  const el = document.getElementById('eventCalendar');
  if (!el) return;

  const upcoming = state.events
    .filter(e => new Date(e.date) >= new Date())
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 8);

  if (!upcoming.length) {
    el.innerHTML = '<p class="empty-state">No upcoming events yet. Check back soon.</p>';
    return;
  }

  el.innerHTML = upcoming.map(function(e) {
    const gcUrl = buildGoogleCalUrl(e);
    const icsUrl = buildICSUrl(e);
    return '<div class="event-item">' +
      '<div>' +
        '<div class="ei-title">' + e.title + '</div>' +
        '<div class="ei-meta">' + (e.location || '') + (e.start ? ' · ' + to12hr(e.start) : '') + (e.end ? ' – ' + to12hr(e.end) : '') + '</div>' +
        '<div class="ei-cal-links">' +
          '<a href="' + gcUrl + '" target="_blank" rel="noopener" class="ei-cal-btn">+ Google Calendar</a>' +
          '<a href="' + icsUrl + '" download class="ei-cal-btn">+ Apple Calendar</a>' +
        '</div>' +
      '</div>' +
      '<div class="ei-date">' + fmtDate(e.date) + '</div>' +
    '</div>';
  }).join('');
}

/* ── auth (mirrors index auth) ──────────────────────────── */
function openAuth(message) {
  document.getElementById('authSub').textContent = message || 'Sign in to access club features.';
  switchTab('login');
  document.getElementById('authOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeAuth() {
  document.getElementById('authOverlay').classList.remove('open');
  document.body.style.overflow = '';
}
function openJoin() { openAuth('Create an account to join the club.'); switchTab('signup'); }
function switchTab(which) {
  const login = which === 'login';
  document.getElementById('tabLogin').classList.toggle('active',  login);
  document.getElementById('tabSignup').classList.toggle('active', !login);
  document.getElementById('paneLogin').classList.toggle('active',  login);
  document.getElementById('paneSignup').classList.toggle('active', !login);
  document.getElementById('authTitle').textContent = login ? 'Welcome back' : 'Join the club';
}
function browseAsGuest() { setSession('guest'); closeAuth(); renderAll(); }
function logout() { setSession(null); renderAll(); if (typeof VOL !== 'undefined') VOL.renderConfirm(); toast('Logged out.'); }

document.getElementById('signupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f     = e.target;
  const name  = f.name.value.trim();
  const phone = normPhone(f.phone.value);
  if (phone.length < 10) { toast('Enter a valid 10-digit phone number.', 'bad'); return; }
  let u = await findUser(phone);
  if (!u) {
    u = { name, phone, joinedAt: Date.now(), points: 0, contributions: [], shifts: [], attendance: [] };
    await DB.upsert(u);
  }
  setSession(phone); f.reset(); closeAuth(); renderAll();
  if (typeof VOL !== 'undefined') VOL.renderConfirm();
  toast(`Welcome, ${name.split(' ')[0]}.`, 'ok');
  setTimeout(() => { if (!hasStudentId()) openIdModal(); }, 600);
});

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const phone = normPhone(e.target.phone.value);
  if (phone.length < 10) { toast('Enter a valid 10-digit phone number.', 'bad'); return; }
  const u = await findUser(phone);
  if (!u) { toast('No account with that number. Try signing up.', 'bad'); switchTab('signup'); return; }
  setSession(phone); e.target.reset(); closeAuth(); renderAll();
  toast(`Welcome back, ${u.name.split(' ')[0]}.`, 'ok');
  setTimeout(() => { if (!hasStudentId()) openIdModal(); }, 600);
});

/* ── nav scroll ─────────────────────────────────────────── */
window.addEventListener('scroll', () => {
  document.getElementById('nav').classList.toggle('scrolled', window.scrollY > 40);
});

/* ── toast ──────────────────────────────────────────────── */
function toast(msg, kind) {
  const wrap = document.getElementById('toastWrap');
  const t    = document.createElement('div');
  t.className   = 'toast' + (kind ? ' ' + kind : '');
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .4s, transform .4s';
    t.style.opacity    = '0';
    t.style.transform  = 'translateY(10px)';
    setTimeout(() => t.remove(), 400);
  }, 3000);
}

/* ── student ID ─────────────────────────────────────────── */
function hasStudentId() {
  const u = DB.currentUser();
  return !!(u && u.studentId && u.studentId.length === 6);
}
function openIdModal() {
  const overlay = document.getElementById('idOverlay');
  if (!overlay) return;
  const input = document.getElementById('studentIdInput');
  if (input) input.value = '';
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeIdModal() {
  const overlay = document.getElementById('idOverlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}
function requireStudentId(action) {
  if (hasStudentId()) return true;
  window._pendingIdAction = action || null;
  openIdModal();
  return false;
}

const idFormEl = document.getElementById('idForm');
if (idFormEl) {
  idFormEl.addEventListener('submit', async e => {
    e.preventDefault();
    const val = (document.getElementById('studentIdInput').value || '').trim();
    if (val.length !== 6 || !/^\d{6}$/.test(val)) {
      toast('Enter a valid 6-digit student ID.', 'bad');
      return;
    }
    const u = DB.currentUser();
    if (!u) { closeIdModal(); return; }
    u.studentId = val;
    await DB.upsert(u);
    closeIdModal();
    if (typeof VOL !== 'undefined') { VOL.renderConfirm(); VOL.render(); }
    toast('Student ID saved. All features are now unlocked.', 'ok');
    if (typeof window._pendingIdAction === 'function') {
      const fn = window._pendingIdAction;
      window._pendingIdAction = null;
      setTimeout(fn, 250);
    }
  });
}

/* ── calendar helpers ───────────────────────────────────── */
function toISOBasic(dateStr, timeStr) {
  // combine date + optional time into YYYYMMDDTHHMMSS format
  const d = new Date(dateStr);
  if (timeStr) {
    // try to parse "3:30 PM" style
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (match) {
      let h = parseInt(match[1]);
      const m = parseInt(match[2]);
      const ampm = match[3] ? match[3].toUpperCase() : null;
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      d.setHours(h, m, 0);
    }
  }
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function buildGoogleCalUrl(e) {
  const start = toISOBasic(e.date, e.start);
  const end   = toISOBasic(e.date, e.end || e.start);
  const params = new URLSearchParams({
    action:   'TEMPLATE',
    text:     e.title,
    dates:    start + '/' + end,
    location: e.location || '',
    details:  'CV Compost Club event'
  });
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

function buildICSUrl(e) {
  const start = toISOBasic(e.date, e.start);
  const end   = toISOBasic(e.date, e.end || e.start);
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'SUMMARY:' + e.title,
    'DTSTART:' + start,
    'DTEND:' + end,
    'LOCATION:' + (e.location || ''),
    'DESCRIPTION:CV Compost Club',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
}

/* ── scroll helper ──────────────────────────────────────── */
function scrollSection(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

/* ── init ───────────────────────────────────────────────── */
renderNav();
renderGuestBanner();
initFirebase();
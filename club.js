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

const state = { users: {}, events: [], codes: {}, announcements: [], ready: false };

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
  renderJoinPanel();
  renderMyShifts();
  renderAttendanceHistory();
  renderCalendar();
  renderAnnouncements();
}

/* ── nav ────────────────────────────────────────────────── */
function renderNav() {
  const cta = document.getElementById('navCta');
  if (isLoggedIn()) {
    cta.innerHTML = `
      <a href="club.html" class="btn btn-ghost" style="padding:9px 18px">Club page</a>
      <button class="btn btn-primary" style="padding:9px 18px" onclick="logout()">Log out</button>`;
  } else {
    cta.innerHTML = `
      <button class="btn btn-ghost"   style="padding:9px 18px" onclick="openAuth()">Sign in</button>
      <button class="btn btn-primary" style="padding:9px 18px" onclick="openJoin()">Join</button>`;
  }
}

/* ── guest banner ───────────────────────────────────────── */
function renderGuestBanner() {
  document.getElementById('guestBanner').style.display = isLoggedIn() ? 'none' : 'block';
}

/* ── join panel ─────────────────────────────────────────── */
function renderJoinPanel() {
  const u = DB.currentUser();
  if (!u) return;

  // pre-fill name and phone
  const nameInput  = document.getElementById('joinName');
  const phoneInput = document.getElementById('joinPhone');
  if (nameInput)  nameInput.value  = u.name  || '';
  if (phoneInput) phoneInput.value = u.phone || '';

  // if already marked as club member, hide the form
  if (u.clubMember) {
    document.getElementById('joinClubForm').style.display  = 'none';
    document.getElementById('alreadyMember').style.display = 'block';
  }
}

/* ── volunteer shifts ───────────────────────────────────── */
function selectShift(el) {
  document.querySelectorAll('.shift-opt').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  selectedShift = el.dataset.shift;
}

async function confirmShift() {
  if (!isLoggedIn()) { openAuth('Sign in to sign up for a shift.'); return; }
  if (!selectedShift) { toast('Please select a day first.', 'bad'); return; }

  const u = DB.currentUser();
  if (!u) { openAuth(); return; }

  u.shifts = u.shifts || [];

  if (u.shifts.includes(selectedShift)) {
    toast('You are already signed up for ' + selectedShift + '.', 'bad');
    return;
  }

  u.shifts.push(selectedShift);
  await DB.upsert(u);
  toast('Signed up for ' + selectedShift + ' lunch shift.', 'ok');
  selectedShift = null;
  document.querySelectorAll('.shift-opt').forEach(b => b.classList.remove('selected'));
  renderMyShifts();
}

function renderMyShifts() {
  const el = document.getElementById('myShifts');
  const tags = document.getElementById('myShiftTags');
  const u = DB.currentUser();
  if (!u || !(u.shifts || []).length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  tags.innerHTML = u.shifts.map(s =>
    `<span class="shift-tag">${s} lunch</span>`
  ).join('');
}

/* ── attendance ─────────────────────────────────────────── */
async function submitAttendance() {
  if (!isLoggedIn()) { openAuth('Sign in to log attendance.'); return; }

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
  const wrap = document.getElementById('announcementsWrap');
  const list = document.getElementById('announcementsList');
  if (!wrap || !list) return;

  if (!state.announcements.length) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = 'block';

  // pinned first, then by date
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
        <div class="a-msg">${a.message}</div>
        <div class="a-date">${new Date(a.ts).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</div>
      </div>
    </div>`).join('');
}

/* ── calendar ───────────────────────────────────────────── */
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

  el.innerHTML = upcoming.map(e => `
    <div class="event-item">
      <div>
        <div class="ei-title">${e.title}</div>
        <div class="ei-meta">${e.location || ''} ${e.start ? '· ' + e.start : ''}</div>
      </div>
      <div class="ei-date">${fmtDate(e.date)}</div>
    </div>`).join('');
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
function logout() { setSession(null); renderAll(); toast('Logged out.'); }

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
  toast(`Welcome, ${name.split(' ')[0]}.`, 'ok');
});

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const phone = normPhone(e.target.phone.value);
  if (phone.length < 10) { toast('Enter a valid 10-digit phone number.', 'bad'); return; }
  const u = await findUser(phone);
  if (!u) { toast('No account with that number. Try signing up.', 'bad'); switchTab('signup'); return; }
  setSession(phone); e.target.reset(); closeAuth(); renderAll();
  toast(`Welcome back, ${u.name.split(' ')[0]}.`, 'ok');
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

/* ── init ───────────────────────────────────────────────── */
renderNav();
renderGuestBanner();
initFirebase();
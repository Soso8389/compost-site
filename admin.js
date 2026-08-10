/* ============================================================
   CVHS Can Compost — admin.js
   Phase 8: Admin panel.
   Phone number gating + hashed password stored in Firestore.
   ============================================================ */

const CFG         = window.CONFIG || {};
const ADMIN_PHONE  = (CFG.adminPhone || '8182793907').replace(/\D/g, '');
const SMS_URL      = 'https://compost-site.vercel.app/api/send-sms';

let db = null;
const state = { users: {}, events: [], codes: {}, announcements: [], authed: false };

/* ── crypto helpers ─────────────────────────────────────── */
async function sha256(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ── Firebase ───────────────────────────────────────────── */
async function initFirebase() {
  try {
    firebase.initializeApp(CFG.firebase);
    db = firebase.firestore();
    await firebase.auth().signInAnonymously();
  } catch (e) {
    console.error('Firebase failed:', e);
  }
}

/* ── STEP 1: phone check ────────────────────────────────── */
document.getElementById('phoneStep').addEventListener('submit', e => {
  e.preventDefault();
  const entered = document.getElementById('adminPhone').value.replace(/\D/g, '');
  if (entered !== ADMIN_PHONE) {
    toast('That is not the admin number.', 'bad');
    return;
  }
  document.getElementById('phoneStep').style.display    = 'none';
  document.getElementById('passwordStep').style.display = 'block';
  checkFirstTime();
});

async function checkFirstTime() {
  if (!db) return;
  try {
    const doc = await db.collection('admin').doc('auth').get();
    if (!doc.exists || !doc.data().passwordHash) {
      document.getElementById('firstTimeMsg').textContent =
        'First time setup: enter a password to set it.';
      document.getElementById('firstTimeMsg').style.display = 'block';
    }
  } catch (e) {}
}

/* ── STEP 2: password ───────────────────────────────────── */
document.getElementById('passwordStep').addEventListener('submit', async e => {
  e.preventDefault();
  const pw   = document.getElementById('adminPassword').value;
  const hash = await sha256(pw + ADMIN_PHONE);

  try {
    const ref = db.collection('admin').doc('auth');
    const doc = await ref.get();

    if (!doc.exists || !doc.data().passwordHash) {
      // first time — set the password
      await ref.set({ passwordHash: hash });
      toast('Password set. Welcome.', 'ok');
      enterAdmin();
      return;
    }

    if (doc.data().passwordHash !== hash) {
      toast('Incorrect password.', 'bad');
      return;
    }

    enterAdmin();
  } catch (e) {
    toast('Could not verify password. Check your connection.', 'bad');
    console.error(e);
  }
});

/* ── enter admin ────────────────────────────────────────── */
function enterAdmin() {
  state.authed = true;
  sessionStorage.setItem('cvhs_admin', '1');
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('adminView').style.display = 'block';
  startListeners();
}

function adminLogout() {
  sessionStorage.removeItem('cvhs_admin');
  state.authed = false;
  document.getElementById('loginView').style.display = 'flex';
  document.getElementById('adminView').style.display = 'none';
  document.getElementById('phoneStep').style.display    = 'block';
  document.getElementById('passwordStep').style.display = 'none';
  document.getElementById('adminPhone').value    = '';
  document.getElementById('adminPassword').value = '';
}

/* ── live Firestore listeners ───────────────────────────── */
function startListeners() {
  db.collection('users').onSnapshot(snap => {
    snap.forEach(doc => { state.users[doc.id] = doc.data(); });
    renderLeaderboard();
    renderMembers();
  });
  db.collection('events').orderBy('date').onSnapshot(snap => {
    state.events = [];
    snap.forEach(doc => state.events.push({ id: doc.id, ...doc.data() }));
    renderAdminEvents();
  });
  db.collection('codes').onSnapshot(snap => {
    state.codes = {};
    snap.forEach(doc => { state.codes[doc.id] = doc.data(); });
    renderCodes();
  });
  db.collection('announcements').orderBy('ts', 'desc').onSnapshot(snap => {
    state.announcements = [];
    snap.forEach(doc => state.announcements.push({ id: doc.id, ...doc.data() }));
    renderAdminAnnouncements();
  });
}

/* ── tabs ───────────────────────────────────────────────── */
function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b => {
    if (b.textContent.toLowerCase().replace(/\s/g,'').includes(name.replace(/-/g,''))) b.classList.add('active');
  });
}

/* ── announcements ──────────────────────────────────────── */
async function postAnnouncement() {
  const title   = document.getElementById('aTitle').value.trim();
  const message = document.getElementById('aMessage').value.trim();
  const pinned  = document.getElementById('aPinned').checked;
  const sendSMS = document.getElementById('aSendSMS').checked;
  if (!title || !message) { toast('Title and message are required.', 'bad'); return; }
  try {
    await db.collection('announcements').add({ title, message, pinned, ts: Date.now() });

    // send SMS if checked
    if (sendSMS) {
      const phones = Object.values(state.users)
        .map(u => u.phone)
        .filter(Boolean);
      if (phones.length) {
        try {
          const r = await fetch(SMS_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ phones, message: title + ': ' + message })
          });
          const data = await r.json();
          toast('Announcement posted. ' + data.sent + ' text' + (data.sent === 1 ? '' : 's') + ' sent.', 'ok');
        } catch (e) {
          toast('Announcement posted but SMS failed.', 'bad');
          console.error(e);
        }
      } else {
        toast('Announcement posted. No member phone numbers found.', 'ok');
      }
    } else {
      toast('Announcement posted.', 'ok');
    }

    document.getElementById('aTitle').value    = '';
    document.getElementById('aMessage').value  = '';
    document.getElementById('aPinned').checked  = false;
    document.getElementById('aSendSMS').checked = false;
  } catch (e) { toast('Failed to post.', 'bad'); console.error(e); }
}

}

async function deleteAnnouncement(id) {
  if (!confirm('Delete this announcement?')) return;
  try { await db.collection('announcements').doc(id).delete(); toast('Deleted.', 'ok'); }
  catch (e) { toast('Failed to delete.', 'bad'); }
}

async function togglePin(id, current) {
  try { await db.collection('announcements').doc(id).update({ pinned: !current }); toast('Updated.', 'ok'); }
  catch (e) { toast('Failed to update.', 'bad'); }
}

function renderAdminAnnouncements() {
  const el = document.getElementById('adminAnnouncementsList');
  if (!state.announcements.length) { el.innerHTML = '<p class="empty-admin">No announcements yet.</p>'; return; }
  el.innerHTML = state.announcements.map(a => `
    <div class="admin-row">
      <div>
        <div class="ar-title">${a.title} ${a.pinned ? '<span class="badge-sm green">Pinned</span>' : ''}</div>
        <div class="ar-meta">${a.message}</div>
        <div class="ar-meta" style="margin-top:4px">${new Date(a.ts).toLocaleDateString()}</div>
      </div>
      <div class="ar-actions">
        <button class="btn btn-ghost btn-sm" onclick="togglePin('${a.id}', ${!!a.pinned})">${a.pinned ? 'Unpin' : 'Pin'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteAnnouncement('${a.id}')">Delete</button>
      </div>
    </div>`).join('');
}

/* ── events ─────────────────────────────────────────────── */
async function addEvent() {
  const title    = document.getElementById('evTitle').value.trim();
  const date     = document.getElementById('evDate').value;
  const start    = document.getElementById('evStart').value.trim();
  const end      = document.getElementById('evEnd').value.trim();
  const location = document.getElementById('evLocation').value.trim();
  if (!title || !date) { toast('Title and date are required.', 'bad'); return; }
  try {
    await db.collection('events').add({ title, date: new Date(date + 'T00:00:00').toISOString(), start, end, location });
    ['evTitle','evDate','evStart','evEnd','evLocation'].forEach(id => { document.getElementById(id).value = ''; });
    toast('Event added.', 'ok');
  } catch (e) { toast('Failed to add event.', 'bad'); console.error(e); }
}

async function deleteEvent(id) {
  if (!confirm('Delete this event?')) return;
  try { await db.collection('events').doc(id).delete(); toast('Deleted.', 'ok'); }
  catch (e) { toast('Failed to delete.', 'bad'); }
}

function renderAdminEvents() {
  const el = document.getElementById('adminEventsList');
  const upcoming = state.events.filter(e => new Date(e.date) >= new Date());
  if (!upcoming.length) { el.innerHTML = '<p class="empty-admin">No upcoming events.</p>'; return; }
  el.innerHTML = upcoming.map(e => `
    <div class="admin-row">
      <div>
        <div class="ar-title">${e.title}</div>
        <div class="ar-meta">${new Date(e.date).toLocaleDateString()} ${e.start ? '· ' + e.start : ''} ${e.location ? '· ' + e.location : ''}</div>
      </div>
      <div class="ar-actions">
        <button class="btn btn-danger btn-sm" onclick="deleteEvent('${e.id}')">Delete</button>
      </div>
    </div>`).join('');
}

/* ── attendance codes ───────────────────────────────────── */
async function createCode() {
  const val   = document.getElementById('codeVal').value.trim().toUpperCase();
  const label = document.getElementById('codeLabel').value.trim();
  if (!val || !label) { toast('Code and label are required.', 'bad'); return; }
  if (val.length < 4)  { toast('Code must be at least 4 characters.', 'bad'); return; }
  try {
    await db.collection('codes').doc(val).set({ label, ts: Date.now() });
    document.getElementById('codeVal').value   = '';
    document.getElementById('codeLabel').value = '';
    toast('Code created: ' + val, 'ok');
  } catch (e) { toast('Failed to create code.', 'bad'); console.error(e); }
}

async function deleteCode(id) {
  if (!confirm('Delete code ' + id + '?')) return;
  try { await db.collection('codes').doc(id).delete(); toast('Code deleted.', 'ok'); }
  catch (e) { toast('Failed to delete.', 'bad'); }
}

function renderCodes() {
  const el   = document.getElementById('adminCodesList');
  const keys = Object.keys(state.codes);
  if (!keys.length) { el.innerHTML = '<p class="empty-admin">No active codes.</p>'; return; }
  el.innerHTML = keys.map(k => `
    <div class="admin-row">
      <div>
        <div class="ar-title" style="font-family:var(--display);letter-spacing:.1em">${k}</div>
        <div class="ar-meta">${state.codes[k].label} · Created ${new Date(state.codes[k].ts).toLocaleDateString()}</div>
      </div>
      <div class="ar-actions">
        <button class="btn btn-danger btn-sm" onclick="deleteCode('${k}')">Delete</button>
      </div>
    </div>`).join('');
}

/* ── leaderboard ────────────────────────────────────────── */
function thisMonthKey() { const d = new Date(); return d.getFullYear() + '-' + d.getMonth(); }

async function adjustPoints(phone, current) {
  const val = prompt('New point total for this member (current: ' + current + '):');
  if (val === null || val === '') return;
  const n = parseInt(val);
  if (isNaN(n) || n < 0) { toast('Enter a valid number.', 'bad'); return; }

  const u = state.users[phone]; if (!u) return;

  // rebuild contributions to match point total for this month
  const other    = (u.contributions || []).filter(c => {
    const d = new Date(c.ts); return (d.getFullYear() + '-' + d.getMonth()) !== thisMonthKey();
  });
  const thisMonth = Array.from({ length: n }, (_, i) => ({ ts: Date.now() + i, approved: true }));
  u.contributions = [...other, ...thisMonth];
  u.points = n;

  try {
    await db.collection('users').doc(phone).set(u);
    toast('Updated.', 'ok');
  } catch (e) { toast('Failed to update.', 'bad'); }
}

function renderLeaderboard() {
  const el = document.getElementById('adminLeaderboard');
  const users = Object.values(state.users);
  if (!users.length) { el.innerHTML = '<p class="empty-admin">No members yet.</p>'; return; }

  const ranked = users.map(u => ({
    ...u,
    monthPts: (u.contributions || []).filter(c => {
      const d = new Date(c.ts); return (d.getFullYear() + '-' + d.getMonth()) === thisMonthKey();
    }).length
  })).sort((a, b) => b.monthPts - a.monthPts);

  el.innerHTML = ranked.map((u, i) => `
    <div class="admin-row">
      <div style="display:flex;align-items:center;gap:16px">
        <div style="font-family:var(--display);font-size:1.2rem;font-weight:600;color:var(--moss);width:28px;text-align:center">${i + 1}</div>
        <div>
          <div class="ar-title">${u.name}</div>
          <div class="ar-meta">${u.phone} · ${(u.contributions||[]).length} all-time</div>
        </div>
      </div>
      <div class="ar-actions" style="align-items:center">
        <span class="member-pts">${u.monthPts} pts</span>
        <button class="btn btn-ghost btn-sm" onclick="adjustPoints('${u.phone}', ${u.monthPts})">Edit</button>
      </div>
    </div>`).join('');
}

/* ── members ────────────────────────────────────────────── */
function renderMembers() {
  const el    = document.getElementById('adminMembersList');
  const users = Object.values(state.users);
  if (!users.length) { el.innerHTML = '<p class="empty-admin">No members yet.</p>'; return; }

  const sorted = users.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  el.innerHTML = sorted.map(u => `
    <div class="admin-row">
      <div>
        <div class="ar-title">${u.name}</div>
        <div class="ar-meta">
          ${u.phone}
          · Joined ${new Date(u.joinedAt || 0).toLocaleDateString()}
          · ${(u.shifts || []).length} shift${(u.shifts||[]).length === 1 ? '' : 's'}
          · ${(u.attendance || []).length} meeting${(u.attendance||[]).length === 1 ? '' : 's'} attended
        </div>
      </div>
      <div class="ar-actions">
        <span class="badge-sm ${(u.contributions||[]).length > 0 ? 'green' : 'tan'}">${(u.contributions||[]).length} contributions</span>
        <button class="btn btn-danger btn-sm" onclick="deleteMember('${u.phone}')">Remove</button>
      </div>
    </div>`).join('');
}

/* ── delete member ─────────────────────────────────────── */
async function deleteMember(phone) {
  if (!confirm('Delete this member? This cannot be undone.')) return;
  try {
    await db.collection('users').doc(phone).delete();
    delete state.users[phone];
    toast('Member removed.', 'ok');
    renderMembers();
    renderLeaderboard();
  } catch (e) { toast('Failed to delete.', 'bad'); console.error(e); }
}

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
// stay logged in for the session
if (sessionStorage.getItem('cvhs_admin') === '1') {
  initFirebase().then(enterAdmin);
} else {
  initFirebase();
}
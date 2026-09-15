/* ============================================================
   CVHS Can Compost — admin.js
   Phase 8: Admin panel.
   Phone number gating + hashed password stored in Firestore.
   ============================================================ */

const CFG         = window.CONFIG || {};
const ADMIN_PHONE  = (CFG.adminPhone || '8182793907').replace(/\D/g, '');
const SMS_URL      = 'https://compost-site.vercel.app/api/send-sms';

let db = null;
const state = { users: {}, events: [], codes: {}, announcements: [], admins: {}, giftcards: [], lbs: 0, authed: false, isSuper: false, permissions: [] };

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
document.getElementById('phoneStep').addEventListener('submit', async e => {
  e.preventDefault();
  const entered = document.getElementById('adminPhone').value.replace(/\D/g, '');

  if (entered === ADMIN_PHONE) {
    document.getElementById('phoneStep').style.display    = 'none';
    document.getElementById('passwordStep').style.display = 'block';
    checkFirstTime();
    return;
  }

  // check if secondary admin
  try {
    const doc = await db.collection('admin').doc('secondary').get();
    if (doc.exists && doc.data().admins && doc.data().admins[entered]) {
      document.getElementById('phoneStep').style.display    = 'none';
      document.getElementById('passwordStep').style.display = 'block';
      const entry = doc.data().admins[entered];
      if (!entry.passwordHash) {
        document.getElementById('firstTimeMsg').textContent = 'First time setup: enter a password to set it.';
        document.getElementById('firstTimeMsg').style.display = 'block';
      }
      return;
    }
  } catch(err) { console.warn(err); }

  toast('That is not an admin number.', 'bad');
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
  const pw      = document.getElementById('adminPassword').value;
  const phone   = document.getElementById('adminPhone').value.replace(/\D/g,'');
  const isSuper = phone === ADMIN_PHONE;
  const hash    = await sha256(pw + phone);

  try {
    if (isSuper) {
      // super admin
      const ref = db.collection('admin').doc('auth');
      const doc = await ref.get();
      if (!doc.exists || !doc.data().passwordHash) {
        await ref.set({ passwordHash: hash });
        toast('Password set. Welcome.', 'ok');
        enterAdmin(phone, true, []);
        return;
      }
      if (doc.data().passwordHash !== hash) { toast('Incorrect password.', 'bad'); return; }
      enterAdmin(phone, true, []);
    } else {
      // secondary admin
      const ref = db.collection('admin').doc('secondary');
      const doc = await ref.get();
      if (!doc.exists) { toast('No admin account found for that number.', 'bad'); return; }
      const admins = doc.data().admins || {};
      const entry  = admins[phone];
      if (!entry)  { toast('No admin account found for that number.', 'bad'); return; }
      if (!entry.passwordHash) {
        // first time — set password
        admins[phone].passwordHash = hash;
        await ref.set({ admins });
        toast('Password set. Welcome.', 'ok');
        enterAdmin(phone, false, entry.permissions || []);
        return;
      }
      if (entry.passwordHash !== hash) { toast('Incorrect password.', 'bad'); return; }
      enterAdmin(phone, false, entry.permissions || []);
    }
  } catch (err) {
    toast('Could not verify password. Check your connection.', 'bad');
    console.error(err);
  }
});

/* ── enter admin ────────────────────────────────────────── */
function enterAdmin(phone, isSuper, permissions) {
  state.authed      = true;
  state.isSuper     = isSuper;
  state.permissions = permissions || [];
  sessionStorage.setItem('cvhs_admin', '1');
  sessionStorage.setItem('cvhs_admin_super', isSuper ? '1' : '0');
  sessionStorage.setItem('cvhs_admin_perms', JSON.stringify(permissions || []));
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('adminView').style.display = 'block';
  applyPermissions();
  startListeners();
}

function applyPermissions() {
  if (state.isSuper) return; // super admin sees everything
  const allowed = state.permissions;
  const allTabs = ['announcements','events','codes','leaderboard','members','giftcards','stats','admins'];
  allTabs.forEach(tab => {
    const btn   = document.querySelector(`.tab-btn[onclick="showTab('${tab}')"]`);
    const panel = document.getElementById('tab-' + tab);
    if (!allowed.includes(tab)) {
      if (btn)   btn.style.display   = 'none';
      if (panel) panel.style.display = 'none';
    }
  });
  // show first allowed tab
  if (allowed.length) showTab(allowed[0]);
}

function adminLogout() {
  sessionStorage.removeItem('cvhs_admin');
  sessionStorage.removeItem('cvhs_admin_super');
  sessionStorage.removeItem('cvhs_admin_perms');
  state.authed = false; state.isSuper = false; state.permissions = [];
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

  db.collection('giftcards').orderBy('addedAt').onSnapshot(snap => {
    state.giftcards = [];
    snap.forEach(doc => state.giftcards.push({ id: doc.id, ...doc.data() }));
    renderAdminGiftCards();
  });

  db.collection('admin').doc('secondary').onSnapshot(doc => {
    state.admins = doc.exists ? (doc.data().admins || {}) : {};
    renderAdminsList();
  });

  db.collection('system').doc('stats').onSnapshot(doc => {
    state.lbs = doc.exists ? (doc.data().lbs || 0) : 0;
    const el = document.getElementById('currentLbs');
    if (el) el.textContent = state.lbs;
    const inp = document.getElementById('lbsInput');
    if (inp && !inp.value) inp.value = state.lbs;
  });
}

/* ── tabs ───────────────────────────────────────────────── */
function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById('tab-' + name);
  if (!panel) { console.warn('Tab panel not found: tab-' + name); return; }
  panel.classList.add('active');
  const btn = document.querySelector(`.tab-btn[onclick="showTab('${name}')"]`);
  if (btn) btn.classList.add('active');
  // re-render the active tab content
  const renders = {
    announcements: renderAdminAnnouncements,
    events:        renderAdminEvents,
    codes:         renderCodes,
    leaderboard:   renderLeaderboard,
    members:       renderMembers,
    giftcards:     renderAdminGiftCards,
    admins:        renderAdminsList,
  };
  if (renders[name]) renders[name]();
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
        .filter(u => !u.smsOptOut)
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
  const sel  = document.getElementById('minutesCode');
  const keys = Object.keys(state.codes);

  if (!keys.length) { el.innerHTML = '<p class="empty-admin">No active codes.</p>'; }
  else {
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

  // populate minutes code selector
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="" disabled>Select a code</option>' +
      keys.map(k => `<option value="${k}">${k} — ${state.codes[k].label}</option>`).join('');
    if (prev && keys.includes(prev)) sel.value = prev;
    else sel.selectedIndex = 0;
  }
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
        <div class="ar-title">${u.name} ${u.smsOptOut ? '<span class="badge-sm tan">No SMS</span>' : ''}</div>
        <div class="ar-meta">
          ${u.phone}
          · ID: ${u.studentId || '<span style="color:#c17f24">not set</span>'}
          · Joined ${new Date(u.joinedAt || 0).toLocaleDateString()}
          · ${(u.shifts || []).length} shift${(u.shifts||[]).length === 1 ? '' : 's'}
          · ${(u.attendance || []).length} meeting${(u.attendance||[]).length === 1 ? '' : 's'} attended
        </div>
      </div>
      <div class="ar-actions">
        <span class="badge-sm ${(u.contributions||[]).length > 0 ? 'green' : 'tan'}">${(u.contributions||[]).length} contributions</span>
        <button class="btn btn-ghost btn-sm" onclick="toggleSMS('${u.phone}', ${!!u.smsOptOut})">${u.smsOptOut ? 'Enable SMS' : 'Opt out SMS'}</button>
        <button class="btn btn-danger btn-sm" onclick="deleteMember('${u.phone}')">Remove</button>
      </div>
    </div>`).join('');
}

/* ── sms opt out ────────────────────────────────────────── */
async function toggleSMS(phone, currentlyOptedOut) {
  const u = state.users[phone]; if (!u) return;
  u.smsOptOut = !currentlyOptedOut;
  try {
    await db.collection('users').doc(phone).update({ smsOptOut: u.smsOptOut });
    toast(u.name + (u.smsOptOut ? ' opted out of SMS.' : ' will receive SMS.'), 'ok');
    renderMembers();
  } catch(e) { toast('Failed to update.', 'bad'); }
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

/* ── gift cards ─────────────────────────────────────────── */
async function addGiftCard() {
  const name  = document.getElementById('gcName').value.trim();
  const image = document.getElementById('gcImage').value.trim();
  if (!name) { toast('Name is required.', 'bad'); return; }
  try {
    await db.collection('giftcards').add({ name, image: image || '', addedAt: Date.now(), active: true });
    document.getElementById('gcName').value  = '';
    document.getElementById('gcImage').value = '';
    toast(name + ' gift card added.', 'ok');
  } catch(e) { toast('Failed to add.', 'bad'); console.error(e); }
}

async function removeGiftCard(id, name) {
  if (!confirm('Remove the ' + name + ' gift card? Members will no longer be able to enter for it.')) return;
  try {
    await db.collection('giftcards').doc(id).delete();
    toast(name + ' removed.', 'ok');
  } catch(e) { toast('Failed to remove.', 'bad'); }
}

function renderAdminGiftCards() {
  const el = document.getElementById('adminGiftCardsList');
  if (!el) return;
  if (!state.giftcards.length) {
    el.innerHTML = '<p class="empty-admin">No gift cards yet. Add one above.</p>';
    return;
  }
  el.innerHTML = state.giftcards.map(gc => `
    <div class="admin-row">
      <div style="display:flex;align-items:center;gap:14px">
        ${gc.image ? `<img src="${gc.image}" alt="${gc.name}" style="width:48px;height:36px;object-fit:cover;border-radius:6px;background:var(--tan-soft)" />` : ''}
        <div>
          <div class="ar-title">${gc.name}</div>
          <div class="ar-meta">${gc.image || 'No image set'}</div>
        </div>
      </div>
      <div class="ar-actions">
        <button class="btn btn-danger btn-sm" onclick="removeGiftCard('${gc.id}', '${gc.name}')">Remove</button>
      </div>
    </div>`).join('');
}

/* ── lbs stat ───────────────────────────────────────────── */
async function saveLbs() {
  const val = parseInt(document.getElementById('lbsInput').value);
  if (isNaN(val) || val < 0) { toast('Enter a valid number.', 'bad'); return; }
  try {
    await db.collection('system').doc('stats').set({ lbs: val });
    toast('Pounds composted updated to ' + val + '.', 'ok');
    document.getElementById('currentLbs').textContent = val;
  } catch (e) { toast('Failed to save.', 'bad'); console.error(e); }
}

/* ── secondary admins ───────────────────────────────────── */
async function addSecondaryAdmin() {
  const phone = document.getElementById('newAdminPhone').value.replace(/\D/g,'');
  if (phone.length < 10) { toast('Enter a valid phone number.', 'bad'); return; }
  if (phone === ADMIN_PHONE) { toast('That is the primary admin number.', 'bad'); return; }

  const checked = [...document.querySelectorAll('.admin-perm:checked')].map(c => c.value);
  if (!checked.length) { toast('Select at least one permission.', 'bad'); return; }

  try {
    const ref = db.collection('admin').doc('secondary');
    const doc = await ref.get();
    const admins = doc.exists ? (doc.data().admins || {}) : {};
    admins[phone] = { phone, permissions: checked, addedAt: Date.now(), passwordHash: null };
    await ref.set({ admins });
    document.getElementById('newAdminPhone').value = '';
    document.querySelectorAll('.admin-perm').forEach(c => c.checked = false);
    toast('Secondary admin added. They can now log in and set their password.', 'ok');
  } catch (e) { toast('Failed to add admin.', 'bad'); console.error(e); }
}

async function removeSecondaryAdmin(phone) {
  if (!confirm('Remove this admin?')) return;
  try {
    const ref = db.collection('admin').doc('secondary');
    const doc = await ref.get();
    const admins = doc.exists ? (doc.data().admins || {}) : {};
    delete admins[phone];
    await ref.set({ admins });
    toast('Admin removed.', 'ok');
  } catch (e) { toast('Failed to remove.', 'bad'); }
}

function renderAdminsList() {
  const el = document.getElementById('adminsList');
  if (!el) return;
  const list = Object.values(state.admins);
  if (!list.length) { el.innerHTML = '<p class="empty-admin">No secondary admins yet.</p>'; return; }
  el.innerHTML = list.map(a => `
    <div class="admin-row">
      <div>
        <div class="ar-title">${formatPhone(a.phone)}</div>
        <div class="ar-meta">Permissions: ${a.permissions.join(', ')} &middot; ${a.passwordHash ? 'Password set' : 'Awaiting first login'}</div>
      </div>
      <div class="ar-actions">
        <button class="btn btn-danger btn-sm" onclick="removeSecondaryAdmin('${a.phone}')">Remove</button>
      </div>
    </div>`).join('');
}

function formatPhone(p) {
  const m = (p||'').replace(/\D/g,'');
  return m.length === 10 ? '('+m.slice(0,3)+') '+m.slice(3,6)+'-'+m.slice(6) : p;
}

/* ── compile minutes ────────────────────────────────────── */
// ADD YOUR NAME HERE (president / presiding officer / who prepared)
const PRESIDENT_NAME = 'Soren Cooper';
// ADD VP NAME HERE
const VP_NAME = 'William Federanko';

function compileMinutes() {
  const code = document.getElementById('minutesCode').value;
  if (!code) { toast('Select a meeting code first.', 'bad'); return; }

  const codeData  = state.codes[code];
  const dateVal   = document.getElementById('minutesDate').value;
  const timeStart = document.getElementById('minutesTime').value.trim()      || 'N/A';
  const timeAdj   = document.getElementById('minutesAdjourned').value.trim() || 'N/A';
  const location  = document.getElementById('minutesLocation').value.trim()  || 'N/A';
  const agenda1   = document.getElementById('minutesAgenda1').value.trim();
  const agenda2   = document.getElementById('minutesAgenda2').value.trim();
  const agenda3   = document.getElementById('minutesAgenda3').value.trim();
  const action1   = document.getElementById('minutesAction1').value.trim();
  const action2   = document.getElementById('minutesAction2').value.trim();
  const action3   = document.getElementById('minutesAction3').value.trim();
  const asb       = document.getElementById('minutesASB').value.trim()    || 'Nothing to currently communicate.';
  const notes     = document.getElementById('minutesNotes').value.trim()  || 'None.';

  if (!dateVal) { toast('Please enter the meeting date.', 'bad'); return; }

  const dateStr = new Date(dateVal + 'T00:00:00').toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  // get attendees who used this code
  const attendees = Object.values(state.users).filter(u =>
    (u.attendance || []).some(a => a.code === code)
  ).map(u => u.name + (u.studentId ? ' (ID: ' + u.studentId + ')' : '')).sort();

  // build PDF using jsPDF
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const margin = 72;
  const pageW  = doc.internal.pageSize.getWidth();
  const pageH  = doc.internal.pageSize.getHeight();
  let y = margin;

  function addLine(text, opts) {
    opts = opts || {};
    const size   = opts.size   || 11;
    const bold   = opts.bold   || false;
    const indent = opts.indent || 0;
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(text, pageW - margin * 2 - indent);
    lines.forEach(function(line) {
      if (y > pageH - margin) { doc.addPage(); y = margin; }
      doc.text(line, margin + indent, y);
      y += size * 1.5;
    });
    y += opts.after || 0;
  }

  function addSection(title) {
    y += 6;
    doc.setDrawColor(180, 180, 180);
    doc.line(margin, y, pageW - margin, y);
    y += 14;
    addLine(title, { bold: true, size: 12 });
  }

  function addField(label, value) {
    addLine(label + ': ' + value, { size: 11 });
  }

  function addNumberedList(items) {
    var num = 1;
    items.filter(Boolean).forEach(function(item) {
      addLine(num + '. ' + item, { indent: 12 });
      num++;
    });
    if (num === 1) addLine('None.', { indent: 12 });
  }

  function addSignatureLine(label, name) {
    y += 24;
    if (y > pageH - margin - 60) { doc.addPage(); y = margin; }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const lineEnd = margin + 260;
    doc.line(margin, y, lineEnd, y);
    doc.text(label + (name ? '   ' + name : ''), margin, y + 14);
    y += 36;
  }

  // TITLE
  addLine('Meeting Minutes — CV Compost Club', { bold: true, size: 16, after: 4 });

  // HEADER INFO
  addSection('Meeting Information');
  addField('Date',      dateStr);
  addField('Time',      timeStart);
  addField('Adjourned', timeAdj);
  addField('Location',  location);
  addField('Presiding Officer', PRESIDENT_NAME || '[ADD YOUR NAME]');
  addField('Meeting Code', code + ' — ' + (codeData ? codeData.label : ''));

  // ATTENDANCE
  addSection('Attendance');
  if (attendees.length) {
    attendees.forEach(function(a) { addLine('• ' + a, { indent: 12 }); });
  } else {
    addLine('No attendance records found for this code.', { indent: 12 });
  }

  // AGENDA
  addSection('Agenda Items (Discussion Topics)');
  addNumberedList([agenda1, agenda2, agenda3]);

  // ACTION ITEMS
  addSection('Action Items (Decisions Made)');
  addNumberedList([action1, action2, action3]);

  // COMMITTEES
  addSection('Report of Committees');
  addLine('N/A', { indent: 12 });

  // ASB
  addSection('Communications with ASB');
  addLine(asb, { indent: 12 });

  // NOTES
  addSection('Other Notes');
  addLine(notes, { indent: 12 });

  // SIGNATURES
  addSection('Submitted By');
  addLine('Prepared by: ' + (PRESIDENT_NAME || '[ADD YOUR NAME]'), { size: 11 });
  y += 20;
  addSignatureLine('Club President', PRESIDENT_NAME);
  addSignatureLine('Club VP', VP_NAME);
  addSignatureLine('Club Advisor', '');

  // save
  const filename = 'Minutes_CVCompostClub_' + dateVal + '.pdf';
  doc.save(filename);
  toast('Minutes PDF downloaded.', 'ok');
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
  const isSuper = sessionStorage.getItem('cvhs_admin_super') === '1';
  const perms   = JSON.parse(sessionStorage.getItem('cvhs_admin_perms') || '[]');
  initFirebase().then(() => enterAdmin(null, isSuper, perms));
} else {
  initFirebase();
}
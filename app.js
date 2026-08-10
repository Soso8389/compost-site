/* ============================================================
   CVHS Can Compost — app.js
   Phase 3: User accounts.
   Sign up / log in by phone number. Session in localStorage.
   User documents stored in Firestore.
   ============================================================ */

const CFG = window.CONFIG || {};
const FB  = CFG.firebase || {};
const USE_FIRESTORE = !!(FB.apiKey && FB.projectId);

let db = null;

/* ── state ──────────────────────────────────────────────── */
const state = { users: {}, ready: false };

/* ── helpers ────────────────────────────────────────────── */
function normPhone(p)   { return (p || '').replace(/\D/g, ''); }
function formatPhone(p) { const m = normPhone(p); return m.length === 10 ? `(${m.slice(0,3)}) ${m.slice(3,6)}-${m.slice(6)}` : p; }

/* ── session helpers (localStorage only, instant) ───────── */
function getSession()    { return localStorage.getItem('cvhs_session') || null; }
function setSession(v)   { v ? localStorage.setItem('cvhs_session', v) : localStorage.removeItem('cvhs_session'); }
function isLoggedIn()    { const s = getSession(); return !!(s && s !== 'guest'); }

/* ── Firebase init ──────────────────────────────────────── */
async function initFirebase() {
  if (!USE_FIRESTORE) {
    state.users = JSON.parse(localStorage.getItem('cvhs_users') || '{}');
    state.ready = true;
    return;
  }
  try {
    firebase.initializeApp(FB);
    db = firebase.firestore();
    await firebase.auth().signInAnonymously();
    db.collection('users').onSnapshot(snap => {
      snap.forEach(doc => { state.users[doc.id] = doc.data(); });
      state.ready = true;
      renderBoard();
    }, err => console.error('Firestore error:', err));
  } catch (e) {
    console.error('Firebase failed to connect:', e);
  }
}

/* ── DB ─────────────────────────────────────────────────── */
const DB = {
  user(phone)  { return state.users[normPhone(phone)] || null; },

  async upsert(u) {
    state.users[u.phone] = u;
    if (USE_FIRESTORE && db) {
      try { await db.collection('users').doc(u.phone).set(u); }
      catch (e) { console.warn('Save failed:', e); }
    } else {
      localStorage.setItem('cvhs_users', JSON.stringify(state.users));
    }
  },

  currentUser() {
    const s = getSession();
    if (!s || s === 'guest') return null;
    return this.user(s);
  }
};

async function findUser(phone) {
  phone = normPhone(phone);
  if (state.users[phone]) return state.users[phone];
  if (USE_FIRESTORE && db) {
    try {
      const doc = await db.collection('users').doc(phone).get();
      if (doc.exists) { state.users[phone] = doc.data(); return doc.data(); }
    } catch (e) { console.warn('Lookup failed:', e); }
  }
  return null;
}

/* ── nav ─────────────────────────────────────────────────── */
function renderNav() {
  const cta      = document.getElementById('navCta');
  const hero     = document.getElementById('heroActions');
  const mobileAuth = document.getElementById('mobileMenuAuth');

  if (isLoggedIn()) {
    cta.innerHTML = `
      <a href="club.html" class="btn btn-ghost" style="padding:9px 18px">Club page</a>
      <button class="btn btn-primary" style="padding:9px 18px" onclick="logout()">Log out</button>`;
    if (hero) hero.innerHTML = `
      <a href="club.html" class="btn btn-primary">Club page</a>
      <button class="btn btn-ghost" onclick="logout()">Log out</button>`;
    if (mobileAuth) mobileAuth.innerHTML = `
      <a href="club.html" class="m-primary" onclick="closeMenu()">Club page</a>
      <button onclick="logout();closeMenu()" style="color:var(--muted)">Log out</button>`;
  } else {
    cta.innerHTML = `
      <button class="btn btn-ghost"   style="padding:9px 18px" onclick="openAuth()">Sign in</button>
      <button class="btn btn-primary" style="padding:9px 18px" onclick="openJoin()">Join</button>`;
    if (hero) hero.innerHTML = `
      <button class="btn btn-primary" onclick="openJoin()">Get involved</button>
      <a href="#gogreen" class="btn btn-ghost">Win a gift card</a>`;
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

/* ── auth ───────────────────────────────────────────────── */
function openAuth(message) {
  document.getElementById('authSub').textContent = message ||
    'Sign up or log in to track contributions and manage shifts.';
  switchTab('login');
  document.getElementById('authOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeAuth() {
  document.getElementById('authOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function openJoin() {
  openAuth('Create your account to join the composting club.');
  switchTab('signup');
}

function switchTab(which) {
  const login = which === 'login';
  document.getElementById('tabLogin').classList.toggle('active',  login);
  document.getElementById('tabSignup').classList.toggle('active', !login);
  document.getElementById('paneLogin').classList.toggle('active',  login);
  document.getElementById('paneSignup').classList.toggle('active', !login);
  document.getElementById('authTitle').textContent = login ? 'Welcome back' : 'Join the club';
}

function browseAsGuest() {
  setSession('guest');
  closeAuth();
  renderNav();
  toast('Browsing as guest.');
}

function logout() {
  setSession(null);
  renderNav();
  toast('Logged out.');
}

/* ── sign up ────────────────────────────────────────────── */
document.getElementById('signupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f     = e.target;
  const name  = f.name.value.trim();
  const phone = normPhone(f.phone.value);

  if (phone.length < 10) { toast('Enter a valid 10-digit phone number.', 'bad'); return; }

  let u = await findUser(phone);
  if (u) {
    toast('That number already has an account. Logging you in.', 'ok');
  } else {
    u = { name, phone, joinedAt: Date.now(), points: 0, contributions: [], shifts: [] };
    await DB.upsert(u);
  }

  setSession(phone);
  f.reset();
  closeAuth();
  renderNav();
  toast(`Welcome, ${name.split(' ')[0]}.`, 'ok');
});

/* ── log in ─────────────────────────────────────────────── */
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const phone = normPhone(e.target.phone.value);

  if (phone.length < 10) { toast('Enter a valid 10-digit phone number.', 'bad'); return; }

  const u = await findUser(phone);
  if (!u) {
    toast('No account with that number. Try signing up.', 'bad');
    switchTab('signup');
    return;
  }

  setSession(phone);
  e.target.reset();
  closeAuth();
  renderNav();
  toast(`Welcome back, ${u.name.split(' ')[0]}.`, 'ok');
});


/* ── gift card modal ────────────────────────────────────── */
function openGiftModal(type) {
  const u = DB.currentUser();

  // hide both sections first
  document.getElementById('giftForm').style.display    = 'none';
  document.getElementById('giftGuestMsg').style.display = 'none';

  const isStarbucks = type === 'starbucks';
  document.getElementById('giftModalImg').src         = isStarbucks ? 'starbucks.jpg' : 'ohoo.jpg';
  document.getElementById('giftModalImg').alt         = isStarbucks ? 'Starbucks' : 'Ohoo';
  document.getElementById('giftModalTitle').textContent = 'Claim your ' + (isStarbucks ? 'Starbucks' : 'Ohoo') + ' gift card';

  if (!u) {
    document.getElementById('giftModalSub').textContent = 'You need an account to claim a gift card.';
    document.getElementById('giftGuestMsg').style.display = 'block';
  } else {
    document.getElementById('giftModalSub').textContent = 'Upload a photo of your compost contribution to submit your claim.';
    document.getElementById('giftForm').style.display    = 'block';

    // pre-fill hidden fields
    document.getElementById('giftCardType').value    = isStarbucks ? 'Starbucks' : 'Ohoo';
    document.getElementById('giftMemberName').value  = u.name;
    document.getElementById('giftMemberPhone').value = u.phone;
    document.getElementById('giftSubject').value     = 'Gift Card Claim (' + (isStarbucks ? 'Starbucks' : 'Ohoo') + ') — ' + u.name;

    // approval links — point back to your site
    const base = window.location.origin + window.location.pathname.replace('index.html', '');
    document.getElementById('giftApproveUrl').value = base + 'approve.html?phone=' + u.phone;
    document.getElementById('giftDenyUrl').value    = base + 'deny.html';
  }

  document.getElementById('giftOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeGiftModal() {
  document.getElementById('giftOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* ── nav scroll ─────────────────────────────────────────── */
window.addEventListener('scroll', () => {
  document.getElementById('nav').classList.toggle('scrolled', window.scrollY > 40);
});

/* ── scroll reveal ──────────────────────────────────────── */
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); observer.unobserve(e.target); }
  });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

/* ── leaderboard ────────────────────────────────────────── */
function thisMonthKey() {
  const d = new Date();
  return d.getFullYear() + '-' + d.getMonth();
}

function renderBoard() {
  const board = document.getElementById('board');
  if (!board) return;

  const users = Object.values(state.users);
  if (!users.length) {
    board.innerHTML = '<div class="empty-board">No contributions yet this month. Be the first.</div>';
    return;
  }

  // rank by points this month
  const ranked = users
    .map(u => ({
      name:   u.name,
      phone:  u.phone,
      points: (u.contributions || [])
                .filter(c => {
                  const d = new Date(c.ts);
                  return (d.getFullYear() + '-' + d.getMonth()) === thisMonthKey();
                }).length
    }))
    .filter(u => u.points > 0)
    .sort((a, b) => b.points - a.points);

  if (!ranked.length) {
    board.innerHTML = '<div class="empty-board">No approved contributions yet this month. Be the first.</div>';
    return;
  }

  const session = getSession();
  board.innerHTML = ranked.slice(0, 10).map((u, i) => {
    const isYou = u.phone === session;
    const isFirst = i === 0;
    return `<div class="board-row${isFirst ? ' lead-row' : ''}">
      <div class="rank">${i + 1}</div>
      <div>
        <div class="who">${u.name}${isYou ? ' <span class="you-tag">you</span>' : ''}${isFirst ? ' <span class="lead-tag">Leading</span>' : ''}</div>
      </div>
      <div class="count">${u.points} pt${u.points === 1 ? '' : 's'}</div>
    </div>`;
  }).join('');
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
renderNav();     // instant — reads localStorage, no Firebase needed
renderBoard();   // renders placeholder until Firestore loads
initFirebase();  // async — loads Firestore data in background
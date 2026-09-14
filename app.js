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
const state = { users: {}, giftcards: [], lbs: 0, ready: false };

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
    // gift cards
    db.collection('giftcards').orderBy('addedAt').onSnapshot(snap => {
      state.giftcards = [];
      snap.forEach(doc => state.giftcards.push({ id: doc.id, ...doc.data() }));
      renderGiftCardButtons();
      renderBoard(); // re-render gallery when cards load
    }, err => {
      console.error('Gift cards error:', err);
      renderGiftCardButtons();
      renderBoard();
    });

    // listen for lbs stat
    db.collection('system').doc('stats').onSnapshot(doc => {
      if (doc.exists) { state.lbs = doc.data().lbs || 0; renderStats(); }
    });

    db.collection('users').onSnapshot(snap => {
      const next = {};
      snap.forEach(doc => { next[doc.id] = doc.data(); });
      state.users = next;
      state.ready = true;
      renderBoard();
      renderStats();
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


/* ── student ID modal ───────────────────────────────────── */
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
function hasStudentId() {
  const u = DB.currentUser();
  return !!(u && u.studentId && u.studentId.length === 6);
}
function requireStudentId(action) {
  if (hasStudentId()) return true;
  openIdModal();
  // store action to run after ID is saved
  window._pendingIdAction = action || null;
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
    toast('Student ID saved. All features are now unlocked.', 'ok');
    if (typeof window._pendingIdAction === 'function') {
      const fn = window._pendingIdAction;
      window._pendingIdAction = null;
      setTimeout(fn, 250);
    }
  });
}

/* ── gift card buttons ──────────────────────────────────── */
function renderGiftCardButtons() {
  const el = document.getElementById('giftCardButtons');
  if (!el) return;
  if (!state.giftcards.length) {
    el.innerHTML = '<p style="color:#9fb091;font-size:.9rem">No gift cards available right now.</p>';
    return;
  }
  el.innerHTML = state.giftcards.map(gc => `
    <button class="gift-btn" onclick="openGiftModal('${gc.id}')">
      ${gc.image ? `<img src="${gc.image}" alt="${gc.name}" />` : ''}
      Claim ${gc.name} gift card
    </button>`).join('');
}

/* ── gift card modal ────────────────────────────────────── */
function openGiftModal(cardId) {
  const u  = DB.currentUser();
  if (u && !hasStudentId()) {
    requireStudentId(() => openGiftModal(cardId));
    return;
  }

  // look up card from state
  const gc = state.giftcards.find(c => c.id === cardId) || { id: cardId, name: cardId, image: '' };

  // hide both sections first
  document.getElementById('giftForm').style.display    = 'none';
  document.getElementById('giftGuestMsg').style.display = 'none';

  document.getElementById('giftModalImg').src           = gc.image || '';
  document.getElementById('giftModalImg').alt           = gc.name;
  document.getElementById('giftModalImg').style.display = gc.image ? 'block' : 'none';
  document.getElementById('giftModalTitle').textContent = 'Claim your ' + gc.name + ' gift card';

  if (!u) {
    document.getElementById('giftModalSub').textContent = 'You need an account to claim a gift card.';
    document.getElementById('giftGuestMsg').style.display = 'block';
  } else {
    document.getElementById('giftModalSub').textContent = 'Upload a photo of your compost contribution to submit your claim.';
    document.getElementById('giftForm').style.display    = 'block';

    document.getElementById('giftCardType').value    = gc.name;
    document.getElementById('giftMemberName').value  = u.name;
    document.getElementById('giftMemberPhone').value = u.phone;
    document.getElementById('giftSubject').value     = 'Gift Card Claim (' + gc.name + ') — ' + u.name;

    const base = window.location.origin + window.location.pathname.replace('index.html', '');
    document.getElementById('giftApproveUrl').value = base + 'approve.html?phone=' + u.phone + '&card=' + encodeURIComponent(gc.name);
    document.getElementById('giftDenyUrl').value    = base + 'deny.html';
  }

  document.getElementById('giftOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeGiftModal() {
  document.getElementById('giftOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* ── stats ──────────────────────────────────────────────── */
function renderStats() {
  const members = document.getElementById('statMembers');
  const lbs     = document.getElementById('statLbs');
  if (members) members.textContent = Object.keys(state.users).length;
  if (lbs)     lbs.textContent     = state.lbs || 0;
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

/* ── leaderboard gallery ────────────────────────────────── */
function thisMonthKey() {
  const d = new Date();
  return d.getFullYear() + '-' + d.getMonth();
}

let lbIndex    = 0;
let lbTimer    = null;
const LB_DELAY = 5000;

function lbCardsWithData() {
  // one slide per gift card, plus one "all" slide if multiple cards
  const cards = state.giftcards;
  if (!cards.length) return [{ id: 'all', name: 'All composters', image: '' }];
  return cards;
}

function renderBoard() {
  const cards = lbCardsWithData();
  if (lbIndex >= cards.length) lbIndex = 0;

  renderLbDots(cards);
  renderLbSlide(cards[lbIndex]);

  clearInterval(lbTimer);
  lbTimer = setInterval(() => {
    lbIndex = (lbIndex + 1) % cards.length;
    renderLbDots(cards);
    renderLbSlide(cards[lbIndex]);
  }, LB_DELAY);
}

function lbPrev() {
  const cards = lbCardsWithData();
  lbIndex = (lbIndex - 1 + cards.length) % cards.length;
  clearInterval(lbTimer);
  renderLbDots(cards);
  renderLbSlide(cards[lbIndex]);
  lbTimer = setInterval(() => {
    lbIndex = (lbIndex + 1) % cards.length;
    renderLbDots(cards);
    renderLbSlide(cards[lbIndex]);
  }, LB_DELAY);
}

function lbNext() {
  const cards = lbCardsWithData();
  lbIndex = (lbIndex + 1) % cards.length;
  clearInterval(lbTimer);
  renderLbDots(cards);
  renderLbSlide(cards[lbIndex]);
  lbTimer = setInterval(() => {
    lbIndex = (lbIndex + 1) % cards.length;
    renderLbDots(cards);
    renderLbSlide(cards[lbIndex]);
  }, LB_DELAY);
}

function lbGoTo(i) {
  lbIndex = i;
  clearInterval(lbTimer);
  const cards = lbCardsWithData();
  renderLbDots(cards);
  renderLbSlide(cards[lbIndex]);
  lbTimer = setInterval(() => {
    lbIndex = (lbIndex + 1) % cards.length;
    renderLbDots(cards);
    renderLbSlide(cards[lbIndex]);
  }, LB_DELAY);
}

function renderLbDots(cards) {
  const dots = document.getElementById('lbDots');
  if (!dots) return;
  dots.innerHTML = cards.map((_, i) =>
    `<div class="lb-dot${i === lbIndex ? ' active' : ''}" onclick="lbGoTo(${i})"></div>`
  ).join('');
  // hide nav if only one card
  const nav = document.getElementById('lbPrev');
  if (nav) { nav.style.display = cards.length < 2 ? 'none' : ''; }
  const nav2 = document.getElementById('lbNext');
  if (nav2) { nav2.style.display = cards.length < 2 ? 'none' : ''; }
}

function renderLbSlide(gc) {
  const board = document.getElementById('board');
  const label = document.getElementById('lbCardLabel');
  if (!board) return;

  if (label) {
    label.innerHTML = gc.image
      ? `<img src="${gc.image}" alt="${gc.name}" />${gc.name} leaderboard`
      : gc.name + ' leaderboard';
  }

  const session  = getSession();
  const users    = Object.values(state.users);

  // filter contributions for this card and this month
  const ranked = users.map(u => {
    const pts = (u.contributions || []).filter(c => {
      const inMonth = (new Date(c.ts).getFullYear() + '-' + new Date(c.ts).getMonth()) === thisMonthKey();
      if (gc.id === 'all') return inMonth && c.approved;
      return inMonth && c.approved && c.cardId === gc.id;
    }).length;
    return { name: u.name, phone: u.phone, points: pts };
  }).filter(u => u.points > 0).sort((a, b) => b.points - a.points);

  if (!ranked.length) {
    board.innerHTML = `<div class="empty-board">No entries for ${gc.name} yet this month. Be the first.</div>`;
    return;
  }

  board.innerHTML = ranked.slice(0, 10).map((u, i) => {
    const isYou   = u.phone === session;
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
renderNav();
renderBoard();
renderStats();
initFirebase();
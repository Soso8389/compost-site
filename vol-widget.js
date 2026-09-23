/* ============================================================
   CVHS Can Compost — vol-widget.js
   Shared volunteer week calendar widget.
   Used on both index.html and club/index.html
   ============================================================ */

const VOL = {
  weekOffset:    0,   // 0 = current week, 1 = next week, etc.
  selectedDate:  null,
  db:            null,
  volunteers:    {},
  settings:      {},
  containerId:   'volWidget',

  /* ── init ─────────────────────────────────────────────── */
  init(db, volunteers, settings, containerId) {
    this.db          = db;
    this.volunteers  = volunteers || {};
    this.settings    = settings  || {};
    this.containerId = containerId || 'volWidget';
    this.weekOffset  = 0;
    this.selectedDate = null;
    this.render();
  },

  update(volunteers, settings) {
    this.volunteers = volunteers || {};
    this.settings   = settings  || {};
    this.render();
  },

  /* ── week helpers ─────────────────────────────────────── */
  getWeekDates(offset) {
    const today  = new Date();
    const dow    = today.getDay(); // 0=Sun
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
    monday.setHours(0, 0, 0, 0);
    return [0, 1, 2, 3, 4].map(i => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  },

  toKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  },

  toLabel(date) {
    return date.toLocaleDateString(undefined, { weekday: 'long', month: '2-digit', day: '2-digit', year: 'numeric' });
  },

  isPast(date) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return date < today;
  },

  isBlocked(key) {
    return (this.settings.blockedDates || []).includes(key);
  },

  getSignups(key) {
    return (this.volunteers[key] && this.volunteers[key].signups) ? this.volunteers[key].signups : [];
  },

  getAdminPhone() {
    return window.CONFIG && window.CONFIG.adminPhone ? window.CONFIG.adminPhone.replace(/\D/g, '') : '';
  },

  regularCount(key) {
    const adminPhone = this.getAdminPhone();
    return this.getSignups(key).filter(s => s.phone !== adminPhone).length;
  },

  maxSlots() { return this.settings.maxPerDate || 3; },

  /* ── render ───────────────────────────────────────────── */
  render() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const dates   = this.getWeekDates(this.weekOffset);
    const today   = new Date(); today.setHours(0, 0, 0, 0);
    const isPast  = this.weekOffset < 0;
    const maxS    = this.maxSlots();

    // week label
    const startLabel = dates[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const endLabel   = dates[4].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

    const dayHTML = dates.map((date, i) => {
      const key      = this.toKey(date);
      const past     = date < today;
      const blocked  = this.isBlocked(key);
      const count    = this.regularCount(key);
      const full     = count >= maxS;
      const selected = this.selectedDate === key;
      const pct      = Math.min(100, Math.round((count / maxS) * 100));

      let cls = 'vol-day';
      if (past || blocked)  cls += ' disabled';
      else if (full)        cls += ' full';
      if (selected)         cls += ' selected';

      const clickable = !past && !blocked && !full;
      const onclick   = clickable ? 'VOL.selectDay("' + key + '")' : '';

      return '<div class="' + cls + '" ' + (onclick ? 'onclick="' + onclick + '"' : '') + '>' +
        '<div class="vd-name">' + days[i] + '</div>' +
        '<div class="vd-num">'  + date.getDate() + '</div>' +
        '<div class="vd-bar"><div class="vd-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="vd-count">' + (full ? 'Full' : (blocked ? 'N/A' : (past ? '—' : count + '/' + maxS))) + '</div>' +
      '</div>';
    }).join('');

    const hoursNote = this.settings.hoursPerShift
      ? 'Earns ' + this.settings.hoursPerShift + ' service hour' + (this.settings.hoursPerShift === 1 ? '' : 's') + ' per shift.'
      : '';

    container.innerHTML =
      '<div class="vol-calendar">' +
        '<div class="vol-week-nav">' +
          '<button class="vol-week-btn" onclick="VOL.prevWeek()" ' + (this.weekOffset <= 0 ? 'disabled' : '') + '>&#8592;</button>' +
          '<span class="vol-week-label">' + startLabel + ' – ' + endLabel + '</span>' +
          '<button class="vol-week-btn" onclick="VOL.nextWeek()">&#8594;</button>' +
        '</div>' +
        '<div class="vol-days">' + dayHTML + '</div>' +
        '<div class="vol-confirm" id="volConfirmArea"></div>' +
        (hoursNote ? '<p style="font-size:.82rem;color:var(--muted);margin-top:10px">' + hoursNote + '</p>' : '') +
      '</div>';

    this.renderConfirm();
  },

  renderConfirm() {
    const area = document.getElementById('volConfirmArea');
    if (!area) return;

    if (!this.selectedDate) {
      area.innerHTML = '';
      return;
    }

    const date     = new Date(this.selectedDate + 'T00:00:00');
    const label    = this.toLabel(date);
    const u        = typeof DB !== 'undefined' ? DB.currentUser() : null;
    const loggedIn = typeof isLoggedIn !== 'undefined' ? isLoggedIn() : false;
    const hasId    = u && u.studentId && u.studentId.length === 6;

    if (!loggedIn) {
      area.innerHTML =
        '<div style="background:var(--cream);border:1px solid var(--tan-soft);border-radius:var(--radius-sm);padding:16px;margin-top:8px">' +
          '<p style="font-size:.9rem;color:var(--muted);margin-bottom:12px">You need an account to volunteer for <strong>' + label + '</strong>.</p>' +
          '<button class="btn btn-primary btn-block" onclick="openJoin()">Create an account</button>' +
          '<p style="text-align:center;font-size:.82rem;margin-top:8px">Already have one? <button onclick="openAuth()" style="color:var(--moss);font-weight:600">Sign in</button></p>' +
        '</div>';
      return;
    }

    if (!hasId) {
      area.innerHTML =
        '<div style="background:var(--cream);border:1px solid var(--tan-soft);border-radius:var(--radius-sm);padding:16px;margin-top:8px">' +
          '<p style="font-size:.9rem;color:var(--muted);margin-bottom:12px">Add your student ID to volunteer for <strong>' + label + '</strong>.</p>' +
          '<button class="btn btn-primary btn-block" onclick="openIdModal()">Add student ID</button>' +
        '</div>';
      return;
    }

    // already signed up for this date?
    const signups = this.getSignups(this.selectedDate);
    const already = signups.some(s => s.phone === u.phone);
    if (already) {
      area.innerHTML =
        '<div style="background:var(--leaf-soft);border-radius:var(--radius-sm);padding:14px 16px;margin-top:8px;font-size:.9rem;color:var(--green-deep);font-weight:600">' +
          '✓ You are already signed up for ' + label + '.' +
        '</div>';
      return;
    }

    area.innerHTML =
      '<div style="background:var(--cream);border:1px solid var(--tan-soft);border-radius:var(--radius-sm);padding:16px;margin-top:8px">' +
        '<p style="font-size:.9rem;font-weight:600;color:var(--green-deep);margin-bottom:12px">Confirm shift: ' + label + '</p>' +
        '<button class="btn btn-primary btn-block" onclick="VOL.confirmShift()">Confirm volunteer signup</button>' +
      '</div>';
  },

  selectDay(key) {
    this.selectedDate = this.selectedDate === key ? null : key;
    this.renderConfirm();
    // update selected class
    document.querySelectorAll('.vol-day').forEach(el => el.classList.remove('selected'));
    const days = this.getWeekDates(this.weekOffset);
    days.forEach((date, i) => {
      if (this.toKey(date) === key) {
        const dayEls = document.querySelectorAll('.vol-day');
        if (dayEls[i]) dayEls[i].classList.toggle('selected', this.selectedDate === key);
      }
    });
  },

  prevWeek() {
    if (this.weekOffset <= 0) return;
    this.weekOffset--;
    this.selectedDate = null;
    this.render();
  },

  nextWeek() {
    this.weekOffset++;
    this.selectedDate = null;
    this.render();
  },

  async confirmShift() {
    if (!this.selectedDate) return;
    const u = typeof DB !== 'undefined' ? DB.currentUser() : null;
    if (!u) return;

    const date       = this.selectedDate;
    const adminPhone = this.getAdminPhone();
    const isAdmin    = u.phone === adminPhone;
    const maxS       = this.maxSlots();
    const signups    = this.getSignups(date);
    const regCount   = signups.filter(s => s.phone !== adminPhone).length;

    if (regCount >= maxS && !isAdmin) {
      if (typeof toast === 'function') toast('This date just filled up. Please choose another.', 'bad');
      this.render(); return;
    }
    if (signups.some(s => s.phone === u.phone)) {
      if (typeof toast === 'function') toast('You are already signed up for this date.', 'bad');
      return;
    }

    const newSignup = { phone: u.phone, name: u.name, studentId: u.studentId || '', ts: Date.now(), isAdmin };
    const newSignups = [...signups, newSignup];

    try {
      if (this.db) await this.db.collection('volunteers').doc(date).set({ signups: newSignups });

      // update local state immediately
      if (!this.volunteers[date]) this.volunteers[date] = {};
      this.volunteers[date].signups = newSignups;

      const dateObj   = new Date(date + 'T00:00:00');
      const dateLabel = dateObj.toLocaleDateString(undefined, { weekday: 'long', month: '2-digit', day: '2-digit', year: 'numeric' });

      // email notification
      fetch('https://formsubmit.co/ajax/cvhs.composting@gmail.com', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          _subject:   'New Volunteer Signup — ' + u.name,
          name:       u.name,
          phone:      u.phone,
          student_id: u.studentId || 'not set',
          shift:      dateLabel,
          source:     window.location.pathname.includes('club') ? 'Club page' : 'Main site'
        })
      }).catch(() => {});

      if (typeof toast === 'function') toast('Signed up for ' + dateLabel + '.', 'ok');
      this.selectedDate = null;
      this.render();

    } catch(e) {
      if (typeof toast === 'function') toast('Failed to sign up. Try again.', 'bad');
      console.error(e);
    }
  }
};

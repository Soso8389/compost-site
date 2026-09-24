/* ============================================================
   CVHS Can Compost — vol-widget.js
   Week volunteer calendar widget. Used on index + club pages.
   ============================================================ */

const VOL = {
  weekOffset:   0,
  selectedDate: null,
  db:           null,
  volunteers:   {},
  settings:     {},
  containerId:  'volWidget',
  _timer:       null,

  /* ── init ─────────────────────────────────────────────── */
  init(db, volunteers, settings, containerId) {
    this.db          = db;
    this.volunteers  = volunteers || {};
    this.settings    = settings  || {};
    this.containerId = containerId || 'volWidget';
    this.selectedDate = null;

    // auto-advance if all days this week are past
    if (this.allPastThisWeek()) this.weekOffset = 1;
    else this.weekOffset = 0;

    this.render();

    // refresh every 30s so days disappear at 12:51 PM
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => {
      if (this.allPastThisWeek() && this.weekOffset === 0) {
        this.weekOffset = 1;
        this.selectedDate = null;
      }
      this.render();
    }, 30000);
  },

  update(volunteers, settings) {
    this.volunteers = volunteers || {};
    this.settings   = settings  || {};
    this.render();
  },

  /* ── week helpers ─────────────────────────────────────── */
  getWeekDates(offset) {
    const today  = new Date();
    const dow    = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + (offset || 0) * 7);
    monday.setHours(0, 0, 0, 0);
    return [0,1,2,3,4].map(i => {
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
    return date.toLocaleDateString('en-US', { weekday:'long', month:'2-digit', day:'2-digit', year:'numeric' });
  },

  isDayPast(date) {
    const now     = new Date();
    const cutoff  = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 51, 0);
    return now >= cutoff;
  },

  allPastThisWeek() {
    return this.getWeekDates(0).every(d => this.isDayPast(d));
  },

  isBlocked(key) {
    return (this.settings.blockedDates || []).includes(key);
  },

  getSignups(key) {
    const data = this.volunteers[key];
    return (data && data.signups) ? data.signups : [];
  },

  getAdminPhone() {
    return (window.CONFIG && window.CONFIG.adminPhone) ? window.CONFIG.adminPhone.replace(/\D/g,'') : '';
  },

  regularCount(key) {
    const admin = this.getAdminPhone();
    return this.getSignups(key).filter(s => s.phone !== admin).length;
  },

  maxSlots() { return this.settings.maxPerDate || 3; },

  /* ── render ───────────────────────────────────────────── */
  render() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const dates  = this.getWeekDates(this.weekOffset);
    const maxS   = this.maxSlots();
    const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri'];

    const startLabel = dates[0].toLocaleDateString('en-US', { month:'short', day:'numeric' });
    const endLabel   = dates[4].toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });

    const dayHTML = dates.map((date, i) => {
      const key      = this.toKey(date);
      const past     = this.isDayPast(date);
      const blocked  = this.isBlocked(key);
      const count    = this.regularCount(key);
      const full     = count >= maxS;
      const selected = this.selectedDate === key;
      const pct      = Math.min(100, Math.round((count / maxS) * 100));

      let cls = 'vol-day';
      if (past || blocked) cls += ' disabled';
      else if (full)       cls += ' full';
      if (selected)        cls += ' selected';

      const clickable = !past && !blocked && !full;
      const onclk     = clickable ? 'onclick=\'VOL.selectDay("' + key + '")\'' : '';

      const countLabel = past ? '—' : (blocked ? 'N/A' : (full ? 'Full' : count + '/' + maxS));

      return '<div class="' + cls + '" ' + onclk + '>' +
        '<div class="vd-name">' + DAY_NAMES[i] + '</div>' +
        '<div class="vd-num">'  + date.getDate() + '</div>' +
        '<div class="vd-bar"><div class="vd-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="vd-count">' + countLabel + '</div>' +
      '</div>';
    }).join('');

    const hoursNote = this.settings.hoursPerShift
      ? '<p style="font-size:.82rem;color:var(--muted);margin-top:10px">Earns ' + this.settings.hoursPerShift + ' service hour' + (this.settings.hoursPerShift === 1 ? '' : 's') + ' per shift.</p>'
      : '';

    container.innerHTML =
      '<div class="vol-calendar">' +
        '<div class="vol-week-nav">' +
          '<button class="vol-week-btn" onclick="VOL.prevWeek()" disabled>&#8592;</button>' +
          '<span class="vol-week-label">' + startLabel + ' \u2013 ' + endLabel + '</span>' +
          '<button class="vol-week-btn" onclick="VOL.nextWeek()">&#8594;</button>' +
        '</div>' +
        '<div class="vol-days">' + dayHTML + '</div>' +
        '<div id="volConfirmArea"></div>' +
        hoursNote +
      '</div>';

    this.renderConfirm();
  },

  /* ── confirm panel ────────────────────────────────────── */
  renderConfirm() {
    const area = document.getElementById('volConfirmArea');
    if (!area) return;

    if (!this.selectedDate) { area.innerHTML = ''; return; }

    const date     = new Date(this.selectedDate + 'T00:00:00');
    const label    = this.toLabel(date);
    const loggedIn = typeof isLoggedIn === 'function' ? isLoggedIn() : false;
    const u        = (typeof DB !== 'undefined') ? DB.currentUser() : null;
    const hasId    = u && u.studentId && u.studentId.length === 6;
    const alreadySignedUp = this.getSignups(this.selectedDate).some(s => s.phone === (u ? u.phone : ''));

    if (!loggedIn) {
      area.innerHTML =
        '<div class="vol-confirm-box">' +
          '<p>You need an account to volunteer for <strong>' + label + '</strong>.</p>' +
          '<button class="btn btn-primary btn-block" onclick="openJoin()">Create an account</button>' +
          '<p style="text-align:center;font-size:.82rem;margin-top:8px">Already have one? <button onclick="openAuth()" style="color:var(--moss);font-weight:600">Sign in</button></p>' +
        '</div>';
      return;
    }

    if (!hasId) {
      area.innerHTML =
        '<div class="vol-confirm-box">' +
          '<p>Add your student ID to volunteer for <strong>' + label + '</strong>.</p>' +
          '<button class="btn btn-primary btn-block" onclick="openIdModal()">Add student ID</button>' +
        '</div>';
      return;
    }

    if (alreadySignedUp) {
      area.innerHTML =
        '<div class="vol-confirm-box" style="background:var(--leaf-soft);border-color:var(--leaf)">' +
          '<p style="color:var(--green-deep);font-weight:600;margin:0">&#10003; You are signed up for ' + label + '.</p>' +
        '</div>';
      return;
    }

    area.innerHTML =
      '<div class="vol-confirm-box">' +
        '<p style="font-weight:600;color:var(--green-deep);margin-bottom:12px">Confirm: ' + label + '</p>' +
        '<button class="btn btn-primary btn-block" onclick="VOL.confirmShift()">Confirm volunteer signup</button>' +
      '</div>';
  },

  /* ── interaction ──────────────────────────────────────── */
  selectDay(key) {
    this.selectedDate = (this.selectedDate === key) ? null : key;
    // update selected class without full re-render
    document.querySelectorAll('.vol-day').forEach((el, i) => {
      const dates = this.getWeekDates(this.weekOffset);
      if (i < dates.length) {
        const dayKey = this.toKey(dates[i]);
        el.classList.toggle('selected', dayKey === this.selectedDate);
      }
    });
    this.renderConfirm();
  },

  prevWeek() { /* disabled — no going back */ },

  nextWeek() {
    this.weekOffset++;
    this.selectedDate = null;
    this.render();
  },

  async confirmShift() {
    if (!this.selectedDate) return;
    const u = (typeof DB !== 'undefined') ? DB.currentUser() : null;
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

    const newSignup  = { phone: u.phone, name: u.name, studentId: u.studentId || '', ts: Date.now(), isAdmin };
    const newSignups = [...signups, newSignup];

    // update locally immediately so UI responds instantly
    if (!this.volunteers[date]) this.volunteers[date] = {};
    this.volunteers[date].signups = newSignups;
    this.renderConfirm();
    this.render();

    try {
      if (this.db) await this.db.collection('volunteers').doc(date).set({ signups: newSignups });

      const dateObj   = new Date(date + 'T00:00:00');
      const dateLabel = this.toLabel(dateObj);

      // email notification
      fetch('https://formsubmit.co/ajax/cvhs.composting@gmail.com', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          _subject:   'New Volunteer Signup \u2014 ' + u.name,
          name:       u.name,
          phone:      u.phone,
          student_id: u.studentId || 'not set',
          shift:      dateLabel,
          source:     window.location.pathname.includes('club') ? 'Club page' : 'Main site'
        })
      }).catch(() => {});

      if (typeof toast === 'function') toast('Signed up for ' + dateLabel + '.', 'ok');

    } catch(e) {
      if (typeof toast === 'function') toast('Failed to save. Try again.', 'bad');
      // revert local update
      this.volunteers[date].signups = signups;
      this.render();
      console.error(e);
    }
  }
};
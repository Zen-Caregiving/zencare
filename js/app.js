// Zencare Volunteer Shift Tracker
// Vanilla JS SPA — no build tools

let sb;
let currentUser = null;

// Caches
let volunteersCache = [];
let shiftsCache = [];
let assignmentsCache = [];
let attendanceCache = [];
let preferredShiftsCache = [];

// State
let currentMonday = getMonday(new Date());
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const SLOT_NAMES = ['morning', 'afternoon', 'evening'];
const SLOT_LABELS = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

// Popover state
let popoverContext = null; // { volunteerId, shiftId, shiftDate, dayOfWeek, timeSlot }

// ============================================================
// INIT
// ============================================================

async function init() {
  if (typeof supabase === 'undefined') throw new Error('Supabase CDN failed to load');
  const { createClient } = supabase;
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Check auth
  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    currentUser = user;
    showAdminContent();
  }

  // Handle magic link redirect
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      currentUser = session.user;
      showAdminContent();
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      hideAdminContent();
    }
  });

  await loadBaseData();
  await loadWeek(currentMonday);
  renderSchedule();
  populateVolunteerDropdowns();
  updateAuthStatus();
}

async function loadBaseData() {
  const [volRes, shiftRes, assignRes] = await Promise.all([
    sb.from('volunteers').select('*').order('first_name'),
    sb.from('shifts').select('*').order('day_of_week').order('time_slot'),
    sb.from('shift_assignments').select('*').eq('is_active', true),
  ]);
  volunteersCache = volRes.data || [];
  shiftsCache = shiftRes.data || [];
  assignmentsCache = assignRes.data || [];
}

async function loadWeek(monday) {
  const friday = addDays(monday, 4);
  const mondayStr = fmtDateISO(monday);
  const fridayStr = fmtDateISO(friday);

  const [attRes, prefRes] = await Promise.all([
    sb.from('attendance').select('*')
      .gte('shift_date', mondayStr)
      .lte('shift_date', fridayStr),
    sb.from('preferred_shifts').select('*'),
  ]);
  attendanceCache = attRes.data || [];
  preferredShiftsCache = prefRes.data || [];
}

// ============================================================
// SCHEDULE RENDERING
// ============================================================

function renderSchedule() {
  renderWeekLabel();
  renderDayAccordion();
  renderWeekGrid();
}

function renderWeekLabel() {
  const friday = addDays(currentMonday, 4);
  const opts = { month: 'short', day: 'numeric' };
  const monStr = currentMonday.toLocaleDateString('en-US', opts);
  const friStr = friday.toLocaleDateString('en-US', opts);
  document.getElementById('week-label').textContent = `${monStr} – ${friStr}`;
}

function renderDayAccordion() {
  const container = document.getElementById('day-accordion');
  const today = new Date();
  const todayStr = fmtDateISO(today);

  let html = '';
  for (let d = 0; d < 5; d++) {
    const date = addDays(currentMonday, d);
    const dateStr = fmtDateISO(date);
    const isToday = dateStr === todayStr;
    const isOpen = isToday || d === 0;

    html += `<div class="day-section ${isToday ? 'today' : ''} ${isOpen ? 'open' : ''}" data-day="${d}">
      <div class="day-header" onclick="toggleDay(this)">
        <div>
          ${DAY_NAMES[d]} <span class="date-label">${fmtDateShort(date)}</span>
        </div>
        <span class="arrow">&#9654;</span>
      </div>
      <div class="day-body">
        ${renderDayShifts(d, dateStr)}
      </div>
    </div>`;
  }
  container.innerHTML = html;
}

function renderWeekGrid() {
  const tbody = document.getElementById('week-grid-body');
  const today = new Date();
  const todayStr = fmtDateISO(today);

  let html = '';
  for (let d = 0; d < 5; d++) {
    const date = addDays(currentMonday, d);
    const dateStr = fmtDateISO(date);
    const isToday = dateStr === todayStr;

    html += `<tr class="${isToday ? 'today-row' : ''}">
      <td class="day-cell">${DAY_NAMES[d]}<br><span class="text-muted text-sm">${fmtDateShort(date)}</span></td>`;

    for (const slot of SLOT_NAMES) {
      html += `<td>${renderShiftChips(d, slot, dateStr)}</td>`;
    }
    html += '</tr>';
  }
  tbody.innerHTML = html;
}

function renderDayShifts(dayOfWeek, dateStr) {
  let html = '';
  for (const slot of SLOT_NAMES) {
    const chips = renderShiftChips(dayOfWeek, slot, dateStr);
    if (!chips.trim()) continue;
    html += `<div class="shift-section">
      <div class="shift-label">${SLOT_LABELS[slot]}</div>
      ${chips}
    </div>`;
  }
  if (!html) {
    html = '<div class="empty-state">No volunteers scheduled</div>';
  }
  return html;
}

function renderShiftChips(dayOfWeek, timeSlot, dateStr) {
  const shift = shiftsCache.find(s => s.day_of_week === dayOfWeek && s.time_slot === timeSlot);
  if (!shift) return '';

  // Get assigned volunteers for this shift
  const assigned = assignmentsCache
    .filter(a => a.shift_id === shift.id)
    .map(a => {
      const vol = volunteersCache.find(v => v.id === a.volunteer_id);
      return vol;
    })
    .filter(Boolean);

  // Get subs for this shift/date
  const subs = attendanceCache.filter(a =>
    a.shift_id === shift.id && a.shift_date === dateStr && a.sub_for_id
  );

  let html = '<div class="chips">';

  for (const vol of assigned) {
    const att = attendanceCache.find(a =>
      a.shift_id === shift.id && a.volunteer_id === vol.id && a.shift_date === dateStr
    );
    const status = att ? att.status : 'attending';
    const notes = att?.notes || '';
    const needsSub = status === 'away' && !subs.some(s => s.sub_for_id === vol.id);

    let label = esc(vol.first_name);
    if (notes) label += ` <span class="sub-label">(${esc(notes)})</span>`;

    html += `<span class="chip chip-${status} ${needsSub ? 'chip-needs-sub' : ''}"
      onclick="openAttendancePopover('${vol.id}', '${shift.id}', '${dateStr}', ${dayOfWeek}, '${timeSlot}')"
      title="${status}${notes ? ': ' + notes : ''}">${label}</span>`;
  }

  // Show subs
  for (const sub of subs) {
    const subVol = volunteersCache.find(v => v.id === sub.volunteer_id);
    const forVol = volunteersCache.find(v => v.id === sub.sub_for_id);
    if (!subVol) continue;
    const forLabel = forVol ? ` (for ${esc(forVol.first_name)})` : '';
    html += `<span class="chip chip-sub"
      onclick="openAttendancePopover('${subVol.id}', '${shift.id}', '${dateStr}', ${dayOfWeek}, '${timeSlot}')"
      >${esc(subVol.first_name)}<span class="sub-label">${forLabel}</span></span>`;
  }

  html += '</div>';
  return html;
}

function toggleDay(header) {
  header.parentElement.classList.toggle('open');
}

// ============================================================
// ATTENDANCE POPOVER
// ============================================================

function openAttendancePopover(volunteerId, shiftId, shiftDate, dayOfWeek, timeSlot) {
  popoverContext = { volunteerId, shiftId, shiftDate, dayOfWeek, timeSlot };

  const vol = volunteersCache.find(v => v.id === volunteerId);
  const att = attendanceCache.find(a =>
    a.shift_id === shiftId && a.volunteer_id === volunteerId && a.shift_date === shiftDate
  );

  document.getElementById('popover-name').textContent = vol?.first_name || 'Unknown';
  document.getElementById('popover-shift-info').textContent =
    `${DAY_NAMES[dayOfWeek]} ${SLOT_LABELS[timeSlot]} — ${fmtDateShort(new Date(shiftDate + 'T00:00:00'))}`;

  // Set current status
  const currentStatus = att?.status || 'attending';
  document.querySelectorAll('#popover-status-options .status-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.status === currentStatus);
  });

  // Notes
  document.getElementById('popover-notes').value = att?.notes || '';

  // Sub picker - show when status is "away" for non-assigned volunteer looking to sub
  updateSubPicker(currentStatus, shiftId, shiftDate);

  document.getElementById('attendance-popover').classList.add('active');
}

function updateSubPicker(status, shiftId, shiftDate) {
  const section = document.getElementById('sub-picker-section');
  const select = document.getElementById('sub-picker-select');

  if (status === 'away') {
    section.style.display = 'none';
    return;
  }

  // Check if this volunteer is subbing for someone
  const att = attendanceCache.find(a =>
    a.shift_id === popoverContext.shiftId &&
    a.volunteer_id === popoverContext.volunteerId &&
    a.shift_date === popoverContext.shiftDate
  );

  if (att?.sub_for_id) {
    section.style.display = 'block';
    // Populate with away volunteers
    const awayVols = attendanceCache
      .filter(a => a.shift_id === shiftId && a.shift_date === shiftDate && a.status === 'away')
      .map(a => volunteersCache.find(v => v.id === a.volunteer_id))
      .filter(Boolean);

    select.innerHTML = '<option value="">No substitute</option>' +
      awayVols.map(v => `<option value="${v.id}" ${att.sub_for_id === v.id ? 'selected' : ''}>${esc(v.first_name)}</option>`).join('');
  } else {
    section.style.display = 'none';
  }
}

async function saveAttendance() {
  if (!popoverContext) return;

  const selectedBtn = document.querySelector('#popover-status-options .status-btn.selected');
  const status = selectedBtn?.dataset.status || 'attending';
  const notes = document.getElementById('popover-notes').value.trim() || null;

  const { volunteerId, shiftId, shiftDate } = popoverContext;

  // If status is "attending" with no notes, delete the record (default state)
  if (status === 'attending' && !notes) {
    const existing = attendanceCache.find(a =>
      a.shift_id === shiftId && a.volunteer_id === volunteerId && a.shift_date === shiftDate
    );
    if (existing) {
      await sb.from('attendance').delete().eq('id', existing.id);
    }
  } else {
    // Upsert attendance
    await sb.from('attendance').upsert({
      shift_id: shiftId,
      volunteer_id: volunteerId,
      shift_date: shiftDate,
      status: status,
      notes: notes,
    }, { onConflict: 'shift_id,volunteer_id,shift_date' });
  }

  closeAttendancePopover();
  await loadWeek(currentMonday);
  renderSchedule();
}

function closeAttendancePopover() {
  document.getElementById('attendance-popover').classList.remove('active');
  popoverContext = null;
}

// ============================================================
// MY SHIFTS TAB
// ============================================================

function populateVolunteerDropdowns() {
  const select = document.getElementById('my-volunteer-select');
  const active = volunteersCache.filter(v => v.is_active);
  select.innerHTML = '<option value="">Select your name...</option>' +
    active.map(v => `<option value="${v.id}">${esc(v.first_name)}</option>`).join('');
}

function renderMyShifts(volunteerId) {
  if (!volunteerId) {
    document.getElementById('my-shifts-content').style.display = 'none';
    return;
  }

  document.getElementById('my-shifts-content').style.display = 'block';

  // Build preference grid
  const grid = document.getElementById('pref-grid');
  const myPrefs = preferredShiftsCache.filter(p => p.volunteer_id === volunteerId);

  let html = '<div></div><div class="pref-header">Morning</div><div class="pref-header">Afternoon</div><div class="pref-header">Evening</div>';

  for (let d = 0; d < 5; d++) {
    html += `<div class="pref-day">${DAY_NAMES[d]}</div>`;
    for (const slot of SLOT_NAMES) {
      const checked = myPrefs.some(p => p.day_of_week === d && p.time_slot === slot);
      html += `<div class="pref-cell">
        <input type="checkbox" ${checked ? 'checked' : ''}
          onchange="togglePreference('${volunteerId}', ${d}, '${slot}', this.checked)">
      </div>`;
    }
  }
  grid.innerHTML = html;

  // This week summary
  renderMyWeekSummary(volunteerId);
}

function renderMyWeekSummary(volunteerId) {
  const container = document.getElementById('my-week-summary');
  const vol = volunteersCache.find(v => v.id === volunteerId);
  if (!vol) return;

  const myAssignments = assignmentsCache.filter(a => a.volunteer_id === volunteerId);

  let html = '';
  for (let d = 0; d < 5; d++) {
    const date = addDays(currentMonday, d);
    const dateStr = fmtDateISO(date);

    for (const slot of SLOT_NAMES) {
      const shift = shiftsCache.find(s => s.day_of_week === d && s.time_slot === slot);
      if (!shift) continue;

      const isAssigned = myAssignments.some(a => a.shift_id === shift.id);
      if (!isAssigned) continue;

      const att = attendanceCache.find(a =>
        a.shift_id === shift.id && a.volunteer_id === volunteerId && a.shift_date === dateStr
      );
      const status = att?.status || 'attending';

      html += `<div class="day-section" style="margin-bottom:4px">
        <div style="padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
          <span>${DAY_NAMES[d]} ${SLOT_LABELS[slot]} <span class="text-muted text-sm">${fmtDateShort(date)}</span></span>
          <span class="chip chip-${status}" style="cursor:default">${status}</span>
        </div>
      </div>`;
    }
  }

  container.innerHTML = html || '<div class="empty-state">No shifts assigned this week</div>';
}

async function togglePreference(volunteerId, dayOfWeek, timeSlot, checked) {
  if (checked) {
    await sb.from('preferred_shifts').upsert({
      volunteer_id: volunteerId,
      day_of_week: dayOfWeek,
      time_slot: timeSlot,
    }, { onConflict: 'volunteer_id,day_of_week,time_slot' });
  } else {
    await sb.from('preferred_shifts')
      .delete()
      .eq('volunteer_id', volunteerId)
      .eq('day_of_week', dayOfWeek)
      .eq('time_slot', timeSlot);
  }
  // Reload prefs
  const { data } = await sb.from('preferred_shifts').select('*');
  preferredShiftsCache = data || [];
}

// ============================================================
// ADMIN TAB
// ============================================================

async function signInAdmin() {
  const email = document.getElementById('admin-email').value.trim();
  if (!email) return;

  const btn = document.getElementById('admin-signin-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  const { error } = await sb.auth.signInWithOtp({
    email: email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  });

  if (error) {
    document.getElementById('admin-login-status').textContent = 'Error: ' + error.message;
    btn.disabled = false;
    btn.textContent = 'Send Magic Link';
    return;
  }

  document.getElementById('admin-email').disabled = true;
  btn.textContent = 'Link sent! Check your email.';
  document.getElementById('admin-login-status').textContent = 'Check your inbox for the login link.';
}

async function signOutAdmin() {
  await sb.auth.signOut();
  currentUser = null;
  hideAdminContent();
  updateAuthStatus();
}

function showAdminContent() {
  document.getElementById('admin-login-section').style.display = 'none';
  document.getElementById('admin-content').style.display = 'block';
  renderAdminOverview();
  renderVolunteerTable();
}

function hideAdminContent() {
  document.getElementById('admin-login-section').style.display = 'block';
  document.getElementById('admin-content').style.display = 'none';
  // Reset login form
  const btn = document.getElementById('admin-signin-btn');
  btn.disabled = false;
  btn.textContent = 'Send Magic Link';
  document.getElementById('admin-email').disabled = false;
  document.getElementById('admin-login-status').textContent = '';
}

function renderAdminOverview() {
  const container = document.getElementById('admin-overview');

  // Count stats for this week
  let totalExpected = 0;
  let attending = 0;
  let away = 0;
  let subsCount = 0;
  let unfilled = 0;

  for (let d = 0; d < 5; d++) {
    for (const slot of SLOT_NAMES) {
      const shift = shiftsCache.find(s => s.day_of_week === d && s.time_slot === slot);
      if (!shift) continue;

      const assigned = assignmentsCache.filter(a => a.shift_id === shift.id);
      totalExpected += assigned.length;

      const dateStr = fmtDateISO(addDays(currentMonday, d));
      for (const a of assigned) {
        const att = attendanceCache.find(r =>
          r.shift_id === shift.id && r.volunteer_id === a.volunteer_id && r.shift_date === dateStr
        );
        if (att?.status === 'away') {
          away++;
          const hasSub = attendanceCache.some(r =>
            r.shift_id === shift.id && r.shift_date === dateStr && r.sub_for_id === a.volunteer_id
          );
          if (hasSub) subsCount++;
          else unfilled++;
        } else {
          attending++;
        }
      }
    }
  }

  container.innerHTML = `
    <div class="admin-card"><h4>Expected</h4><div class="value">${totalExpected}</div></div>
    <div class="admin-card"><h4>Attending</h4><div class="value" style="color:var(--ok)">${attending}</div></div>
    <div class="admin-card"><h4>Away</h4><div class="value" style="color:var(--danger)">${away}</div></div>
    <div class="admin-card"><h4>Subs</h4><div class="value" style="color:var(--info)">${subsCount}</div></div>
    <div class="admin-card ${unfilled > 0 ? 'highlight' : ''}"><h4>Unfilled</h4><div class="value">${unfilled}</div></div>
  `;
}

function renderVolunteerTable() {
  const tbody = document.getElementById('vol-table-body');
  const allVols = [...volunteersCache].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return a.first_name.localeCompare(b.first_name);
  });

  tbody.innerHTML = allVols.map(v => {
    const shifts = assignmentsCache
      .filter(a => a.volunteer_id === v.id)
      .map(a => {
        const shift = shiftsCache.find(s => s.id === a.shift_id);
        if (!shift) return '';
        return `${DAY_NAMES[shift.day_of_week].slice(0, 3)} ${SLOT_LABELS[shift.time_slot].slice(0, 3)}`;
      })
      .filter(Boolean)
      .join(', ');

    return `<tr>
      <td><strong>${esc(v.first_name)}</strong></td>
      <td><span class="badge ${v.is_active ? 'badge-active' : 'badge-inactive'}">${v.is_active ? 'Active' : 'Inactive'}</span></td>
      <td class="text-sm text-muted">${shifts || '—'}</td>
      <td><button class="btn btn-secondary text-sm" onclick="editVolunteer('${v.id}')" style="padding:4px 10px;font-size:12px">Edit</button></td>
    </tr>`;
  }).join('');
}

function openAddVolunteer() {
  document.getElementById('volunteer-modal-title').textContent = 'Add Volunteer';
  document.getElementById('volunteer-form').reset();
  document.getElementById('vol-form-id').value = '';
  openModal('volunteer-modal');
}

function editVolunteer(id) {
  const vol = volunteersCache.find(v => v.id === id);
  if (!vol) return;

  document.getElementById('volunteer-modal-title').textContent = 'Edit Volunteer';
  document.getElementById('vol-form-id').value = vol.id;
  document.getElementById('vol-form-name').value = vol.first_name;
  document.getElementById('vol-form-email').value = vol.email || '';
  document.getElementById('vol-form-phone').value = vol.phone || '';
  document.getElementById('vol-form-active').value = vol.is_active ? 'true' : 'false';
  openModal('volunteer-modal');
}

async function submitVolunteerForm(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const id = fd.get('id');

  const data = {
    first_name: fd.get('first_name'),
    email: fd.get('email') || null,
    phone: fd.get('phone') || null,
    is_active: fd.get('is_active') === 'true',
  };

  if (id) {
    const { error } = await sb.from('volunteers').update(data).eq('id', id);
    if (error) { alert('Error: ' + error.message); return; }
  } else {
    const { error } = await sb.from('volunteers').insert(data);
    if (error) { alert('Error: ' + error.message); return; }
  }

  closeModal('volunteer-modal');
  await loadBaseData();
  renderVolunteerTable();
  populateVolunteerDropdowns();
  renderSchedule();
}

// ============================================================
// NAV & MODALS
// ============================================================

function setupTabNavigation() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(page + '-page').classList.add('active');
    });
  });
}

function setupWeekNav() {
  document.getElementById('prev-week').addEventListener('click', async () => {
    currentMonday = addDays(currentMonday, -7);
    await loadWeek(currentMonday);
    renderSchedule();
  });
  document.getElementById('next-week').addEventListener('click', async () => {
    currentMonday = addDays(currentMonday, 7);
    await loadWeek(currentMonday);
    renderSchedule();
  });
  document.getElementById('today-btn').addEventListener('click', async () => {
    currentMonday = getMonday(new Date());
    await loadWeek(currentMonday);
    renderSchedule();
  });
}

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
  document.body.style.overflow = '';
}

function updateAuthStatus() {
  const el = document.getElementById('auth-status');
  el.textContent = currentUser ? currentUser.email : '';
}

// ============================================================
// HELPERS
// ============================================================

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fmtDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fmtDateShort(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function esc(str) {
  if (!str) return '';
  const el = document.createElement('div');
  el.textContent = str;
  return el.innerHTML;
}

// ============================================================
// EVENT LISTENERS
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('App init failed:', err);
  });

  setupTabNavigation();
  setupWeekNav();

  // Attendance popover
  document.querySelectorAll('#popover-status-options .status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#popover-status-options .status-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
  document.getElementById('popover-save').addEventListener('click', saveAttendance);
  document.getElementById('popover-cancel').addEventListener('click', closeAttendancePopover);
  document.getElementById('attendance-popover').addEventListener('click', (e) => {
    if (e.target.id === 'attendance-popover') closeAttendancePopover();
  });

  // My Shifts volunteer select
  document.getElementById('my-volunteer-select').addEventListener('change', (e) => {
    renderMyShifts(e.target.value);
  });

  // Admin
  document.getElementById('admin-signin-btn').addEventListener('click', signInAdmin);
  document.getElementById('admin-signout-btn').addEventListener('click', signOutAdmin);
  document.getElementById('add-volunteer-btn').addEventListener('click', openAddVolunteer);
  document.getElementById('volunteer-form').addEventListener('submit', submitVolunteerForm);

  // Modal overlay click to close
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      e.target.classList.remove('active');
      document.body.style.overflow = '';
    }
  });
});

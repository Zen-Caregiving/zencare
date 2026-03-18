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
let subPopoverContext = null; // { awayVolunteerId, shiftId, shiftDate, dayOfWeek, timeSlot }

// Admin state
let adminMonday = getMonday(new Date());
let adminAttendanceCache = [];

// ============================================================
// OFFLINE QUEUE
// ============================================================
//
//  WRITE ──► [online?]
//              │    │
//              Y    N
//              │    │
//              ▼    ▼
//           Supabase  localStorage queue
//                        │
//                   [online event]
//                        │
//                   replay queue FIFO
//

const OFFLINE_QUEUE_KEY = 'zencare_offline_queue';

function getOfflineQueue() {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  } catch { return []; }
}

function addToOfflineQueue(entry) {
  try {
    const queue = getOfflineQueue();
    queue.push({ ...entry, timestamp: Date.now() });
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    // localStorage full — show toast (critical gap fix)
    showToast('Offline storage full — changes may be lost', 'error');
  }
}

async function replayOfflineQueue() {
  const queue = getOfflineQueue();
  if (queue.length === 0) return;

  let replayed = 0;
  const failed = [];

  for (const entry of queue) {
    try {
      if (entry.type === 'attendance') {
        const { error } = await sb.from('attendance').upsert(entry.data, {
          onConflict: 'shift_id,volunteer_id,shift_date',
        });
        if (error) { failed.push(entry); continue; }
      } else if (entry.type === 'attendance_delete') {
        const { error } = await sb.from('attendance').delete().eq('id', entry.id);
        if (error) { failed.push(entry); continue; }
      } else if (entry.type === 'preference_upsert') {
        const { error } = await sb.from('preferred_shifts').upsert(entry.data, {
          onConflict: 'volunteer_id,day_of_week,time_slot',
        });
        if (error) { failed.push(entry); continue; }
      } else if (entry.type === 'preference_delete') {
        const { error } = await sb.from('preferred_shifts')
          .delete()
          .eq('volunteer_id', entry.volunteer_id)
          .eq('day_of_week', entry.day_of_week)
          .eq('time_slot', entry.time_slot);
        if (error) { failed.push(entry); continue; }
      }
      replayed++;
    } catch {
      failed.push(entry);
    }
  }

  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(failed));

  if (replayed > 0) {
    showToast(`Synced ${replayed} offline change${replayed > 1 ? 's' : ''}`, 'success');
    await loadWeek(currentMonday);
    renderSchedule();
  }
  if (failed.length > 0) {
    showToast(`${failed.length} change${failed.length > 1 ? 's' : ''} failed to sync`, 'error');
  }
}

function updateOnlineStatus() {
  const indicator = document.getElementById('offline-indicator');
  if (indicator) {
    indicator.style.display = navigator.onLine ? 'none' : 'block';
  }
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.addEventListener('click', () => dismissToast(toast));
  container.appendChild(toast);
  setTimeout(() => dismissToast(toast), 3000);
}

function dismissToast(toast) {
  if (toast.classList.contains('toast-out')) return;
  toast.classList.add('toast-out');
  toast.addEventListener('animationend', () => toast.remove());
}

// ============================================================
// SUPABASE WRAPPERS
// ============================================================

// Wrapper for PostgREST calls: sb.from('table').select/insert/update/delete()
// Returns data on success, null on error (toast shown automatically)
async function sbQuery(query) {
  try {
    const { data, error } = await query;
    if (error) {
      showToast(error.message, 'error');
      return null;
    }
    return data;
  } catch (e) {
    showToast('Network error — please check your connection', 'error');
    return null;
  }
}

// Wrapper for Edge Function fetch calls
// Returns parsed JSON on success, null on error (toast shown automatically)
async function sbFetch(url, options) {
  try {
    const res = await fetch(url, options);
    const result = await res.json();
    if (!res.ok || result.error) {
      showToast(result.error || 'Request failed', 'error');
      return null;
    }
    return result;
  } catch (e) {
    showToast('Network error — please check your connection', 'error');
    return null;
  }
}

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

  // Hide loading spinner, show content
  const spinner = document.getElementById('schedule-loading');
  if (spinner) spinner.style.display = 'none';

  renderSchedule();
  populateVolunteerDropdowns();
  updateAuthStatus();
}

async function loadBaseData() {
  const [vols, shifts, assigns] = await Promise.all([
    sbQuery(sb.from('volunteers').select('*').order('first_name')),
    sbQuery(sb.from('shifts').select('*').order('day_of_week').order('time_slot')),
    sbQuery(sb.from('shift_assignments').select('*').eq('is_active', true)),
  ]);
  volunteersCache = vols || [];
  shiftsCache = shifts || [];
  assignmentsCache = assigns || [];
}

async function loadWeek(monday) {
  const friday = addDays(monday, 4);
  const mondayStr = fmtDateISO(monday);
  const fridayStr = fmtDateISO(friday);

  const [att, pref] = await Promise.all([
    sbQuery(sb.from('attendance').select('*')
      .gte('shift_date', mondayStr)
      .lte('shift_date', fridayStr)),
    sbQuery(sb.from('preferred_shifts').select('*')),
  ]);
  attendanceCache = att || [];
  preferredShiftsCache = pref || [];
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
    const hasSub = subs.some(s => s.sub_for_id === vol.id);
    const needsSub = status === 'away' && !hasSub;

    let label = esc(vol.first_name);
    if (notes) label += ` <span class="sub-label">(${esc(notes)})</span>`;

    html += `<span class="chip chip-${status} ${needsSub ? 'chip-needs-sub' : ''}"
      onclick="openAttendancePopover('${vol.id}', '${shift.id}', '${dateStr}', ${dayOfWeek}, '${timeSlot}')"
      title="${status}${notes ? ': ' + notes : ''}">${label}</span>`;

    // Show the sub for this volunteer, or a "+ Sub" button
    if (status === 'away') {
      const sub = subs.find(s => s.sub_for_id === vol.id);
      if (sub) {
        const subVol = volunteersCache.find(v => v.id === sub.volunteer_id);
        if (subVol) {
          html += `<span class="chip chip-sub"
            onclick="openAttendancePopover('${subVol.id}', '${shift.id}', '${dateStr}', ${dayOfWeek}, '${timeSlot}')"
            >${esc(subVol.first_name)}<span class="sub-label"> (sub)</span></span>`;
        }
      } else {
        html += `<span class="chip chip-add-sub"
          onclick="openSubPopover('${vol.id}', '${shift.id}', '${dateStr}', ${dayOfWeek}, '${timeSlot}')"
          >+ Sub</span>`;
      }
    }
  }

  // Show subs that aren't linked to a specific away volunteer
  for (const sub of subs) {
    if (assigned.some(v => {
      const att = attendanceCache.find(a =>
        a.shift_id === shift.id && a.volunteer_id === v.id && a.shift_date === dateStr
      );
      return att?.status === 'away' && sub.sub_for_id === v.id;
    })) continue; // already shown inline above
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

function copyScheduleToClipboard() {
  let text = `Zen Care — Week of ${document.getElementById('week-label').textContent}\n\n`;
  for (let d = 0; d < 5; d++) {
    const date = addDays(currentMonday, d);
    text += `${DAY_NAMES[d]} ${fmtDateShort(date)}\n`;
    for (const slot of SLOT_NAMES) {
      const shift = shiftsCache.find(s => s.day_of_week === d && s.time_slot === slot);
      if (!shift) continue;
      const assigned = assignmentsCache
        .filter(a => a.shift_id === shift.id)
        .map(a => volunteersCache.find(v => v.id === a.volunteer_id))
        .filter(Boolean);
      if (assigned.length === 0) continue;
      const dateStr = fmtDateISO(date);
      const names = assigned.map(v => {
        const att = attendanceCache.find(a =>
          a.shift_id === shift.id && a.volunteer_id === v.id && a.shift_date === dateStr
        );
        const status = att?.status || 'attending';
        if (status === 'away') return `${v.first_name} (away)`;
        if (status === 'late') return `${v.first_name} (late)`;
        return v.first_name;
      });
      text += `  ${SLOT_LABELS[slot]}: ${names.join(', ')}\n`;
    }
    text += '\n';
  }
  navigator.clipboard.writeText(text.trim()).then(() => {
    showToast('Schedule copied to clipboard', 'success');
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
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

  document.getElementById('attendance-popover').classList.add('active');
}

// ============================================================
// SUB POPOVER
// ============================================================

function openSubPopover(awayVolunteerId, shiftId, shiftDate, dayOfWeek, timeSlot) {
  subPopoverContext = { awayVolunteerId, shiftId, shiftDate, dayOfWeek, timeSlot };

  const awayVol = volunteersCache.find(v => v.id === awayVolunteerId);
  document.getElementById('sub-popover-for').textContent = awayVol?.first_name || 'Unknown';
  document.getElementById('sub-popover-shift-info').textContent =
    `${DAY_NAMES[dayOfWeek]} ${SLOT_LABELS[timeSlot]} — ${fmtDateShort(new Date(shiftDate + 'T00:00:00'))}`;

  // Populate volunteer dropdown (active volunteers not already assigned to this shift)
  const shift = shiftsCache.find(s => s.id === shiftId);
  const assignedIds = shift ? assignmentsCache.filter(a => a.shift_id === shift.id).map(a => a.volunteer_id) : [];
  const available = volunteersCache.filter(v => v.is_active && !assignedIds.includes(v.id));

  const select = document.getElementById('sub-volunteer-select');
  select.innerHTML = '<option value="">Select a volunteer...</option>' +
    available.map(v => `<option value="${v.id}">${esc(v.first_name)}</option>`).join('');

  document.getElementById('sub-popover-notes').value = '';
  document.getElementById('sub-popover').classList.add('active');
}

async function saveSub() {
  if (!subPopoverContext) return;

  const subVolunteerId = document.getElementById('sub-volunteer-select').value;
  if (!subVolunteerId) { return; }

  const saveBtn = document.getElementById('sub-popover-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  const notes = document.getElementById('sub-popover-notes').value.trim() || null;
  const { awayVolunteerId, shiftId, shiftDate } = subPopoverContext;

  const result = await sbQuery(sb.from('attendance').upsert({
    shift_id: shiftId,
    volunteer_id: subVolunteerId,
    shift_date: shiftDate,
    status: 'attending',
    sub_for_id: awayVolunteerId,
    notes: notes,
  }, { onConflict: 'shift_id,volunteer_id,shift_date' }));

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save';
  if (result === null) return;

  showToast('Substitute assigned', 'success');
  closeSubPopover();
  await loadWeek(currentMonday);
  renderSchedule();
}

function closeSubPopover() {
  document.getElementById('sub-popover').classList.remove('active');
  subPopoverContext = null;
}

async function saveAttendance() {
  if (!popoverContext) return;

  const selectedBtn = document.querySelector('#popover-status-options .status-btn.selected');
  const status = selectedBtn?.dataset.status || 'attending';
  const notes = document.getElementById('popover-notes').value.trim() || null;

  const { volunteerId, shiftId, shiftDate } = popoverContext;

  // Disable save button during async
  const saveBtn = document.getElementById('popover-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  let result;
  // If status is "attending" with no notes, delete the record (default state)
  if (status === 'attending' && !notes) {
    const existing = attendanceCache.find(a =>
      a.shift_id === shiftId && a.volunteer_id === volunteerId && a.shift_date === shiftDate
    );
    if (existing) {
      result = await sbQuery(sb.from('attendance').delete().eq('id', existing.id));
      if (result === null) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; return; }
    }
  } else {
    result = await sbQuery(sb.from('attendance').upsert({
      shift_id: shiftId,
      volunteer_id: volunteerId,
      shift_date: shiftDate,
      status: status,
      notes: notes,
    }, { onConflict: 'shift_id,volunteer_id,shift_date' }));
    if (result === null) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; return; }
  }

  // Fire away alert only when status CHANGES to away (dedup)
  if (status === 'away') {
    const wasAlreadyAway = attendanceCache.find(a =>
      a.shift_id === shiftId && a.volunteer_id === volunteerId && a.shift_date === shiftDate
    )?.status === 'away';
    if (!wasAlreadyAway) {
      triggerAwayAlert(shiftId, shiftDate, volunteerId);
    }
  }

  showToast('Attendance saved', 'success');
  closeAttendancePopover();
  saveBtn.disabled = false;
  saveBtn.textContent = 'Save';
  await loadWeek(currentMonday);
  renderSchedule();
}

function closeAttendancePopover() {
  document.getElementById('attendance-popover').classList.remove('active');
  popoverContext = null;
}

// ============================================================
// EMAIL NOTIFICATIONS
// ============================================================

async function loadVolunteerEmail(volunteerId) {
  const vol = volunteersCache.find(v => v.id === volunteerId);
  const section = document.getElementById('email-section');
  const input = document.getElementById('volunteer-email');
  const toggle = document.getElementById('email-notif-toggle');
  const status = document.getElementById('email-status');

  section.style.display = 'block';
  input.value = vol?.email || '';
  toggle.checked = vol?.email_notifications !== false;
  status.textContent = '';
}

async function saveVolunteerEmail(volunteerId) {
  const email = document.getElementById('volunteer-email').value.trim();
  const emailNotifications = document.getElementById('email-notif-toggle').checked;
  const statusEl = document.getElementById('email-status');
  const saveBtn = document.getElementById('save-email-btn');

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  statusEl.textContent = '';

  const result = await sbFetch(`${SUPABASE_URL}/functions/v1/update-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      volunteer_id: volunteerId,
      email: email,
      email_notifications: emailNotifications,
    }),
  });

  saveBtn.disabled = false;
  saveBtn.textContent = 'Save';

  if (result) {
    if (result.verification_sent) {
      statusEl.textContent = 'Check your email for a verification link!';
      showToast('Verification email sent', 'info');
    } else if (result.already_verified) {
      statusEl.textContent = 'Email already verified.';
    } else {
      statusEl.textContent = 'Saved!';
    }
    const vol = volunteersCache.find(v => v.id === volunteerId);
    if (vol) {
      vol.email_notifications = emailNotifications;
      // Don't update local email cache — it's pending verification
      if (!result.verification_sent) {
        vol.email = email || null;
      }
    }
  }
}

async function triggerAwayAlert(shiftId, shiftDate, volunteerId) {
  // Fire-and-forget — don't block the UI, but log failures
  sbFetch(`${SUPABASE_URL}/functions/v1/away-alert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      shift_id: shiftId,
      shift_date: shiftDate,
      away_volunteer_id: volunteerId,
    }),
  });
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

      // Shift partners: other volunteers assigned to this same shift
      const partners = assignmentsCache
        .filter(a => a.shift_id === shift.id && a.volunteer_id !== volunteerId)
        .map(a => volunteersCache.find(v => v.id === a.volunteer_id))
        .filter(Boolean)
        .map(v => esc(v.first_name));
      const partnerText = partners.length > 0
        ? `<div class="text-muted text-sm" style="padding:0 16px 8px">with ${partners.join(', ')}</div>`
        : '';

      html += `<div class="day-section" style="margin-bottom:4px">
        <div style="padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
          <span>${DAY_NAMES[d]} ${SLOT_LABELS[slot]} <span class="text-muted text-sm">${fmtDateShort(date)}</span></span>
          <span class="chip chip-${status}" style="cursor:default">${status}</span>
        </div>
        ${partnerText}
      </div>`;
    }
  }

  container.innerHTML = html || '<div class="empty-state">No shifts assigned this week</div>';
}

async function togglePreference(volunteerId, dayOfWeek, timeSlot, checked) {
  let result;
  if (checked) {
    result = await sbQuery(sb.from('preferred_shifts').upsert({
      volunteer_id: volunteerId,
      day_of_week: dayOfWeek,
      time_slot: timeSlot,
    }, { onConflict: 'volunteer_id,day_of_week,time_slot' }));
  } else {
    result = await sbQuery(sb.from('preferred_shifts')
      .delete()
      .eq('volunteer_id', volunteerId)
      .eq('day_of_week', dayOfWeek)
      .eq('time_slot', timeSlot));
  }
  if (result === null) return;
  // Reload prefs
  const prefs = await sbQuery(sb.from('preferred_shifts').select('*'));
  preferredShiftsCache = prefs || [];
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

async function showAdminContent() {
  document.getElementById('admin-login-section').style.display = 'none';
  document.getElementById('admin-content').style.display = 'block';
  await loadAdminWeek(adminMonday);
  renderVolunteerTable();
  renderAttendanceTrends();
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

async function loadAdminWeek(monday) {
  adminMonday = monday;
  const friday = addDays(monday, 4);
  const mondayStr = fmtDateISO(monday);
  const fridayStr = fmtDateISO(friday);

  const att = await sbQuery(sb.from('attendance').select('*')
    .gte('shift_date', mondayStr)
    .lte('shift_date', fridayStr));
  adminAttendanceCache = att || [];

  renderAdminWeekLabel();
  renderAdminOverview();
}

function renderAdminWeekLabel() {
  const friday = addDays(adminMonday, 4);
  const opts = { month: 'short', day: 'numeric' };
  const monStr = adminMonday.toLocaleDateString('en-US', opts);
  const friStr = friday.toLocaleDateString('en-US', opts);
  document.getElementById('admin-week-label').textContent = `${monStr} – ${friStr}`;
}

function renderAdminOverview() {
  const container = document.getElementById('admin-overview');

  // Count stats for the admin-selected week
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

      const dateStr = fmtDateISO(addDays(adminMonday, d));
      for (const a of assigned) {
        const att = adminAttendanceCache.find(r =>
          r.shift_id === shift.id && r.volunteer_id === a.volunteer_id && r.shift_date === dateStr
        );
        if (att?.status === 'away') {
          away++;
          const hasSub = adminAttendanceCache.some(r =>
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

async function renderAttendanceTrends() {
  const container = document.getElementById('admin-trends');
  if (!container) return;

  // Load 4 weeks of attendance data
  const weeks = [];
  for (let w = 3; w >= 0; w--) {
    const monday = addDays(adminMonday, -7 * w);
    const friday = addDays(monday, 4);
    const mondayStr = fmtDateISO(monday);
    const fridayStr = fmtDateISO(friday);

    const att = await sbQuery(sb.from('attendance').select('*')
      .gte('shift_date', mondayStr)
      .lte('shift_date', fridayStr));

    let expected = 0, present = 0, awayCount = 0;
    for (let d = 0; d < 5; d++) {
      for (const slot of SLOT_NAMES) {
        const shift = shiftsCache.find(s => s.day_of_week === d && s.time_slot === slot);
        if (!shift) continue;
        const assigned = assignmentsCache.filter(a => a.shift_id === shift.id);
        expected += assigned.length;
        const dateStr = fmtDateISO(addDays(monday, d));
        for (const a of assigned) {
          const rec = (att || []).find(r =>
            r.shift_id === shift.id && r.volunteer_id === a.volunteer_id && r.shift_date === dateStr
          );
          if (rec?.status === 'away') awayCount++;
          else present++;
        }
      }
    }
    const rate = expected > 0 ? Math.round((present / expected) * 100) : 0;
    weeks.push({
      label: fmtDateShort(monday),
      expected, present, away: awayCount, rate,
    });
  }

  // Render as a simple bar chart using CSS
  const maxExpected = Math.max(...weeks.map(w => w.expected), 1);
  let html = '<div style="display:flex;gap:12px;align-items:flex-end;height:120px;margin-top:12px">';
  for (const week of weeks) {
    const height = Math.round((week.present / maxExpected) * 100);
    const barColor = week.rate >= 80 ? 'var(--ok)' : week.rate >= 60 ? 'var(--warn)' : 'var(--danger)';
    html += `<div style="flex:1;text-align:center">
      <div style="font-size:18px;font-weight:700;color:${barColor}">${week.rate}%</div>
      <div style="background:${barColor};height:${height}px;border-radius:4px 4px 0 0;margin:4px auto;width:100%;max-width:60px;opacity:0.7"></div>
      <div class="text-sm text-muted">${week.label}</div>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
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
      <td>
        <button class="btn btn-secondary text-sm" onclick="editVolunteer('${v.id}')" style="padding:4px 10px;font-size:12px">Edit</button>
        <button class="btn btn-secondary text-sm" onclick="openShiftAssignment('${v.id}')" style="padding:4px 10px;font-size:12px;margin-left:4px">Shifts</button>
      </td>
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

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  const volData = {
    first_name: fd.get('first_name'),
    email: fd.get('email') || null,
    phone: fd.get('phone') || null,
    is_active: fd.get('is_active') === 'true',
  };

  let result;
  if (id) {
    result = await sbQuery(sb.from('volunteers').update(volData).eq('id', id));
  } else {
    result = await sbQuery(sb.from('volunteers').insert(volData));
  }

  submitBtn.disabled = false;
  submitBtn.textContent = 'Save';
  if (result === null) return;

  showToast(id ? 'Volunteer updated' : 'Volunteer added', 'success');
  closeModal('volunteer-modal');
  await loadBaseData();
  renderVolunteerTable();
  populateVolunteerDropdowns();
  renderSchedule();
}

// ============================================================
// SHIFT ASSIGNMENT MANAGEMENT
// ============================================================

function openShiftAssignment(volunteerId) {
  const vol = volunteersCache.find(v => v.id === volunteerId);
  if (!vol) return;

  document.getElementById('shift-assign-title').textContent = `Shift Assignments — ${vol.first_name}`;
  const grid = document.getElementById('shift-assign-grid');

  const volAssignments = assignmentsCache.filter(a => a.volunteer_id === volunteerId);

  let html = '<div></div><div class="pref-header">Morning</div><div class="pref-header">Afternoon</div><div class="pref-header">Evening</div>';
  for (let d = 0; d < 5; d++) {
    html += `<div class="pref-day">${DAY_NAMES[d]}</div>`;
    for (const slot of SLOT_NAMES) {
      const shift = shiftsCache.find(s => s.day_of_week === d && s.time_slot === slot);
      if (!shift) { html += '<div class="pref-cell">—</div>'; continue; }
      const isAssigned = volAssignments.some(a => a.shift_id === shift.id);
      html += `<div class="pref-cell">
        <input type="checkbox" ${isAssigned ? 'checked' : ''}
          onchange="toggleShiftAssignment('${volunteerId}', '${shift.id}', this.checked)">
      </div>`;
    }
  }
  grid.innerHTML = html;
  openModal('shift-assign-modal');
}

async function toggleShiftAssignment(volunteerId, shiftId, assigned) {
  if (assigned) {
    await sbQuery(sb.from('shift_assignments').upsert({
      shift_id: shiftId,
      volunteer_id: volunteerId,
      is_active: true,
    }, { onConflict: 'shift_id,volunteer_id' }));
  } else {
    await sbQuery(sb.from('shift_assignments')
      .delete()
      .eq('shift_id', shiftId)
      .eq('volunteer_id', volunteerId));
  }
  // Reload assignments
  await loadBaseData();
  renderVolunteerTable();
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

  // Sub popover
  document.getElementById('sub-popover-save').addEventListener('click', saveSub);
  document.getElementById('sub-popover-cancel').addEventListener('click', closeSubPopover);
  document.getElementById('sub-popover').addEventListener('click', (e) => {
    if (e.target.id === 'sub-popover') closeSubPopover();
  });

  // My Shifts volunteer select
  document.getElementById('my-volunteer-select').addEventListener('change', (e) => {
    renderMyShifts(e.target.value);
    if (e.target.value) {
      loadVolunteerEmail(e.target.value);
    } else {
      document.getElementById('email-section').style.display = 'none';
    }
  });

  // Email save
  document.getElementById('save-email-btn').addEventListener('click', () => {
    const volunteerId = document.getElementById('my-volunteer-select').value;
    if (volunteerId) saveVolunteerEmail(volunteerId);
  });

  // Admin
  document.getElementById('admin-signin-btn').addEventListener('click', signInAdmin);
  document.getElementById('admin-signout-btn').addEventListener('click', signOutAdmin);
  document.getElementById('add-volunteer-btn').addEventListener('click', openAddVolunteer);
  document.getElementById('volunteer-form').addEventListener('submit', submitVolunteerForm);

  // Admin week nav
  document.getElementById('admin-prev-week').addEventListener('click', () => loadAdminWeek(addDays(adminMonday, -7)));
  document.getElementById('admin-next-week').addEventListener('click', () => loadAdminWeek(addDays(adminMonday, 7)));
  document.getElementById('admin-today-btn').addEventListener('click', () => loadAdminWeek(getMonday(new Date())));

  // Modal overlay click to close
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      e.target.classList.remove('active');
      document.body.style.overflow = '';
    }
  });

  // ESC key to close popovers and modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (popoverContext) closeAttendancePopover();
      if (subPopoverContext) closeSubPopover();
      document.querySelectorAll('.modal-overlay.active').forEach(m => {
        m.classList.remove('active');
        document.body.style.overflow = '';
      });
    }
  });

  // Online/offline handling
  updateOnlineStatus();
  window.addEventListener('online', () => {
    updateOnlineStatus();
    replayOfflineQueue();
  });
  window.addEventListener('offline', updateOnlineStatus);

  // Copy schedule button
  const copyBtn = document.getElementById('copy-schedule-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', copyScheduleToClipboard);
  }
});

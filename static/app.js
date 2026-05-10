/* ══════════════════════════════════════════
   苹果日历 · 完整交互逻辑
   ══════════════════════════════════════════ */

const HOUR_H = 64; // 每小时高度(px)
const DAY_H  = HOUR_H * 24;
const API    = '';

/* ─── 状态 ─── */
const state = {
  view:        'month',      // month | week | day
  tab:         'calendar',   // calendar | reminders
  today:       new Date(),
  cursor:      new Date(),   // 当前导航到的日期
  miniCursor:  new Date(),
  events:      [],
  reminders:   [],
  calendars:   [],
  reminderLists: [],
  hiddenCals:  new Set(),
  activeList:  null,
  editingId:   null,
  selectedColor: '#007AFF',
};

/* ─── DOM ─── */
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

/* ══════════════════════════════════════════
   启动
   ══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(localStorage.getItem('theme') || 'light');
  bindTopbar();
  bindModals();
  await loadAll();
  render();
  startNowLine();
  scrollToNow();
});

async function loadAll() {
  await Promise.all([loadCalendars(), loadReminderLists()]);
  await Promise.all([loadEvents(), loadReminders()]);
}

/* ══════════════════════════════════════════
   主题
   ══════════════════════════════════════════ */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
}

/* ══════════════════════════════════════════
   顶栏绑定
   ══════════════════════════════════════════ */
function bindTopbar() {
  // 深浅色切换
  $('themeToggle').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  };

  // 侧栏折叠
  $('sidebarToggle').onclick = () => {
    $('sidebar').classList.toggle('collapsed');
  };

  // 标签切换
  $$('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.tab = btn.dataset.tab;
      switchTab();
    };
  });

  // 视图切换
  $$('.view-btn').forEach(btn => {
    btn.onclick = () => {
      $$('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.view = btn.dataset.view;
      render();
      scrollToNow();
    };
  });

  // 导航
  $('prevBtn').onclick  = () => navigate(-1);
  $('nextBtn').onclick  = () => navigate(1);
  $('todayBtn').onclick = () => goToday();

  // 同步
  $('syncBtn').onclick = async () => {
    const btn = $('syncBtn');
    btn.classList.add('syncing');
    setSyncStatus('syncing');
    try {
      await api('POST', '/api/sync');
      await new Promise(r => setTimeout(r, 800));
      await loadAll();
      render();
      toast('同步完成 ✓');
      setSyncStatus('ok');
    } catch(e) {
      toast('同步失败，请检查 Outlook 是否运行');
      setSyncStatus('error');
    }
    btn.classList.remove('syncing');
  };

  // 搜索
  $('searchBtn').onclick = () => {
    $('searchBar').classList.toggle('open');
    if ($('searchBar').classList.contains('open'))
      $('searchInput').focus();
  };
  $('searchClose').onclick = () => {
    $('searchBar').classList.remove('open');
    $('searchInput').value = '';
    render();
  };
  $('searchInput').addEventListener('input', debounce(() => {
    renderMonth(); renderMiniCal();
  }, 300));
}

/* ══════════════════════════════════════════
   导航
   ══════════════════════════════════════════ */
function navigate(dir) {
  const d = new Date(state.cursor);
  if      (state.view === 'month') d.setMonth(d.getMonth() + dir);
  else if (state.view === 'week')  d.setDate(d.getDate() + dir * 7);
  else                             d.setDate(d.getDate() + dir);
  state.cursor = d;
  render();
}

function goToday() {
  state.cursor = new Date(state.today);
  render();
  scrollToNow();
}

function updateHeader() {
  const d  = state.cursor;
  const yr = d.getFullYear();
  const mo = d.getMonth();
  const MONTHS = ['一月','二月','三月','四月','五月','六月',
                  '七月','八月','九月','十月','十一月','十二月'];
  let txt = '';
  if      (state.view === 'month') txt = `${yr}年${MONTHS[mo]}`;
  else if (state.view === 'week') {
    const ws = weekStart(d), we = new Date(ws);
    we.setDate(we.getDate() + 6);
    txt = ws.getMonth() === we.getMonth()
      ? `${yr}年${MONTHS[mo]} ${ws.getDate()}–${we.getDate()}日`
      : `${MONTHS[ws.getMonth()]} ${ws.getDate()} – ${MONTHS[we.getMonth()]} ${we.getDate()}`;
  } else {
    txt = `${yr}年${MONTHS[mo]}${d.getDate()}日`;
  }
  $('currentPeriod').textContent = txt;
}

/* ══════════════════════════════════════════
   标签切换
   ══════════════════════════════════════════ */
function switchTab() {
  const isRem = state.tab === 'reminders';
  $('viewSwitcher').style.display = isRem ? 'none' : '';
  $('prevBtn').style.display      = isRem ? 'none' : '';
  $('nextBtn').style.display      = isRem ? 'none' : '';
  $('currentPeriod').style.display = isRem ? 'none' : '';
  $('todayBtn').style.display     = isRem ? 'none' : '';
  $('calendarSection').style.display  = isRem ? 'none' : '';
  $('remindersSection').style.display = isRem ? '' : 'none';

  $$('.view').forEach(v => v.classList.remove('active'));
  if (isRem) {
    $('remindersView').classList.add('active');
    renderRemindersView();
  } else {
    render();
  }
}

/* ══════════════════════════════════════════
   总渲染入口
   ══════════════════════════════════════════ */
function render() {
  updateHeader();
  renderMiniCal();
  renderSidebarCals();
  $$('.view').forEach(v => v.classList.remove('active'));
  if      (state.view === 'month') { $('monthView').classList.add('active'); renderMonth(); }
  else if (state.view === 'week')  { $('weekView').classList.add('active');  renderWeek();  }
  else                             { $('dayView').classList.add('active');   renderDay();   }
}

/* ══════════════════════════════════════════
   过滤事件
   ══════════════════════════════════════════ */
function filteredEvents() {
  const q = $('searchInput').value.trim().toLowerCase();
  return state.events.filter(ev => {
    if (state.hiddenCals.has(ev.calendar_id)) return false;
    if (q && !ev.title.toLowerCase().includes(q) &&
        !(ev.description||'').toLowerCase().includes(q)) return false;
    return true;
  });
}

function eventsOn(dateStr) {
  return filteredEvents().filter(ev => ev.start_time.startsWith(dateStr));
}

/* ══════════════════════════════════════════
   迷你日历
   ══════════════════════════════════════════ */
function renderMiniCal() {
  const d  = new Date(state.miniCursor);
  const yr = d.getFullYear(), mo = d.getMonth();
  const MONTHS = ['1月','2月','3月','4月','5月','6月',
                  '7月','8月','9月','10月','11月','12月'];
  $('miniTitle').textContent = `${yr}年${MONTHS[mo]}`;

  const first = new Date(yr, mo, 1);
  const last  = new Date(yr, mo+1, 0);
  const startDow = first.getDay();
  const todayStr = fmtDate(state.today);
  const container = $('miniDays');
  container.innerHTML = '';

  // 上月补位
  for (let i = 0; i < startDow; i++) {
    const dd = new Date(yr, mo, -startDow + i + 1);
    const el = miniDayEl(dd, true);
    container.appendChild(el);
  }
  // 本月
  for (let i = 1; i <= last.getDate(); i++) {
    const dd = new Date(yr, mo, i);
    container.appendChild(miniDayEl(dd, false));
  }
  // 下月补位
  const total = startDow + last.getDate();
  const rem   = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= rem; i++) {
    container.appendChild(miniDayEl(new Date(yr, mo+1, i), true));
  }

  $('miniPrev').onclick = () => { state.miniCursor.setMonth(mo-1); renderMiniCal(); };
  $('miniNext').onclick = () => { state.miniCursor.setMonth(mo+1); renderMiniCal(); };
}

function miniDayEl(date, otherMonth) {
  const el  = document.createElement('div');
  const str = fmtDate(date);
  el.className = 'mini-day' +
    (otherMonth ? ' other-month' : '') +
    (str === fmtDate(state.today) ? ' today' : '') +
    (str === fmtDate(state.cursor) ? ' selected' : '');

  if (state.events.some(ev => ev.start_time.startsWith(str))) el.classList.add('has-event');

  el.textContent = date.getDate();
  el.onclick = () => {
    state.cursor = new Date(date);
    state.miniCursor = new Date(date);
    if (state.view === 'month') {
      state.cursor.setDate(1);
      state.cursor.setMonth(date.getMonth());
    }
    render();
  };
  return el;
}

/* ══════════════════════════════════════════
   侧栏日历列表
   ══════════════════════════════════════════ */
function renderSidebarCals() {
  const ul = $('calendarList');
  ul.innerHTML = '';
  state.calendars.forEach(cal => {
    const li   = document.createElement('li');
    const hidden = state.hiddenCals.has(cal.id);
    li.innerHTML = `
      <span class="cal-dot" style="background:${cal.color || '#007AFF'};
        opacity:${hidden ? 0.3 : 1}"></span>
      <span style="flex:1">${cal.name}</span>
    `;
    li.onclick = () => {
      if (state.hiddenCals.has(cal.id)) state.hiddenCals.delete(cal.id);
      else state.hiddenCals.add(cal.id);
      render();
    };
    ul.appendChild(li);
  });

  // 侧栏折叠
  $$('.sidebar-section-header').forEach(hdr => {
    hdr.onclick = () => {
      hdr.classList.toggle('collapsed');
      const list = $(hdr.dataset.toggle);
      if (list) list.style.display = hdr.classList.contains('collapsed') ? 'none' : '';
    };
  });
}

/* ══════════════════════════════════════════
   月视图
   ══════════════════════════════════════════ */
function renderMonth() {
  const d     = state.cursor;
  const yr    = d.getFullYear(), mo = d.getMonth();
  const first = new Date(yr, mo, 1);
  const last  = new Date(yr, mo+1, 0);
  const grid  = $('monthGrid');
  grid.innerHTML = '';

  const totalCells = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const offset  = i - first.getDay();
    const date    = new Date(yr, mo, 1 + offset);
    const dateStr = fmtDate(date);
    const isToday = dateStr === fmtDate(state.today);
    const isOther = date.getMonth() !== mo;
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

    const cell = document.createElement('div');
    cell.className = 'day-cell' +
      (isOther   ? ' other-month' : '') +
      (isToday   ? ' today'       : '') +
      (isWeekend ? ' weekend'     : '');
    cell.dataset.date = dateStr;

    // 日期数字
    const num = document.createElement('div');
    num.className = 'day-num';
    num.textContent = date.getDate();
    cell.appendChild(num);

    // 事件
    const dayEvs = eventsOn(dateStr);
    const MAX = 3;
    dayEvs.slice(0, MAX).forEach((ev, idx) => {
      cell.appendChild(makeChip(ev));
      // stagger animation
      cell.lastChild.style.animationDelay = `${idx * 30}ms`;
    });
    if (dayEvs.length > MAX) {
      const more = document.createElement('div');
      more.className = 'more-events';
      more.textContent = `+${dayEvs.length - MAX} 个`;
      more.onclick = e => { e.stopPropagation(); showMoreEvents(date, dayEvs); };
      cell.appendChild(more);
    }

    // 点击空白 → 新建事件
    cell.onclick = e => {
      if (e.target.classList.contains('event-chip') ||
          e.target.classList.contains('more-events')) return;
      openEventModal(dateStr);
    };

    grid.appendChild(cell);
  }
}

function makeChip(ev) {
  const chip = document.createElement('div');
  chip.className = 'event-chip' + (ev.all_day ? ' all-day' : '');
  chip.style.background = ev.color || '#007AFF';
  chip.innerHTML = `<span>${ev.title}</span>`;
  chip.onclick = e => { e.stopPropagation(); openDetail(ev); };
  return chip;
}

function showMoreEvents(date, evs) {
  // 简单：切换到日视图
  state.cursor = new Date(date);
  state.view   = 'day';
  $$('.view-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === 'day');
  });
  render();
}

/* ══════════════════════════════════════════
   周视图
   ══════════════════════════════════════════ */
function renderWeek() {
  const ws    = weekStart(state.cursor);
  const cols  = $('weekColumns');
  const hdr   = $('weekHeader');
  const DAYS  = ['日','一','二','三','四','五','六'];
  cols.innerHTML = '';
  hdr.innerHTML  = '';
  hdr.style.gridTemplateColumns = `repeat(7, 1fr)`;
  cols.style.gridTemplateColumns = `repeat(7, 1fr)`;
  cols.style.height = DAY_H + 'px';

  // 时间刻度
  renderTimeGutter('timeGutter');

  for (let i = 0; i < 7; i++) {
    const date    = new Date(ws);
    date.setDate(ws.getDate() + i);
    const dateStr = fmtDate(date);
    const isToday = dateStr === fmtDate(state.today);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

    // 表头
    const dh = document.createElement('div');
    dh.className = 'week-day-header' +
      (isToday ? ' today' : '') + (isWeekend ? ' weekend' : '');
    dh.innerHTML = `
      <div class="wdh-name">${DAYS[date.getDay()]}</div>
      <div class="wdh-num">${date.getDate()}</div>
    `;
    dh.querySelector('.wdh-num').onclick = () => {
      state.cursor = new Date(date);
      state.view   = 'day';
      $$('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'day'));
      render();
    };
    hdr.appendChild(dh);

    // 列
    const col = document.createElement('div');
    col.className = 'week-col';
    col.style.height = DAY_H + 'px';
    col.dataset.date = dateStr;

    // 时间线
    for (let h = 0; h < 24; h++) {
      const line = document.createElement('div');
      line.className = 'hour-line';
      line.style.top = h * HOUR_H + 'px';
      col.appendChild(line);
      if (h > 0) {
        const half = document.createElement('div');
        half.className = 'half-line';
        half.style.top = (h - 0.5) * HOUR_H + 'px';
        col.appendChild(half);
      }
    }

    // 事件块
    const dayEvs = eventsOn(dateStr).filter(ev => !ev.all_day);
    layoutEvents(dayEvs).forEach(({ ev, left, width }) => {
      col.appendChild(makeTimeBlock(ev, left, width));
    });

    // 点击新建
    col.onclick = e => {
      if (e.target.classList.contains('time-event') ||
          e.target.closest('.time-event')) return;
      const rect  = col.getBoundingClientRect();
      const frac  = (e.clientY - rect.top) / DAY_H;
      const mins  = Math.round(frac * 24 * 60 / 30) * 30;
      const start = dateStr + 'T' + minsToTime(mins);
      const end   = dateStr + 'T' + minsToTime(mins + 60);
      openEventModal(dateStr, start, end);
    };

    cols.appendChild(col);
  }

  // 当前时间线
  if (fmtDate(state.today) >= fmtDate(ws) &&
      fmtDate(state.today) <= fmtDate(new Date(ws.getTime() + 6*86400000))) {
    placeNowLine(cols, ws);
  }
}

/* ══════════════════════════════════════════
   日视图
   ══════════════════════════════════════════ */
function renderDay() {
  const date    = state.cursor;
  const dateStr = fmtDate(date);
  const isToday = dateStr === fmtDate(state.today);
  const DAYS    = ['周日','周一','周二','周三','周四','周五','周六'];

  const hdr = $('dayHeader');
  hdr.className = 'day-header' + (isToday ? ' today' : '');
  hdr.innerHTML = `
    <div class="day-big-num">${date.getDate()}</div>
    <div class="day-big-name">${DAYS[date.getDay()]}</div>
  `;

  renderTimeGutter('dayTimeGutter');

  const col = $('dayColumn');
  col.innerHTML = '';
  col.style.height = DAY_H + 'px';

  for (let h = 0; h < 24; h++) {
    const line = document.createElement('div');
    line.className = 'hour-line';
    line.style.top = h * HOUR_H + 'px';
    col.appendChild(line);
    if (h > 0) {
      const half = document.createElement('div');
      half.className = 'half-line';
      half.style.top = (h - 0.5) * HOUR_H + 'px';
      col.appendChild(half);
    }
  }

  const dayEvs = eventsOn(dateStr).filter(ev => !ev.all_day);
  layoutEvents(dayEvs).forEach(({ ev, left, width }) => {
    col.appendChild(makeTimeBlock(ev, left, width));
  });

  col.onclick = e => {
    if (e.target.classList.contains('time-event') ||
        e.target.closest('.time-event')) return;
    const rect  = col.getBoundingClientRect();
    const frac  = (e.clientY - rect.top) / DAY_H;
    const mins  = Math.round(frac * 24 * 60 / 30) * 30;
    const start = dateStr + 'T' + minsToTime(mins);
    const end   = dateStr + 'T' + minsToTime(mins + 60);
    openEventModal(dateStr, start, end);
  };

  if (isToday) placeNowLineDay();
}

/* ── 时间刻度 ── */
function renderTimeGutter(id) {
  const g = $(id);
  g.innerHTML = '';
  g.style.height = DAY_H + 'px';
  for (let h = 1; h < 24; h++) {
    const lbl = document.createElement('div');
    lbl.className = 'time-label';
    lbl.style.top = h * HOUR_H + 'px';
    lbl.textContent = h < 12 ? `${h} AM`
                    : h === 12 ? '12 PM'
                    : `${h-12} PM`;
    g.appendChild(lbl);
  }
}

/* ── 事件块 ── */
function makeTimeBlock(ev, leftPct, widthPct) {
  const start = timeToMins(ev.start_time.substring(11,16));
  const end   = timeToMins(ev.end_time.substring(11,16)) || 24*60;
  const dur   = Math.max(end - start, 30);
  const el    = document.createElement('div');
  el.className = 'time-event';
  el.style.cssText = `
    top:${start/60 * HOUR_H}px;
    height:${dur/60 * HOUR_H - 2}px;
    background:${ev.color || '#007AFF'};
    left:${leftPct}%;
    width:${widthPct}%;
  `;
  el.innerHTML = `
    <div class="te-title">${ev.title}</div>
    <div class="te-time">${ev.start_time.substring(11,16)} – ${ev.end_time.substring(11,16)}</div>
  `;
  el.onclick = e => { e.stopPropagation(); openDetail(ev); };
  return el;
}

/* ── 事件重叠排列 ── */
function layoutEvents(evs) {
  const sorted = [...evs].sort((a,b) =>
    timeToMins(a.start_time.substring(11,16)) -
    timeToMins(b.start_time.substring(11,16)));

  const cols   = [];
  const result = [];

  sorted.forEach(ev => {
    const s = timeToMins(ev.start_time.substring(11,16));
    const e = timeToMins(ev.end_time.substring(11,16)) || 24*60;
    let placed = false;
    for (let c = 0; c < cols.length; c++) {
      if (cols[c] <= s) { cols[c] = e; result.push({ ev, col: c }); placed = true; break; }
    }
    if (!placed) { cols.push(e); result.push({ ev, col: cols.length - 1 }); }
  });

  const numCols = cols.length || 1;
  return result.map(({ ev, col }) => ({
    ev,
    left:  col / numCols * 100,
    width: 100 / numCols,
  }));
}

/* ── 当前时间线 ── */
function placeNowLine(container, weekStartDate) {
  const now   = new Date();
  const dayIdx = (now.getDay() + 7 - weekStartDate.getDay()) % 7;
  const mins   = now.getHours() * 60 + now.getMinutes();
  const top    = mins / 60 * HOUR_H;
  const cols   = container.children;
  if (!cols[dayIdx]) return;
  const line   = document.createElement('div');
  line.className = 'now-line';
  line.style.top = top + 'px';
  cols[dayIdx].appendChild(line);
}

function placeNowLineDay() {
  const col  = $('dayColumn');
  const mins = new Date().getHours() * 60 + new Date().getMinutes();
  const line = document.createElement('div');
  line.className = 'now-line';
  line.style.cssText = `top:${mins/60*HOUR_H}px; left:0; right:0;`;
  col.appendChild(line);
}

function startNowLine() {
  // 每分钟重新渲染时间线
  setInterval(() => {
    if (state.view !== 'month' && state.tab === 'calendar') render();
  }, 60000);
}

function scrollToNow() {
  setTimeout(() => {
    const mins = new Date().getHours() * 60 + new Date().getMinutes();
    const top  = Math.max(0, mins / 60 * HOUR_H - 120);
    const body = document.querySelector('.week-body') ||
                 document.querySelector('.day-body');
    if (body) body.scrollTop = top;
  }, 80);
}

/* ══════════════════════════════════════════
   提醒事项视图
   ══════════════════════════════════════════ */
function renderRemindersView() {
  // 侧栏提醒列表
  const ul = $('remindersList');
  ul.innerHTML = '';
  state.reminderLists.forEach(lst => {
    const count = state.reminders.filter(r => r.list_id === lst.id && !r.completed).length;
    const li    = document.createElement('li');
    li.className = state.activeList === lst.id ? 'active' : '';
    li.innerHTML = `
      <span class="cal-dot" style="background:${lst.color || '#FF3B30'}"></span>
      <span style="flex:1">${lst.name}</span>
      ${count ? `<span class="cal-count">${count}</span>` : ''}
    `;
    li.onclick = () => {
      state.activeList = lst.id;
      renderRemindersView();
    };
    ul.appendChild(li);
  });

  // 主面板
  const listId  = state.activeList;
  const listObj = state.reminderLists.find(l => l.id === listId);
  const items   = state.reminders.filter(r =>
    (!listId || r.list_id === listId));

  $('remindersListTitle').textContent = listObj ? listObj.name : '全部提醒';
  $('remindersListTitle').style.color  = listObj?.color || 'var(--text-primary)';

  const todo = items.filter(r => !r.completed);
  const done = items.filter(r => r.completed);
  $('remindersCount').textContent = todo.length || '';

  const container = $('remindersItems');
  container.innerHTML = '';

  [...todo, ...done].forEach((rm, idx) => {
    const li = document.createElement('li');
    li.className = 'reminder-item' + (rm.completed ? ' completed' : '');
    li.style.animationDelay = `${idx * 20}ms`;

    const priority = rm.priority >= 2 ? 'priority-high' : '';
    const dueClass = rm.due_date ? getDueClass(rm.due_date) : '';
    const dueLabel = rm.due_date ? formatDue(rm.due_date) : '';

    li.innerHTML = `
      <div class="reminder-check ${rm.completed ? 'checked' : ''} ${priority}"
           data-id="${rm.id}"></div>
      <div class="reminder-content">
        <div class="reminder-title">${escHtml(rm.title)}</div>
        ${rm.notes ? `<div class="reminder-notes">${escHtml(rm.notes)}</div>` : ''}
        ${dueLabel ? `<div class="reminder-due ${dueClass}">${dueLabel}</div>` : ''}
      </div>
      <button class="reminder-delete" data-id="${rm.id}" aria-label="删除">×</button>
    `;

    li.querySelector('.reminder-check').onclick = async e => {
      e.stopPropagation();
      const done = !rm.completed;
      // 动画
      const check = e.currentTarget;
      check.classList.toggle('checked', done);
      li.classList.toggle('completed', done);
      try {
        await api('POST', `/api/reminders/${rm.id}/complete`, { completed: done });
        rm.completed = done;
        setTimeout(() => renderRemindersView(), 600);
      } catch { toast('操作失败'); }
    };

    li.querySelector('.reminder-delete').onclick = async e => {
      e.stopPropagation();
      li.style.opacity = '0';
      li.style.transform = 'translateX(20px)';
      li.style.transition = 'all 0.25s';
      try {
        await api('DELETE', `/api/reminders/${rm.id}`);
        state.reminders = state.reminders.filter(r => r.id !== rm.id);
        setTimeout(() => renderRemindersView(), 250);
      } catch { li.style.opacity = '1'; li.style.transform = ''; toast('删除失败'); }
    };

    container.appendChild(li);
  });

  $('addReminderBtn').onclick = () => openReminderModal();
}

function getDueClass(due) {
  const d   = new Date(due);
  const now = new Date();
  const tod = new Date(); tod.setHours(23,59,59,999);
  if (d < now) return 'overdue';
  if (d <= tod) return 'today';
  return 'upcoming';
}

function formatDue(due) {
  const d   = new Date(due);
  const now = new Date();
  const tod = new Date(); tod.setHours(23,59,59,999);
  if (d < now) return `已过期 · ${d.toLocaleDateString('zh-CN')}`;
  if (d <= tod) return `今天 ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  const diff = Math.ceil((d - now) / 86400000);
  if (diff <= 7) return `${d.toLocaleDateString('zh-CN', {weekday:'long'})}`;
  return d.toLocaleDateString('zh-CN');
}

/* ══════════════════════════════════════════
   弹窗
   ══════════════════════════════════════════ */
function bindModals() {
  // 点击遮罩关闭
  $$('.modal-overlay').forEach(overlay => {
    overlay.onclick = e => {
      if (e.target === overlay) closeAllModals();
    };
  });

  // ESC 关闭
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllModals();
  });

  // ── 事件弹窗 ──
  $('eventModalClose').onclick  = closeAllModals;
  $('eventModalCancel').onclick = closeAllModals;
  $('eventAllDay').onchange     = e => {
    $('timeRow').style.display = e.target.checked ? 'none' : '';
  };

  // 颜色选择
  $$('#eventColorPicker .color-dot').forEach(dot => {
    dot.onclick = () => {
      $$('#eventColorPicker .color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      state.selectedColor = dot.dataset.color;
    };
  });

  $('eventModalSave').onclick = async () => {
    const title = $('eventTitle').value.trim();
    if (!title) { $('eventTitle').focus(); shake($('eventTitle')); return; }
    const allDay = $('eventAllDay').checked;
    const body   = {
      title,
      start_time:  $('eventStart').value || state._pendingStart || '',
      end_time:    $('eventEnd').value   || state._pendingEnd   || '',
      description: $('eventDesc').value,
      location:    $('eventLocation').value,
      all_day:     allDay,
      calendar_id: $('eventCalendar').value,
      color:       state.selectedColor,
    };
    $('eventModalSave').textContent = '添加中…';
    try {
      const r = await api('POST', '/api/events', body);
      state.events.push({ ...body, id: r.id });
      closeAllModals();
      render();
      toast('事件已添加 ✓');
    } catch { toast('添加失败'); }
    $('eventModalSave').textContent = '添加';
  };

  // ── 详情弹窗 ──
  $('detailModalClose').onclick = closeAllModals;
  $('editEventBtn').onclick = () => {
    const ev = state._viewingEvent;
    if (!ev) return;
    closeAllModals();
    openEventModal(ev.start_time.slice(0,10), ev.start_time, ev.end_time, ev);
  };
  $('deleteEventBtn').onclick = async () => {
    const ev = state._viewingEvent;
    if (!ev) return;
    if (!confirm(`删除「${ev.title}」？`)) return;
    try {
      await api('DELETE', `/api/events/${ev.id}`);
      state.events = state.events.filter(e => e.id !== ev.id);
      closeAllModals();
      render();
      toast('事件已删除');
    } catch { toast('删除失败'); }
  };

  // ── 提醒弹窗 ──
  $('reminderModalClose').onclick  = closeAllModals;
  $('reminderModalCancel').onclick = closeAllModals;
  $('reminderModalSave').onclick   = async () => {
    const title = $('reminderTitle').value.trim();
    if (!title) { $('reminderTitle').focus(); shake($('reminderTitle')); return; }
    const body = {
      title,
      notes:    $('reminderNotes').value,
      due_date: $('reminderDue').value,
      priority: parseInt($('reminderPriority').value),
      list_id:  $('reminderList').value,
    };
    try {
      const r = await api('POST', '/api/reminders', body);
      state.reminders.push({ ...body, id: r.id, completed: 0 });
      closeAllModals();
      renderRemindersView();
      toast('提醒已添加 ✓');
    } catch { toast('添加失败'); }
  };
}

function openEventModal(dateStr, start, end, editEv) {
  // 填充日历选项
  const sel = $('eventCalendar');
  sel.innerHTML = state.calendars.map(c =>
    `<option value="${c.id}">${c.name}</option>`).join('');

  $('eventTitle').value     = editEv?.title       || '';
  $('eventDesc').value      = editEv?.description || '';
  $('eventLocation').value  = editEv?.location    || '';
  $('eventAllDay').checked  = editEv?.all_day     || false;
  $('timeRow').style.display = (editEv?.all_day) ? 'none' : '';

  const startVal = start
    ? start.slice(0,16)
    : `${dateStr}T09:00`;
  const endVal   = end
    ? end.slice(0,16)
    : `${dateStr}T10:00`;
  $('eventStart').value = startVal;
  $('eventEnd').value   = endVal;
  state._pendingStart   = startVal;
  state._pendingEnd     = endVal;
  state._viewingEvent   = editEv || null;

  $('eventModalTitle').textContent = editEv ? '编辑事件' : '新建事件';
  $('eventModalSave').textContent  = editEv ? '保存' : '添加';

  // 颜色
  const col = editEv?.color || '#007AFF';
  state.selectedColor = col;
  $$('#eventColorPicker .color-dot').forEach(d => {
    d.classList.toggle('active', d.dataset.color === col);
  });

  $('eventModal').classList.add('open');
  setTimeout(() => $('eventTitle').focus(), 200);
}

function openDetail(ev) {
  state._viewingEvent = ev;
  $('detailTitle').textContent    = ev.title;
  $('detailColorBar').style.background = ev.color || '#007AFF';

  const s = new Date(ev.start_time);
  const e = new Date(ev.end_time);
  $('detailTime').textContent = ev.all_day
    ? s.toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric' })
    : `${s.toLocaleDateString('zh-CN', { month:'long', day:'numeric' })} `
    + `${s.getHours().toString().padStart(2,'0')}:${s.getMinutes().toString().padStart(2,'0')}`
    + ` – ${e.getHours().toString().padStart(2,'0')}:${e.getMinutes().toString().padStart(2,'0')}`;

  $('detailLocation').textContent = ev.location || '';
  $('detailLocation').style.display = ev.location ? '' : 'none';
  $('detailDesc').textContent     = ev.description || '';
  $('detailDesc').style.display   = ev.description ? '' : 'none';
  $('eventDetailModal').classList.add('open');
}

function openReminderModal() {
  $('reminderTitle').value    = '';
  $('reminderNotes').value    = '';
  $('reminderDue').value      = '';
  $('reminderPriority').value = '1';
  const sel = $('reminderList');
  sel.innerHTML = state.reminderLists.map(l =>
    `<option value="${l.id}"${l.id===state.activeList?' selected':''}>${l.name}</option>`).join('');
  $('reminderModal').classList.add('open');
  setTimeout(() => $('reminderTitle').focus(), 200);
}

function closeAllModals() {
  $$('.modal-overlay').forEach(m => m.classList.remove('open'));
}

/* ══════════════════════════════════════════
   API
   ══════════════════════════════════════════ */
async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body:    body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadCalendars() {
  try {
    state.calendars = await api('GET', '/api/calendars');
  } catch { state.calendars = []; }
}

async function loadReminderLists() {
  try {
    state.reminderLists = await api('GET', '/api/reminder-lists');
    if (state.reminderLists.length && !state.activeList)
      state.activeList = state.reminderLists[0].id;
  } catch { state.reminderLists = []; }
}

async function loadEvents() {
  try {
    const d  = state.cursor;
    const s  = new Date(d.getFullYear(), d.getMonth()-1, 1).toISOString();
    const e  = new Date(d.getFullYear(), d.getMonth()+3, 0).toISOString();
    state.events = await api('GET', `/api/events?start=${s}&end=${e}`);
  } catch { state.events = []; }
}

async function loadReminders() {
  try {
    state.reminders = await api('GET', '/api/reminders?completed=true');
  } catch { state.reminders = []; }
}

/* ══════════════════════════════════════════
   同步状态
   ══════════════════════════════════════════ */
function setSyncStatus(s) {
  const dot = $('syncStatus').querySelector('.sync-dot');
  const lbl = $('syncStatus').querySelector('.sync-label');
  dot.className = 'sync-dot' + (s === 'syncing' ? ' syncing' : s === 'error' ? ' error' : '');
  lbl.textContent = { ok:'已同步', syncing:'同步中…', error:'同步失败' }[s] || '已同步';
}

/* ══════════════════════════════════════════
   Toast
   ══════════════════════════════════════════ */
let _toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ══════════════════════════════════════════
   工具函数
   ══════════════════════════════════════════ */
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function weekStart(d) {
  const s = new Date(d);
  s.setDate(d.getDate() - d.getDay());
  return s;
}

function timeToMins(t) {
  if (!t) return 0;
  const [h,m] = t.split(':').map(Number);
  return h*60 + (m||0);
}

function minsToTime(mins) {
  const h = Math.floor(mins/60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function shake(el) {
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'shake 0.35s ease';
  setTimeout(() => el.style.animation = '', 400);
}

function escHtml(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// 抖动动画（CSS补充）
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%,100%{transform:translateX(0)}
    20%{transform:translateX(-6px)}
    40%{transform:translateX(6px)}
    60%{transform:translateX(-4px)}
    80%{transform:translateX(4px)}
  }
`;
document.head.appendChild(shakeStyle);
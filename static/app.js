const HOUR_HEIGHT = 80;
const API = '';

const COLORS = {
  personal: '#58aee8',
  work: '#c87ae4',
  red: '#ff453f',
};

const state = {
  view: 'day',
  today: new Date(),
  cursor: new Date(),
  events: [],
  calendars: [],
  visibleCalendars: new Set(),
  selectedEvent: null,
  draft: null,
  defaultCalendarId: '',
  loadedRange: null,
  gotoCursor: new Date(),
  gotoSelected: new Date(),
};

const $ = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];

document.addEventListener('DOMContentLoaded', async () => {
  bindChrome();
  await loadCalendars();
  await loadEventsForCursor();
  render();
  scrollToWorkingHour();
});

function bindChrome() {
  $$('.seg-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      state.view = btn.dataset.view;
      state.draft = null;
      state.selectedEvent = null;
      $$('.seg-btn').forEach(item => item.classList.toggle('active', item === btn));
      await loadEventsForCursor();
      render();
      scrollToWorkingHour();
    });
  });

  $('prevBtn').onclick = () => shiftCursor(-1);
  $('nextBtn').onclick = () => shiftCursor(1);
  $('todayBtn').onclick = async () => {
    state.cursor = new Date(state.today);
    await loadEventsForCursor();
    render();
    scrollToWorkingHour();
  };
  $('quickAddBtn').onclick = () => openQuickDraft();
  $('sidebarAddBtn').onclick = () => openQuickDraft();
  $('sidebarCollapseBtn').onclick = () => {
    $('sidebar').classList.toggle('collapsed');
  };

  $('syncBtn').onclick = async () => {
    const btn = $('syncBtn');
    btn.classList.add('syncing');
    setSyncStatus('busy', '同步中…');
    try {
      await api('POST', '/api/sync');
      await new Promise(resolve => setTimeout(resolve, 900));
      await loadEventsForCursor(true);
      render();
      setSyncStatus('ok', '已同步');
      toast('同步完成');
    } catch (err) {
      setSyncStatus('error', '同步失败');
      toast('同步失败，请确认 Outlook 正在运行');
    } finally {
      btn.classList.remove('syncing');
    }
  };

  $('sidebarMenuBtn').onclick = event => {
    const menu = $('sidebarMenu');
    const rect = event.currentTarget.getBoundingClientRect();
    menu.style.left = `${rect.left + rect.width / 2 - 7}px`;
    menu.style.top = `${rect.bottom + 8}px`;
    menu.style.transformOrigin = '7px 0';
    menu.classList.toggle('open');
  };

  $('gotoDateBtn').onclick = event => {
    event.stopPropagation();
    $('sidebarMenu').classList.remove('open');
    openGotoDateModal();
  };
  $('gotoDateClose').onclick = closeGotoDateModal;
  $('gotoDateModal').onclick = event => {
    if (event.target === $('gotoDateModal')) closeGotoDateModal();
  };
  $('gotoPrevMonth').onclick = () => {
    state.gotoCursor.setMonth(state.gotoCursor.getMonth() - 1);
    renderGotoCalendar();
  };
  $('gotoNextMonth').onclick = () => {
    state.gotoCursor.setMonth(state.gotoCursor.getMonth() + 1);
    renderGotoCalendar();
  };
  $('gotoDateInput').oninput = event => {
    const date = parseDateInput(event.target.value);
    if (!date) return;
    state.gotoSelected = date;
    state.gotoCursor = new Date(date);
    renderGotoCalendar();
  };
  $('gotoConfirm').onclick = jumpToGotoDate;

  document.addEventListener('mousedown', event => {
    if (!event.target.closest('.popover') && !event.target.closest('.context-menu') && !event.target.closest('.goto-dialog') && !event.target.closest('.time-event') && !event.target.closest('.month-event')) {
      closePopover();
      $('sidebarMenu').classList.remove('open');
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closePopover();
      closeGotoDateModal();
      $('sidebarMenu').classList.remove('open');
    }
    if (event.key === 'Enter' && $('gotoDateModal').classList.contains('open')) {
      jumpToGotoDate();
    }
  });

  window.addEventListener('resize', () => {
    if (state.view !== 'month') renderNowLine();
  });
}

async function shiftCursor(direction) {
  const next = new Date(state.cursor);
  if (state.view === 'month') next.setMonth(next.getMonth() + direction);
  if (state.view === 'week') next.setDate(next.getDate() + direction * 7);
  if (state.view === 'day') next.setDate(next.getDate() + direction);
  state.cursor = next;
  state.draft = null;
  state.selectedEvent = null;
  await loadEventsForCursor();
  render();
  scrollToWorkingHour();
}

function render() {
  updatePeriodTitle();
  renderSidebar();
  $$('.calendar-view').forEach(view => view.classList.remove('active'));
  $(`${state.view}View`).classList.add('active');

  if (state.view === 'day') renderDay();
  if (state.view === 'week') renderWeek();
  if (state.view === 'month') renderMonth();
}

function updatePeriodTitle() {
  const months = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
  const month = months[state.cursor.getMonth()];
  $('periodTitle').innerHTML = `${state.cursor.getFullYear()}年 <strong>${month}</strong>`;
}

function renderSidebar() {
  const list = $('calendarList');
  list.innerHTML = '';
  state.calendars.forEach(calendar => {
    const hidden = !state.visibleCalendars.has(calendar.id);
    const li = document.createElement('li');
    li.className = `calendar-item ${calendarKind(calendar)} ${hidden ? 'hidden' : 'active'}`;
    li.innerHTML = `
      <span class="cal-check" style="background:${calendar.color}">✓</span>
      <span>${displayCalendarName(calendar)}</span>
    `;
    li.onclick = () => {
      if (state.visibleCalendars.has(calendar.id)) state.visibleCalendars.delete(calendar.id);
      else state.visibleCalendars.add(calendar.id);
      render();
    };
    list.appendChild(li);
  });
}

function renderDay() {
  const date = new Date(state.cursor);
  const dateStr = fmtDate(date);
  const weekNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  $('dayTitle').innerHTML = `
    <span class="big-date">${date.getDate()}</span>
    <span class="weekday">${weekNames[date.getDay()]}</span>
  `;

  renderTimeGutter('dayGutter');
  const lane = $('dayLane');
  lane.innerHTML = '';
  addHourLines(lane);
  eventsOn(dateStr).filter(event => !event.all_day).forEach(event => {
    lane.appendChild(makeTimeEvent(event, 0, 100));
  });
  bindDragCreate(lane, dateStr, 'day');
  renderNowLine();
  renderRightPanel();
}

function renderWeek() {
  const start = weekStart(state.cursor);
  const weekHead = $('weekHead');
  const weekGrid = $('weekGrid');
  weekHead.innerHTML = '';
  weekGrid.innerHTML = '';
  renderTimeGutter('weekGutter');

  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  for (let index = 0; index < 7; index++) {
    const date = addDays(start, index);
    const dateStr = fmtDate(date);
    const head = document.createElement('div');
    head.className = `week-day ${dateStr === fmtDate(state.today) ? 'today' : ''}`;
    head.innerHTML = `<span class="num">${date.getDate()}日</span><span>${names[date.getDay()]}</span>`;
    head.ondblclick = () => {
      state.cursor = new Date(date);
      state.view = 'day';
      $$('.seg-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === 'day'));
      render();
      scrollToWorkingHour();
    };
    weekHead.appendChild(head);

    const col = document.createElement('div');
    col.className = 'week-col';
    col.dataset.date = dateStr;
    addHourLines(col);
    layoutEvents(eventsOn(dateStr).filter(event => !event.all_day)).forEach(({ event, left, width }) => {
      col.appendChild(makeTimeEvent(event, left, width));
    });
    bindDragCreate(col, dateStr, 'week');
    weekGrid.appendChild(col);
  }
  renderNowLine();
}

function renderMonth() {
  const grid = $('monthGrid');
  grid.innerHTML = '';
  const monthStart = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
  const gridStart = addDays(monthStart, -monthStart.getDay());

  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    const dateStr = fmtDate(date);
    const cell = document.createElement('div');
    cell.className = `month-cell ${date.getMonth() !== state.cursor.getMonth() ? 'other' : ''}`;
    cell.dataset.date = dateStr;
    cell.innerHTML = `<div class="month-date ${dateStr === fmtDate(state.today) ? 'today' : ''}">${date.getDate()}日</div>`;
    eventsOn(dateStr).slice(0, 7).forEach(event => cell.appendChild(makeMonthEvent(event)));
    cell.ondblclick = event => {
      if (event.target.closest('.month-event')) return;
      const draft = makeDraft(`${dateStr}T09:00:00`, `${dateStr}T10:00:00`);
      openPopover(event, draft);
    };
    grid.appendChild(cell);
  }
}

function renderRightPanel() {
  const panel = $('rightPanel');
  const mini = miniCalendarHtml(state.cursor);
  if (state.draft) {
    panel.innerHTML = mini + eventFormHtml(
      state.draft,
      state.draft._editing ? '编辑日程' : '添加日程',
      state.draft._editing ? '保存' : '添加',
      'panel'
    );
    bindEventForm('panel', state.draft);
    return;
  }
  if (state.selectedEvent) {
    panel.innerHTML = mini + eventDetailHtml(state.selectedEvent, true);
    bindDetailActions(panel, state.selectedEvent);
    return;
  }
  panel.innerHTML = mini + `<div class="panel-empty">未选定日程</div>`;
}

function miniCalendarHtml(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  let days = '';
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    const dateStr = fmtDate(date);
    days += `<span class="mini-day ${date.getMonth() !== cursor.getMonth() ? 'other' : ''} ${dateStr === fmtDate(state.today) ? 'today' : ''} ${eventsOn(dateStr).length ? 'has-event' : ''}" data-date="${dateStr}">${date.getDate()}</span>`;
  }
  return `
    <div class="mini-panel">
      <div class="mini-grid">
        <span class="mini-dow">日</span><span class="mini-dow">一</span><span class="mini-dow">二</span><span class="mini-dow">三</span><span class="mini-dow">四</span><span class="mini-dow">五</span><span class="mini-dow">六</span>
        ${days}
      </div>
    </div>
  `;
}

function makeTimeEvent(event, leftPct, widthPct) {
  const start = minutesOf(event.start_time);
  const end = Math.max(minutesOf(event.end_time), start + 30);
  const color = calendarColor(event);
  const el = document.createElement('div');
  el.className = 'time-event';
  el.style.top = `${start / 60 * HOUR_HEIGHT}px`;
  el.style.height = `${Math.max((end - start) / 60 * HOUR_HEIGHT - 2, 24)}px`;
  el.style.left = `calc(${leftPct}% + 2px)`;
  el.style.width = `calc(${widthPct}% - 4px)`;
  el.style.background = colorBg(color, .26);
  el.style.borderLeftColor = color;
  el.style.color = color === COLORS.personal ? '#dff4ff' : '#f6d8ff';
  el.innerHTML = `
    <div class="title">${esc(event.title || '新建日程')}</div>
    <div class="meta">${event.location || formatTimeRange(event)}</div>
  `;
  el.onclick = eventObject => {
    eventObject.stopPropagation();
    state.selectedEvent = event;
    state.draft = null;
    if (state.view === 'day') renderRightPanel();
    else openPopover(eventObject, event);
  };
  return el;
}

function makeMonthEvent(event) {
  const color = calendarColor(event);
  const item = document.createElement('div');
  item.className = 'month-event';
  item.innerHTML = `
    <span class="dot" style="background:${color}"></span>
    <span class="text">${esc(event.title || '新建日程')}</span>
    <span class="time">${formatMonthTime(event)}</span>
  `;
  item.ondblclick = domEvent => {
    domEvent.stopPropagation();
    openPopover(domEvent, event);
  };
  item.onclick = domEvent => {
    domEvent.stopPropagation();
    state.selectedEvent = event;
  };
  return item;
}

function renderTimeGutter(id) {
  const gutter = $(id);
  gutter.innerHTML = '';
  for (let hour = 1; hour < 24; hour++) {
    const label = document.createElement('div');
    label.className = 'time-label';
    label.style.top = `${hour * HOUR_HEIGHT}px`;
    label.textContent = zhHour(hour);
    gutter.appendChild(label);
  }
}

function addHourLines(container) {
  for (let hour = 0; hour <= 24; hour++) {
    const line = document.createElement('div');
    line.className = 'hour-line';
    line.style.top = `${hour * HOUR_HEIGHT}px`;
    container.appendChild(line);
  }
}

function bindDragCreate(lane, dateStr, mode) {
  lane.onmousedown = event => {
    if (event.button !== 0 || event.target.closest('.time-event')) return;
    event.preventDefault();
    closePopover();
    const rect = lane.getBoundingClientRect();
    const startMin = clamp(snapMinutes((event.clientY - rect.top) / HOUR_HEIGHT * 60), 0, 24 * 60 - 15);
    const selection = document.createElement('div');
    selection.className = 'drag-selection';
    selection.textContent = '新建日程';
    lane.appendChild(selection);

    const paint = currentY => {
      const currentMin = clamp(snapMinutes((currentY - rect.top) / HOUR_HEIGHT * 60), 0, 24 * 60);
      const top = Math.min(startMin, currentMin);
      const bottom = Math.max(startMin + 30, currentMin);
      selection.style.top = `${top / 60 * HOUR_HEIGHT}px`;
      selection.style.height = `${Math.max((bottom - top) / 60 * HOUR_HEIGHT, 30)}px`;
      selection.dataset.start = `${dateStr}T${minsToTime(top)}:00`;
      selection.dataset.end = `${dateStr}T${minsToTime(bottom)}:00`;
    };

    paint(event.clientY + HOUR_HEIGHT);
    const move = moveEvent => paint(moveEvent.clientY);
    const up = upEvent => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      const draft = makeDraft(selection.dataset.start, selection.dataset.end);
      selection.remove();
      state.draft = draft;
      state.selectedEvent = null;
      if (mode === 'day') renderRightPanel();
      else openPopover(upEvent, draft);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
}

function renderNowLine() {
  $$('.now-line').forEach(line => line.remove());
  const now = new Date();
  const todayStr = fmtDate(now);
  const top = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT;

  if (state.view === 'day' && fmtDate(state.cursor) === todayStr) {
    const line = document.createElement('div');
    line.className = 'now-line';
    line.style.top = `${top}px`;
    line.innerHTML = `<span>${formatClock(now)}</span>`;
    $('dayLane').appendChild(line);
  }

  if (state.view === 'week') {
    const start = weekStart(state.cursor);
    const index = Math.floor((dateOnly(now) - dateOnly(start)) / 86400000);
    const col = $('weekGrid').children[index];
    if (col) {
      const line = document.createElement('div');
      line.className = 'now-line';
      line.style.top = `${top}px`;
      if (index === 0) line.innerHTML = `<span>${formatClock(now)}</span>`;
      col.appendChild(line);
    }
  }
}

function openQuickDraft() {
  const date = fmtDate(state.cursor);
  const startHour = Math.max(9, new Date().getHours() + 1);
  const draft = makeDraft(`${date}T${String(startHour).padStart(2, '0')}:00:00`, `${date}T${String(startHour + 1).padStart(2, '0')}:00:00`);
  state.draft = draft;
  state.selectedEvent = null;
  if (state.view === 'day') {
    renderRightPanel();
  } else {
    const rect = $('quickAddBtn').getBoundingClientRect();
    openPopover({ clientX: rect.left - 180, clientY: rect.bottom + 10, stopPropagation() {} }, draft);
  }
}

function openPopover(domEvent, payload) {
  domEvent.stopPropagation?.();
  const popover = $('eventPopover');
  const isEditing = Boolean(payload._editing);
  const isExisting = Boolean(payload.id) && !isEditing;
  popover.innerHTML = isExisting
    ? eventDetailHtml(payload, false)
    : eventFormHtml(payload, isEditing ? '编辑日程' : '添加日程', isEditing ? '保存' : '添加', 'popover');
  popover.classList.add('open');
  positionPopover(popover, domEvent.clientX, domEvent.clientY);
  if (isExisting) bindDetailActions(popover, payload);
  else bindEventForm('popover', payload);
}

function positionPopover(popover, x, y) {
  const width = 460;
  const height = Math.min(760, window.innerHeight - 60);
  let left = x - width - 18;
  let top = y - 90;
  if (left < 280) left = Math.min(window.innerWidth - width - 18, x + 18);
  if (top + height > window.innerHeight - 18) top = window.innerHeight - height - 18;
  if (top < 52) top = 52;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function closePopover() {
  $('eventPopover').classList.remove('open');
}

function openGotoDateModal() {
  state.gotoSelected = new Date(state.cursor);
  state.gotoCursor = new Date(state.cursor);
  $('gotoDateInput').value = formatGotoInput(state.gotoSelected);
  renderGotoCalendar();
  $('gotoDateModal').classList.add('open');
  setTimeout(() => $('gotoDateInput').focus(), 120);
}

function closeGotoDateModal() {
  $('gotoDateModal').classList.remove('open');
}

function renderGotoCalendar() {
  const cursor = state.gotoCursor;
  $('gotoMonthTitle').textContent = `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`;

  const grid = $('gotoGrid');
  grid.innerHTML = '';
  ['一', '二', '三', '四', '五', '六', '日'].forEach(day => {
    const cell = document.createElement('span');
    cell.className = 'goto-dow';
    cell.textContent = day;
    grid.appendChild(cell);
  });

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const mondayIndex = (first.getDay() + 6) % 7;
  const start = addDays(first, -mondayIndex);

  for (let index = 0; index < 42; index++) {
    const date = addDays(start, index);
    const dateStr = fmtDate(date);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = [
      'goto-day',
      date.getMonth() !== cursor.getMonth() ? 'other' : '',
      dateStr === fmtDate(state.today) ? 'today' : '',
      dateStr === fmtDate(state.gotoSelected) ? 'selected' : '',
    ].filter(Boolean).join(' ');
    button.textContent = date.getDate();
    button.onclick = () => {
      state.gotoSelected = new Date(date);
      $('gotoDateInput').value = formatGotoInput(date);
      renderGotoCalendar();
    };
    button.ondblclick = jumpToGotoDate;
    grid.appendChild(button);
  }
}

async function jumpToGotoDate() {
  const typed = parseDateInput($('gotoDateInput').value);
  if (typed) state.gotoSelected = typed;
  state.cursor = new Date(state.gotoSelected);
  closeGotoDateModal();
  await loadEventsForCursor(true);
  render();
  scrollToWorkingHour();
}

function eventDetailHtml(event, inPanel) {
  const color = calendarColor(event);
  return `
    <div class="detail-panel">
      <h2>编辑日程</h2>
      <div class="detail-card" style="border-left-color:${color}">
        <div class="title">${esc(event.title)}</div>
        <div class="line">${formatDateLine(event)}</div>
        ${event.location ? `<div class="line">${esc(event.location)}</div>` : ''}
        ${event.description ? `<div class="line">${esc(event.description)}</div>` : ''}
        <div class="line">日历　${esc(displayCalendarName(calendarOf(event)))} <span class="cal-dot" style="background:${color}"></span></div>
      </div>
      <div class="detail-actions">
        <button class="btn danger" data-action="delete">删除</button>
        <button class="btn" data-action="edit">编辑</button>
        ${inPanel ? '' : '<button class="btn" data-action="close">关闭</button>'}
      </div>
    </div>
  `;
}

function eventFormHtml(event, title, actionText, prefix) {
  const calendarId = event.calendar_id || state.defaultCalendarId || state.calendars[0]?.id || '';
  const calendar = state.calendars.find(item => item.id === calendarId) || state.calendars[0] || {};
  return `
    <form class="event-form" id="${prefix}EventForm">
      <h2>${title}</h2>
      <input class="field title" id="${prefix}Title" value="${escAttr(event.title || '新建日程')}" placeholder="新建日程">
      <input class="field" id="${prefix}Location" value="${escAttr(event.location || '')}" placeholder="位置或视频通话">
      <div class="form-row">
        <span>日历</span>
        <span class="value">
          <select class="field" id="${prefix}Calendar">
            ${state.calendars.map(item => `<option value="${escAttr(item.id)}" ${item.id === calendarId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}
          </select>
          <span class="cal-dot" style="background:${calendar.color || COLORS.work}"></span>
        </span>
      </div>
      <div class="form-row"><span>全天</span><span class="value"><span class="switch"></span></span></div>
      <div class="form-row inline">
        <span>开始</span>
        <input class="field" type="date" id="${prefix}StartDate" value="${event.start_time.slice(0, 10)}">
        <input class="field" type="time" id="${prefix}StartTime" value="${event.start_time.slice(11, 16)}">
      </div>
      <div class="form-row inline">
        <span>结束</span>
        <input class="field" type="date" id="${prefix}EndDate" value="${event.end_time.slice(0, 10)}">
        <input class="field" type="time" id="${prefix}EndTime" value="${event.end_time.slice(11, 16)}">
      </div>
      <div class="form-row"><span>重复</span><span class="value">永不⌄</span></div>
      <div class="form-row"><span>提醒</span><span class="value">无⌄</span></div>
      <div class="form-row"><span>受邀人</span><span class="value" style="color:var(--red)">＋</span></div>
      <div class="form-row"><span>附件</span><span class="value" style="color:var(--red)">＋</span></div>
      <input class="field" id="${prefix}Url" placeholder="URL">
      <textarea class="field" id="${prefix}Description" rows="2" placeholder="备注">${esc(event.description || '')}</textarea>
      <div class="form-actions">
        <button class="btn" type="button" data-action="cancel">取消</button>
        <button class="btn primary" type="submit">${actionText}</button>
      </div>
    </form>
  `;
}

function bindEventForm(prefix, baseEvent) {
  const form = $(`${prefix}EventForm`);
  if (!form) return;
  const cancel = form.querySelector('[data-action="cancel"]');
  cancel.onclick = () => {
    state.draft = null;
    if (prefix === 'panel') renderRightPanel();
    else closePopover();
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const payload = readEventForm(prefix, baseEvent);
    if (!payload.title.trim()) {
      toast('日程标题不能为空');
      return;
    }
    try {
      if (baseEvent.id) {
        await api('PATCH', `/api/events/${encodeURIComponent(baseEvent.id)}`, payload);
        state.events = state.events.map(item => item.id === baseEvent.id ? { ...item, ...payload } : item);
        state.selectedEvent = state.events.find(item => item.id === baseEvent.id) || null;
        toast('日程已保存');
      } else {
        const response = await api('POST', '/api/events', payload);
        state.events.push({ ...payload, id: response.id });
        state.selectedEvent = state.events[state.events.length - 1];
        toast('日程已添加');
      }
      state.draft = null;
      closePopover();
      render();
    } catch (err) {
      toast(baseEvent.id ? '保存失败，请检查 Outlook' : '添加失败，请检查 Outlook');
    }
  };
}

function readEventForm(prefix, baseEvent) {
  const startDate = $(`${prefix}StartDate`).value;
  const startTime = $(`${prefix}StartTime`).value || '09:00';
  const endDate = $(`${prefix}EndDate`).value;
  const endTime = $(`${prefix}EndTime`).value || '10:00';
  const calendarId = $(`${prefix}Calendar`).value;
  return {
    title: $(`${prefix}Title`).value || '新建日程',
    location: $(`${prefix}Location`).value || '',
    description: $(`${prefix}Description`).value || '',
    start_time: `${startDate}T${startTime}:00`,
    end_time: `${endDate}T${endTime}:00`,
    all_day: false,
    calendar_id: calendarId,
    color: state.calendars.find(item => item.id === calendarId)?.color || baseEvent.color || COLORS.work,
    source: 'outlook',
  };
}

function bindDetailActions(container, event) {
  const close = container.querySelector('[data-action="close"]');
  const edit = container.querySelector('[data-action="edit"]');
  const del = container.querySelector('[data-action="delete"]');
  if (close) close.onclick = closePopover;
  if (edit) {
    edit.onclick = domEvent => {
      if (state.view === 'day' && container.id === 'rightPanel') {
        state.draft = { ...event, _editing: true };
        state.selectedEvent = null;
        renderRightPanel();
      } else {
        openPopover(domEvent, { ...event, _editing: true });
      }
    };
  }
  if (del) {
    del.onclick = async () => {
      if (!confirm(`删除「${event.title}」？`)) return;
      try {
        await api('DELETE', `/api/events/${encodeURIComponent(event.id)}`);
        state.events = state.events.filter(item => item.id !== event.id);
        state.selectedEvent = null;
        closePopover();
        render();
        toast('日程已删除');
      } catch (err) {
        toast('删除失败');
      }
    };
  }
}

function makeDraft(start, end) {
  const calendar = state.calendars.find(item => item.id === state.defaultCalendarId) || state.calendars[0] || {};
  return {
    title: '新建日程',
    location: '',
    description: '',
    start_time: start,
    end_time: end,
    calendar_id: calendar.id || '',
    color: calendar.color || COLORS.work,
    all_day: false,
  };
}

function layoutEvents(events) {
  const sorted = [...events].sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time));
  const columns = [];
  const placed = [];
  sorted.forEach(event => {
    const start = minutesOf(event.start_time);
    const end = Math.max(minutesOf(event.end_time), start + 30);
    let column = columns.findIndex(value => value <= start);
    if (column === -1) {
      column = columns.length;
      columns.push(end);
    } else {
      columns[column] = end;
    }
    placed.push({ event, column });
  });
  const count = Math.max(columns.length, 1);
  return placed.map(item => ({
    event: item.event,
    left: item.column / count * 100,
    width: 100 / count,
  }));
}

function filteredEvents() {
  return state.events.filter(event => !event.calendar_id || state.visibleCalendars.has(event.calendar_id));
}

function eventsOn(dateStr) {
  return filteredEvents()
    .filter(event => String(event.start_time || '').startsWith(dateStr))
    .sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time));
}

async function loadCalendars() {
  try {
    const calendars = await api('GET', '/api/calendars');
    state.calendars = calendars.map(calendar => {
      const kind = calendarKind(calendar);
      return {
        ...calendar,
        color: kind === 'personal' ? COLORS.personal : kind === 'work' ? COLORS.work : (calendar.color || COLORS.work),
      };
    });
  } catch (err) {
    state.calendars = [];
  }

  if (!state.calendars.length) {
    state.calendars = [
      { id: 'personal', name: '个人', color: COLORS.personal },
      { id: 'work', name: '工作', color: COLORS.work },
    ];
  }
  state.visibleCalendars = new Set(state.calendars.map(calendar => calendar.id));
  state.defaultCalendarId = state.calendars.find(calendar => calendarKind(calendar) === 'work')?.id || state.calendars[0]?.id || '';
}

async function loadEventsForCursor(force = false) {
  const range = visibleRange();
  const key = `${range.start}|${range.end}`;
  if (!force && state.loadedRange === key) return;
  try {
    state.events = await api('GET', `/api/events?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`);
    state.loadedRange = key;
  } catch (err) {
    state.events = [];
  }
}

function visibleRange() {
  const cursor = state.cursor;
  const start = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
  const end = new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0, 23, 59, 59);
  return {
    start: `${fmtDate(start)}T00:00:00`,
    end: `${fmtDate(end)}T23:59:59`,
  };
}

async function api(method, path, body) {
  const response = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function setSyncStatus(kind, text) {
  const status = $('syncStatus');
  status.innerHTML = `<span class="sync-dot ${kind === 'busy' ? 'busy' : kind === 'error' ? 'error' : ''}"></span><span>${text}</span>`;
}

function scrollToWorkingHour() {
  setTimeout(() => {
    const target = Math.max((new Date().getHours() - 2) * HOUR_HEIGHT, 7 * HOUR_HEIGHT);
    const scroll = state.view === 'day' ? $('dayScroll') : state.view === 'week' ? $('weekScroll') : null;
    if (scroll) scroll.scrollTop = target;
  }, 50);
}

function calendarKind(calendar) {
  const name = `${calendar?.name || ''}`.toLowerCase();
  if (name.includes('个人') || name.includes('personal')) return 'personal';
  if (name.includes('工作') || name.includes('work') || name.includes('icloud')) return 'work';
  return 'work';
}

function calendarOf(event) {
  return state.calendars.find(calendar => calendar.id === event.calendar_id) || state.calendars[0] || {};
}

function calendarColor(event) {
  return calendarOf(event).color || event.color || COLORS.work;
}

function displayCalendarName(calendar) {
  if (!calendar) return '工作';
  const name = calendar.name || '';
  if (name.includes('个人')) return '个人';
  if (name.includes('工作')) return '工作';
  return name.replace(/\s*\(.*?\)\s*/g, '') || '工作';
}

function colorBg(hex, alpha) {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function formatMonthTime(event) {
  const minutes = minutesOf(event.start_time);
  if (event.all_day) return '';
  if (minutes % 60 === 0) return `${Math.floor(minutes / 60)}时`;
  return event.start_time.slice(11, 16);
}

function formatTimeRange(event) {
  return `${event.start_time.slice(11, 16)} – ${event.end_time.slice(11, 16)}`;
}

function formatDateLine(event) {
  const start = new Date(event.start_time);
  const end = new Date(event.end_time);
  return `${start.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', year: 'numeric' })}　${event.start_time.slice(11, 16)} – ${event.end_time.slice(11, 16)}`;
}

function zhHour(hour) {
  if (hour < 12) return `上午${hour}时`;
  if (hour === 12) return '正午';
  return `下午${hour - 12}时`;
}

function formatClock(date) {
  const prefix = date.getHours() < 12 ? '上午' : '下午';
  const hour = date.getHours() % 12 || 12;
  return `${prefix}${hour}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function minutesOf(iso) {
  if (!iso || iso.length < 16) return 0;
  const [hour, minute] = iso.slice(11, 16).split(':').map(Number);
  return hour * 60 + minute;
}

function minsToTime(minutes) {
  const safe = clamp(minutes, 0, 24 * 60);
  const hour = Math.floor(safe / 60) % 24;
  const minute = safe % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function snapMinutes(minutes) {
  return Math.round(minutes / 15) * 15;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function fmtDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateInput(value) {
  if (!value) return null;
  const text = value.trim();
  let year;
  let month;
  let day;

  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
    if (!match) return null;
    month = Number(match[1]);
    day = Number(match[2]);
    year = Number(match[3]);
  }

  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function formatGotoInput(date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}

function weekStart(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function dateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(value) {
  return esc(value).replace(/'/g, '&#39;');
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

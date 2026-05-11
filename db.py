import sqlite3
import json
from datetime import datetime

DB_PATH = "calendar.db"

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_conn()
    c = conn.cursor()

    # 日历事件表
    c.execute('''
        CREATE TABLE IF NOT EXISTS events (
            id          TEXT PRIMARY KEY,
            calendar_id TEXT,
            title       TEXT NOT NULL,
            description TEXT,
            location    TEXT,
            start_time  TEXT NOT NULL,
            end_time    TEXT NOT NULL,
            all_day     INTEGER DEFAULT 0,
            recurrence  TEXT,
            color       TEXT,
            source      TEXT DEFAULT 'icloud',
            raw_ical    TEXT,
            updated_at  TEXT
        )
    ''')

    # 提醒事项表
    c.execute('''
        CREATE TABLE IF NOT EXISTS reminders (
            id          TEXT PRIMARY KEY,
            list_id     TEXT,
            title       TEXT NOT NULL,
            notes       TEXT,
            due_date    TEXT,
            completed   INTEGER DEFAULT 0,
            completed_at TEXT,
            priority    INTEGER DEFAULT 0,
            recurrence  TEXT,
            source      TEXT DEFAULT 'icloud',
            raw_ical    TEXT,
            updated_at  TEXT
        )
    ''')

    # 日历列表表（对应苹果的「日历」分组）
    c.execute('''
        CREATE TABLE IF NOT EXISTS calendars (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            color       TEXT,
            type        TEXT DEFAULT 'event',
            source      TEXT DEFAULT 'icloud'
        )
    ''')

    # 提醒列表表（对应苹果的「提醒事项」分组）
    c.execute('''
        CREATE TABLE IF NOT EXISTS reminder_lists (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            color       TEXT,
            source      TEXT DEFAULT 'icloud'
        )
    ''')

    conn.commit()
    conn.close()
    print("[DB] 数据库初始化完成")

# ─── Events ───────────────────────────────────────────

def _dt_key(value: str) -> str:
    """把不同来源的时间字符串规整成本地 ISO 字符串，用于稳定比较。"""
    if not value:
        return ''
    text = str(value).strip()
    if not text:
        return ''

    iso = text.replace(' ', 'T')
    if iso.endswith('Z'):
        iso = iso[:-1] + '+00:00'
    try:
        parsed = datetime.fromisoformat(iso)
        return parsed.replace(tzinfo=None, microsecond=0).isoformat()
    except Exception:
        pass

    for fmt in (
        '%Y-%m-%d %H:%M:%S',
        '%Y/%m/%d %H:%M:%S',
        '%m/%d/%Y %H:%M:%S',
        '%m/%d/%Y %I:%M:%S %p',
        '%Y-%m-%dT%H:%M:%S',
    ):
        try:
            return datetime.strptime(text, fmt).replace(microsecond=0).isoformat()
        except Exception:
            continue

    return iso[:19]

def upsert_event(event: dict):
    conn = get_conn()
    conn.execute('''
        INSERT INTO events (id, calendar_id, title, description, location,
            start_time, end_time, all_day, recurrence, color, source, raw_ical, updated_at)
        VALUES (:id, :calendar_id, :title, :description, :location,
            :start_time, :end_time, :all_day, :recurrence, :color, :source, :raw_ical, :updated_at)
        ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, description=excluded.description,
            location=excluded.location, start_time=excluded.start_time,
            end_time=excluded.end_time, all_day=excluded.all_day,
            recurrence=excluded.recurrence, color=excluded.color,
            raw_ical=excluded.raw_ical, updated_at=excluded.updated_at
    ''', event)
    conn.commit()
    conn.close()

def get_events(start: str, end: str):
    conn = get_conn()
    rows = conn.execute('SELECT * FROM events').fetchall()
    conn.close()

    start_key = _dt_key(start)
    end_key = _dt_key(end)
    events = []
    for row in rows:
        event = dict(row)
        event_key = _dt_key(event.get('start_time', ''))
        if start_key and event_key < start_key:
            continue
        if end_key and event_key > end_key:
            continue
        event['start_time'] = event_key
        event['end_time'] = _dt_key(event.get('end_time', ''))
        events.append(event)

    return sorted(events, key=lambda e: e.get('start_time') or '')

def delete_event(event_id: str):
    conn = get_conn()
    conn.execute('DELETE FROM events WHERE id = ?', (event_id,))
    conn.commit()
    conn.close()

def clear_events(source: str = None):
    conn = get_conn()
    if source:
        conn.execute('DELETE FROM events WHERE source = ?', (source,))
    else:
        conn.execute('DELETE FROM events')
    conn.commit()
    conn.close()

# ─── Reminders ────────────────────────────────────────

def upsert_reminder(reminder: dict):
    conn = get_conn()
    conn.execute('''
        INSERT INTO reminders (id, list_id, title, notes, due_date,
            completed, completed_at, priority, recurrence, source, raw_ical, updated_at)
        VALUES (:id, :list_id, :title, :notes, :due_date,
            :completed, :completed_at, :priority, :recurrence, :source, :raw_ical, :updated_at)
        ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, notes=excluded.notes,
            due_date=excluded.due_date, completed=excluded.completed,
            completed_at=excluded.completed_at, priority=excluded.priority,
            recurrence=excluded.recurrence, raw_ical=excluded.raw_ical,
            updated_at=excluded.updated_at
    ''', reminder)
    conn.commit()
    conn.close()

def get_reminders(list_id: str = None, include_completed: bool = False):
    conn = get_conn()
    query = 'SELECT * FROM reminders WHERE 1=1'
    params = []
    if list_id:
        query += ' AND list_id = ?'
        params.append(list_id)
    if not include_completed:
        query += ' AND completed = 0'
    query += ' ORDER BY due_date ASC, priority DESC'
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def complete_reminder(reminder_id: str, done: bool = True):
    conn = get_conn()
    conn.execute('''
        UPDATE reminders SET completed = ?, completed_at = ?
        WHERE id = ?
    ''', (1 if done else 0, datetime.now().isoformat() if done else None, reminder_id))
    conn.commit()
    conn.close()

def delete_reminder(reminder_id: str):
    conn = get_conn()
    conn.execute('DELETE FROM reminders WHERE id = ?', (reminder_id,))
    conn.commit()
    conn.close()

# ─── Calendars & Lists ────────────────────────────────

def upsert_calendar(cal: dict):
    conn = get_conn()
    conn.execute('''
        INSERT INTO calendars (id, name, color, type, source)
        VALUES (:id, :name, :color, :type, :source)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, color=excluded.color
    ''', cal)
    conn.commit()
    conn.close()

def get_calendars():
    conn = get_conn()
    rows = conn.execute('SELECT * FROM calendars ORDER BY name').fetchall()
    conn.close()
    return [dict(r) for r in rows]

def upsert_reminder_list(lst: dict):
    conn = get_conn()
    conn.execute('''
        INSERT INTO reminder_lists (id, name, color, source)
        VALUES (:id, :name, :color, :source)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, color=excluded.color
    ''', lst)
    conn.commit()
    conn.close()

def get_reminder_lists():
    conn = get_conn()
    rows = conn.execute('SELECT * FROM reminder_lists ORDER BY name').fetchall()
    conn.close()
    return [dict(r) for r in rows]

if __name__ == '__main__':
    init_db()

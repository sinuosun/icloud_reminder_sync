# Flask 后端入口，提供 API 接口给前端调用

import json
from datetime import datetime, timedelta
from flask import Flask, jsonify, request, render_template
from db import (init_db, get_events, get_reminders, get_calendars,
                get_reminder_lists, complete_reminder, delete_event,
                delete_reminder, upsert_event, upsert_reminder)
from ms_sync import (create_event, update_event, delete_event_remote,
                     create_reminder, complete_reminder_remote,
                     delete_reminder_remote, sync_all)
from scheduler import start as start_scheduler, trigger_now, status as scheduler_status
from notifier import start as start_notifier, notify_now

with open('config.json', encoding='utf-8') as f:
    config = json.load(f)

app = Flask(__name__)

# ─── 启动 ─────────────────────────────────────────────

@app.before_request
def _once():
    """只在第一次请求前执行初始化"""
    pass

def bootstrap():
    """应用启动时初始化"""
    init_db()
    sync_all()          # 启动时立即同步一次
    start_scheduler()   # 启动定时同步
    start_notifier()    # 启动通知服务
    print(f"[App] 启动完成，访问 http://localhost:{config['app']['port']}")

# ─── 页面 ─────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

# ─── 同步 API ─────────────────────────────────────────

@app.route('/api/sync', methods=['POST'])
def api_sync():
    trigger_now()
    return jsonify({'ok': True, 'message': '同步已触发'})

@app.route('/api/sync/status')
def api_sync_status():
    return jsonify(scheduler_status())

# ─── 日历 API ─────────────────────────────────────────

@app.route('/api/calendars')
def api_calendars():
    return jsonify(get_calendars())

@app.route('/api/events')
def api_events():
    # 默认返回当月前后3个月
    def _normalize_iso(value: str) -> str:
        if not value:
            return ''
        try:
            iso = value.strip()
            if iso.endswith('Z'):
                iso = iso[:-1] + '+00:00'
            dt = datetime.fromisoformat(iso)
            if dt.tzinfo is not None:
                local_tz = datetime.now().astimezone().tzinfo
                dt = dt.astimezone(local_tz).replace(tzinfo=None)
            return dt.replace(microsecond=0).isoformat()
        except Exception:
            return value

    start = _normalize_iso(request.args.get('start') or
        (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%dT00:00:00'))
    end   = _normalize_iso(request.args.get('end') or
        (datetime.now() + timedelta(days=90)).strftime('%Y-%m-%dT23:59:59'))
    return jsonify(get_events(start, end))

@app.route('/api/events', methods=['POST'])
def api_create_event():
    d = request.json
    try:
        entry_id = create_event(
            title=d['title'],
            start=d['start_time'],
            end=d['end_time'],
            description=d.get('description', ''),
            location=d.get('location', ''),
            all_day=d.get('all_day', False),
            calendar_id=d.get('calendar_id')
        )
        # 立即写入本地DB
        upsert_event({
            'id':          entry_id,
            'calendar_id': d.get('calendar_id', ''),
            'title':       d['title'],
            'description': d.get('description', ''),
            'location':    d.get('location', ''),
            'start_time':  d['start_time'],
            'end_time':    d['end_time'],
            'all_day':     1 if d.get('all_day') else 0,
            'recurrence':  '',
            'color':       d.get('color', '#007AFF'),
            'source':      'outlook',
            'raw_ical':    '',
            'updated_at':  datetime.now().isoformat()
        })
        return jsonify({'ok': True, 'id': entry_id})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/events/<event_id>', methods=['PATCH'])
def api_update_event(event_id):
    d = request.json
    try:
        update_event(event_id, **d)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/events/<event_id>', methods=['DELETE'])
def api_delete_event(event_id):
    try:
        delete_event_remote(event_id)
        delete_event(event_id)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# ─── 提醒事项 API ─────────────────────────────────────

@app.route('/api/reminder-lists')
def api_reminder_lists():
    return jsonify(get_reminder_lists())

@app.route('/api/reminders')
def api_reminders():
    list_id          = request.args.get('list_id')
    include_done     = request.args.get('completed', 'false') == 'true'
    return jsonify(get_reminders(list_id=list_id, include_completed=include_done))

@app.route('/api/reminders', methods=['POST'])
def api_create_reminder():
    d = request.json
    try:
        entry_id = create_reminder(
            title=d['title'],
            due_date=d.get('due_date', ''),
            notes=d.get('notes', ''),
            priority=d.get('priority', 1)
        )
        upsert_reminder({
            'id':           entry_id,
            'list_id':      d.get('list_id', ''),
            'title':        d['title'],
            'notes':        d.get('notes', ''),
            'due_date':     d.get('due_date', ''),
            'completed':    0,
            'completed_at': '',
            'priority':     d.get('priority', 1),
            'recurrence':   '',
            'source':       'outlook',
            'raw_ical':     '',
            'updated_at':   datetime.now().isoformat()
        })
        return jsonify({'ok': True, 'id': entry_id})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/reminders/<reminder_id>/complete', methods=['POST'])
def api_complete_reminder(reminder_id):
    d    = request.json or {}
    done = d.get('completed', True)
    try:
        # 需要 list_id 才能调用远端，从DB取
        from db import get_conn
        conn = get_conn()
        row  = conn.execute('SELECT list_id FROM reminders WHERE id=?',
                            (reminder_id,)).fetchone()
        conn.close()
        if row:
            complete_reminder_remote(reminder_id, done)
        complete_reminder(reminder_id, done)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/reminders/<reminder_id>', methods=['DELETE'])
def api_delete_reminder(reminder_id):
    try:
        from db import get_conn
        conn = get_conn()
        row  = conn.execute('SELECT list_id FROM reminders WHERE id=?',
                            (reminder_id,)).fetchone()
        conn.close()
        if row:
            delete_reminder_remote(row['list_id'], reminder_id)
        delete_reminder(reminder_id)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# ─── 通知测试 ─────────────────────────────────────────

@app.route('/api/notify/test', methods=['POST'])
def api_notify_test():
    notify_now('🍎 测试通知', '苹果日历 Windows 版运行正常！')
    return jsonify({'ok': True})

# ─── 错误处理 ─────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': '接口不存在'}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': '服务器内部错误', 'detail': str(e)}), 500

# ─── 启动入口 ─────────────────────────────────────────

if __name__ == '__main__':
    bootstrap()
    app.run(
        host='127.0.0.1',
        port=config['app']['port'],
        debug=config['app']['debug'],
        use_reloader=False   # 关掉 reloader 防止 scheduler 启动两次
    )

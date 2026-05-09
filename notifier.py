# Windows 系统通知，提醒即将到来的日历事件和提醒事项

import json
import threading
import time
from datetime import datetime, timedelta
from db import get_events, get_reminders

with open('config.json', encoding='utf-8') as f:
    config = json.load(f)

NOTIFY_CFG = config['notifications']
REMIND_BEFORE = NOTIFY_CFG.get('remind_before_minutes', [10, 30])

# 已通知过的 id+时间点，避免重复弹
_notified = set()
_stop_event = threading.Event()

# ─── 通知后端（自动选择可用的）────────────────────────

def _send(title: str, message: str, icon='info'):
    """发送 Windows 通知，依次尝试可用库"""
    try:
        from winotify import Notification, audio
        toast = Notification(
            app_id="苹果日历",
            title=title,
            msg=message,
            duration="short"
        )
        toast.set_audio(audio.Default, loop=False)
        toast.show()
        return
    except ImportError:
        pass

    try:
        from win10toast import ToastNotifier
        ToastNotifier().show_toast(
            title, message,
            duration=6,
            threaded=True
        )
        return
    except ImportError:
        pass

    # 兜底：打印到控制台
    print(f"[通知] {title}: {message}")

# ─── 检查逻辑 ─────────────────────────────────────────

def _check_events():
    """检查即将开始的日历事件"""
    now = datetime.now()
    for minutes in REMIND_BEFORE:
        window_start = (now + timedelta(minutes=minutes - 1)).isoformat()
        window_end   = (now + timedelta(minutes=minutes + 1)).isoformat()
        events = get_events(window_start, window_end)
        for ev in events:
            key = f"event_{ev['id']}_{minutes}"
            if key in _notified:
                continue
            _notified.add(key)
            label = f"{minutes}分钟后" if minutes > 0 else "现在"
            detail = ev.get('location') or ev.get('description') or ''
            detail = detail[:40] + '...' if len(detail) > 40 else detail
            _send(
                title=f"📅 {label} · {ev['title']}",
                message=detail or f"开始时间：{ev['start_time'][11:16]}"
            )

def _check_reminders():
    """检查到期提醒事项"""
    now = datetime.now()
    for minutes in REMIND_BEFORE:
        window_start = (now + timedelta(minutes=minutes - 1)).isoformat()
        window_end   = (now + timedelta(minutes=minutes + 1)).isoformat()
        reminders = get_reminders(include_completed=False)
        for rm in reminders:
            if not rm.get('due_date'):
                continue
            due = rm['due_date'][:16]  # 只比较到分钟
            target = (now + timedelta(minutes=minutes)).strftime('%Y-%m-%dT%H:%M')
            if due != target:
                continue
            key = f"reminder_{rm['id']}_{minutes}"
            if key in _notified:
                continue
            _notified.add(key)
            label = f"{minutes}分钟后到期" if minutes > 0 else "现在到期"
            _send(
                title=f"🔔 {label} · {rm['title']}",
                message=rm.get('notes', '')[:60] or '点击查看详情'
            )

def _notify_loop():
    print("[Notifier] 通知服务启动")
    while not _stop_event.is_set():
        if NOTIFY_CFG.get('enabled', True):
            try:
                _check_events()
                _check_reminders()
            except Exception as e:
                print(f"[Notifier] 检查出错: {e}")
        # 每分钟检查一次
        for _ in range(60):
            if _stop_event.is_set():
                break
            time.sleep(1)
    print("[Notifier] 通知服务已停止")

# ─── 对外接口 ─────────────────────────────────────────

def start():
    t = threading.Thread(target=_notify_loop, daemon=True)
    t.start()

def stop():
    _stop_event.set()

def notify_now(title: str, message: str):
    """供外部直接调用发一条通知"""
    _send(title, message)
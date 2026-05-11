# 后台定时同步任务，每隔 N 分钟自动拉取 Outlook 最新数据

import json
import threading
import time
from datetime import datetime
from ms_sync import sync_all

with open('config.json', encoding='utf-8') as f:
    config = json.load(f)

INTERVAL = config['app']['sync_interval_minutes'] * 60  # 转成秒

_stop_event = threading.Event()
_sync_thread = None

def _sync_loop():
    print(f"[Scheduler] 启动，每 {INTERVAL//60} 分钟同步一次")
    while not _stop_event.is_set():
        # 启动时 bootstrap 已经同步一次；后台线程先等待，避免开机连续同步两遍。
        for _ in range(INTERVAL):
            if _stop_event.is_set():
                break
            time.sleep(1)
        if _stop_event.is_set():
            break
        sync_all()
    print("[Scheduler] 已停止")

def start():
    """启动后台同步线程"""
    global _sync_thread
    if _sync_thread and _sync_thread.is_alive():
        print("[Scheduler] 已在运行中")
        return
    _stop_event.clear()
    _sync_thread = threading.Thread(target=_sync_loop, daemon=True)
    _sync_thread.start()

def stop():
    """停止后台同步"""
    _stop_event.set()

def trigger_now():
    """立即触发一次同步（供前端手动刷新调用）"""
    t = threading.Thread(target=sync_all, daemon=True)
    t.start()
    return t

def status() -> dict:
    return {
        'running': _sync_thread.is_alive() if _sync_thread else False,
        'interval_minutes': INTERVAL // 60,
        'last_check': datetime.now().isoformat()
    }

if __name__ == '__main__':
    start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        stop()
        print("已退出")

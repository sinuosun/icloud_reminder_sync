# 通过 win32com 直接读写本地 Outlook 桌面版
# 无需 Azure、无需 API Key，Outlook 装了就能用

import json
import pythoncom
import win32com.client
from datetime import datetime, timedelta
from db import (upsert_event, upsert_reminder,
                upsert_calendar, upsert_reminder_list)

# Outlook 文件夹常量
OL_FOLDER_CALENDAR = 9
OL_FOLDER_TASKS    = 13

# Outlook 重要性常量
OL_IMPORTANCE = {0: 'low', 1: 'normal', 2: 'high'}
IMPORTANCE_MAP = {'low': 0, 'normal': 1, 'high': 2}

# ─── Outlook 连接 ─────────────────────────────────────

def get_outlook():
    """获取 Outlook COM 对象（Outlook 必须已安装）"""
    pythoncom.CoInitialize()
    try:
        outlook = win32com.client.Dispatch('Outlook.Application')
        return outlook.GetNamespace('MAPI')
    except Exception as e:
        raise RuntimeError(f"无法连接 Outlook，请确认已安装并登录: {e}")

# ─── 日历同步 ─────────────────────────────────────────

def sync_calendars():
    """同步所有日历文件夹"""
    ns = get_outlook()
    root = ns.GetDefaultFolder(OL_FOLDER_CALENDAR)

    # 默认日历
    upsert_calendar({
        'id':     root.EntryID,
        'name':   root.Name,
        'color':  '#0078D4',
        'type':   'event',
        'source': 'outlook'
    })

    # 子日历文件夹
    for folder in root.Folders:
        upsert_calendar({
            'id':     folder.EntryID,
            'name':   folder.Name,
            'color':  '#0078D4',
            'type':   'event',
            'source': 'outlook'
        })

    print(f"[Sync] 日历文件夹同步完成")

def sync_events(days_back=30, days_forward=90):
    """同步日历事件"""
    ns = get_outlook()
    folder = ns.GetDefaultFolder(OL_FOLDER_CALENDAR)

    start = datetime.now() - timedelta(days=days_back)
    end   = datetime.now() + timedelta(days=days_forward)

    # 必须先 Sort + IncludeRecurrences 才能正确展开重复事件
    items = folder.Items
    items.IncludeRecurrences = True
    items.Sort('[Start]')

    # 用 Restrict 过滤时间范围，比遍历全部快很多
    filter_str = (
        f"[Start] >= '{start.strftime('%m/%d/%Y')}' "
        f"AND [Start] <= '{end.strftime('%m/%d/%Y')}'"
    )
    filtered = items.Restrict(filter_str)

    total = 0
    for item in filtered:
        try:
            # 只处理日历项目
            if item.Class != 26:  # 26 = olAppointmentItem
                continue

            upsert_event({
                'id':          item.EntryID,
                'calendar_id': folder.EntryID,
                'title':       item.Subject or '（无标题）',
                'description': item.Body or '',
                'location':    item.Location or '',
                'start_time':  _fmt_dt(item.Start),
                'end_time':    _fmt_dt(item.End),
                'all_day':     1 if item.AllDayEvent else 0,
                'recurrence':  _recurrence_str(item),
                'color':       _category_to_color(item.Categories),
                'source':      'outlook',
                'raw_ical':    '',
                'updated_at':  datetime.now().isoformat()
            })
            total += 1
        except Exception as e:
            print(f"[Sync] 跳过事件（读取失败）: {e}")

    print(f"[Sync] 事件同步完成，共 {total} 条")

def create_event(title: str, start: str, end: str,
                 description='', location='', all_day=False,
                 calendar_id=None) -> str:
    """在 Outlook 创建日历事件（自动同步回手机）"""
    ns  = get_outlook()
    app = win32com.client.Dispatch('Outlook.Application')
    ev  = app.CreateItem(1)  # 1 = olAppointmentItem

    ev.Subject     = title
    ev.Body        = description
    ev.Location    = location
    ev.Start       = start
    ev.End         = end
    ev.AllDayEvent = all_day

    # 如果指定了特定日历文件夹
    if calendar_id:
        folder = ns.GetFolderFromID(calendar_id)
        ev.Move(folder)

    ev.Save()
    print(f"[Outlook] 事件已创建: {title}")
    return ev.EntryID

def update_event(entry_id: str, **kwargs):
    """更新 Outlook 日历事件"""
    ns   = get_outlook()
    item = ns.GetItemFromID(entry_id)

    if 'title'       in kwargs: item.Subject     = kwargs['title']
    if 'description' in kwargs: item.Body        = kwargs['description']
    if 'location'    in kwargs: item.Location    = kwargs['location']
    if 'start_time'  in kwargs: item.Start       = kwargs['start_time']
    if 'end_time'    in kwargs: item.End         = kwargs['end_time']
    if 'all_day'     in kwargs: item.AllDayEvent = kwargs['all_day']

    item.Save()
    print(f"[Outlook] 事件已更新: {entry_id}")

def delete_event_remote(entry_id: str):
    """删除 Outlook 日历事件"""
    ns   = get_outlook()
    item = ns.GetItemFromID(entry_id)
    item.Delete()
    print(f"[Outlook] 事件已删除: {entry_id}")

# ─── 任务/提醒同步 ────────────────────────────────────

def sync_reminder_lists():
    """Outlook 任务只有一个默认文件夹，作为默认列表"""
    ns     = get_outlook()
    folder = ns.GetDefaultFolder(OL_FOLDER_TASKS)
    upsert_reminder_list({
        'id':     folder.EntryID,
        'name':   '提醒事项',
        'color':  '#FF3B30',
        'source': 'outlook'
    })
    print(f"[Sync] 提醒列表同步完成")

def sync_reminders():
    """同步 Outlook 任务（对应手机提醒事项）"""
    ns     = get_outlook()
    folder = ns.GetDefaultFolder(OL_FOLDER_TASKS)
    items  = folder.Items
    total  = 0

    for item in items:
        try:
            if item.Class != 48:  # 48 = olTaskItem
                continue

            due = ''
            try:
                if item.DueDate and str(item.DueDate).startswith('4501'):
                    due = ''   # Outlook 用4501年表示"无截止日期"
                else:
                    due = _fmt_dt(item.DueDate)
            except:
                due = ''

            completed_at = ''
            try:
                if item.DateCompleted:
                    completed_at = _fmt_dt(item.DateCompleted)
            except:
                pass

            upsert_reminder({
                'id':           item.EntryID,
                'list_id':      folder.EntryID,
                'title':        item.Subject or '（无标题）',
                'notes':        item.Body or '',
                'due_date':     due,
                'completed':    1 if item.Complete else 0,
                'completed_at': completed_at,
                'priority':     item.Importance or 1,
                'recurrence':   '',
                'source':       'outlook',
                'raw_ical':     '',
                'updated_at':   datetime.now().isoformat()
            })
            total += 1
        except Exception as e:
            print(f"[Sync] 跳过任务（读取失败）: {e}")

    print(f"[Sync] 提醒事项同步完成，共 {total} 条")

def create_reminder(title: str, due_date='', notes='', priority=1) -> str:
    """在 Outlook 创建任务（自动同步回手机提醒事项）"""
    app  = win32com.client.Dispatch('Outlook.Application')
    task = app.CreateItem(3)  # 3 = olTaskItem

    task.Subject    = title
    task.Body       = notes
    task.Importance = priority
    if due_date:
        task.DueDate = due_date

    task.Save()
    print(f"[Outlook] 任务已创建: {title}")
    return task.EntryID

def complete_reminder_remote(entry_id: str, done=True):
    """标记任务完成/未完成"""
    ns   = get_outlook()
    item = ns.GetItemFromID(entry_id)
    item.Complete = done
    if done:
        item.DateCompleted = datetime.now()
    item.Save()

def delete_reminder_remote(entry_id: str):
    """删除 Outlook 任务"""
    ns   = get_outlook()
    item = ns.GetItemFromID(entry_id)
    item.Delete()

# ─── 全量同步入口 ─────────────────────────────────────

def sync_all():
    print(f"\n[Sync] 开始同步 {datetime.now().strftime('%H:%M:%S')}")
    try:
        sync_calendars()
        sync_events()
        sync_reminder_lists()
        sync_reminders()
        print("[Sync] 全部同步完成 ✅\n")
        return True
    except Exception as e:
        print(f"[Sync] 同步出错: {e}")
        return False

# ─── 工具函数 ─────────────────────────────────────────

def _fmt_dt(dt) -> str:
    """把 COM 时间对象转成 ISO 字符串"""
    try:
        return datetime.strptime(str(dt), '%Y-%m-%d %H:%M:%S').isoformat()
    except:
        try:
            return str(dt)
        except:
            return ''

def _recurrence_str(item) -> str:
    """简单判断是否为重复事件"""
    try:
        return 'recurring' if item.IsRecurring else ''
    except:
        return ''

def _category_to_color(categories: str) -> str:
    """根据 Outlook 分类名称映射颜色"""
    mapping = {
        '红色': '#FF3B30', '橙色': '#FF9500', '黄色': '#FFCC00',
        '绿色': '#34C759', '蓝色': '#007AFF', '紫色': '#AF52DE',
        'Red': '#FF3B30', 'Orange': '#FF9500', 'Yellow': '#FFCC00',
        'Green': '#34C759', 'Blue': '#007AFF', 'Purple': '#AF52DE',
    }
    if not categories:
        return '#007AFF'
    for key, color in mapping.items():
        if key in categories:
            return color
    return '#007AFF'

if __name__ == '__main__':
    sync_all()
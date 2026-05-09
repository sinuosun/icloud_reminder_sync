from pyicloud import PyiCloudService
from datetime import datetime, timedelta

# 登录 iCloud
api = PyiCloudService()

# 创建日历事件
event = api.calendar.create(
    title='测试事件',
    starts=datetime.now(),
    ends=datetime.now() + timedelta(hours=1)
)
print(event)

# 创建提醒事项
reminder_list_id = api.reminders.default()
reminder = api.reminders.create(
    list_id=reminder_list_id,
    title='测试提醒',
    due_date=datetime.now() + timedelta(minutes=10)
)
print(reminder)
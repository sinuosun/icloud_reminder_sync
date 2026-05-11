# 🍎 苹果日历 for Windows

> 在 Windows 上获得苹果日历与提醒事项的完整体验，通过 Outlook 实现与 iPhone 的双向同步。

![Python](https://img.shields.io/badge/Python-3.8+-blue) ![Flask](https://img.shields.io/badge/Flask-3.x-lightgrey) ![Platform](https://img.shields.io/badge/Platform-Windows-0078D4) ![License](https://img.shields.io/badge/License-MIT-green)

---

## 📸 功能预览

- 月 / 周 / 日 三种日历视图
- 提醒事项面板，支持优先级与截止日期
- 深色 / 浅色主题一键切换
- Windows 系统原生通知
- 每 5 分钟自动后台同步

---

## 🔧 工作原理

```
iPhone 日历 / 提醒事项
        ↕  (系统账号同步)
   经典版 Outlook 桌面端
        ↕  (win32com COM 接口)
     本地 Python 后端
        ↕  (Flask API)
    浏览器日历 UI 界面
```

iPhone 通过 Microsoft Exchange 账号将日历和提醒事项同步到 Outlook，Python 程序通过 Windows COM 接口读写 Outlook 数据，实现完整双向同步。

---

## 📋 环境要求

| 依赖 | 版本要求 |
|------|----------|
| Windows | 10 / 11 |
| Python | 3.8+ |
| 经典版 Outlook | 必须安装并登录（不支持新版 Outlook） |
| iPhone | 已添加 Microsoft Exchange 账号 |

---

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/sinuosun/icloud_reminder_sync.git
cd 你的仓库名
```

### 2. 创建虚拟环境

```bash
python -m venv venv
venv\Scripts\activate
```

### 3. 安装依赖

```bash
pip install flask pywin32 winotify
```

### 4. 配置文件

复制配置模板并填写参数：

```bash
copy config.example.json config.json
```

`config.json` 内容：

```json
{
  "app": {
    "sync_interval_minutes": 5,
    "port": 5000,
    "debug": false
  },
  "notifications": {
    "enabled": true,
    "remind_before_minutes": [10, 30]
  }
}
```

### 5. iPhone 侧配置（一次性）

1. 打开 iPhone **设置** → **日历** → **账户** → **添加账户**
2. 选择 **Microsoft Exchange**，输入 Outlook 邮箱
3. 同样在**提醒事项** → **账户**里开启同步
4. 等待 iPhone 与 Outlook 完成初次同步

### 6. 启动程序

确保经典版 Outlook 已打开并登录，然后运行：

```bash
python main.py
```

打开浏览器访问：[http://localhost:5000](http://localhost:5000)

---

## 📁 项目结构

```
.
├── main.py            # Flask 后端入口 & API 路由
├── ms_sync.py         # Outlook COM 接口同步逻辑
├── db.py              # SQLite 本地数据库
├── scheduler.py       # 后台定时同步任务
├── notifier.py        # Windows 系统通知
├── config.json        # 本地配置（已 gitignore）
├── config.example.json
├── calendar.db        # 本地缓存数据库（自动生成）
├── templates/
│   └── index.html     # 主界面
└── static/
    ├── style.css      # 苹果风格样式
    └── app.js         # 前端交互逻辑
```

---

## 🌐 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/events` | 获取日历事件 |
| POST | `/api/events` | 创建事件 |
| PATCH | `/api/events/<id>` | 更新事件 |
| DELETE | `/api/events/<id>` | 删除事件 |
| GET | `/api/reminders` | 获取提醒事项 |
| POST | `/api/reminders` | 创建提醒 |
| POST | `/api/reminders/<id>/complete` | 标记完成 |
| DELETE | `/api/reminders/<id>` | 删除提醒 |
| POST | `/api/sync` | 手动触发同步 |
| GET | `/api/sync/status` | 查看同步状态 |

---

## ❓ 常见问题

**Q: 启动报错「无法连接 Outlook」**

确认使用的是**经典版 Outlook**（非微软应用商店的新版 Outlook）。新版 Outlook 不支持 COM 接口。可在控制面板 → 应用 → Microsoft 365 → 修改 中切换回经典版。

**Q: 日历事件不显示**

点击界面右上角的刷新按钮手动同步，或检查 Outlook 是否已打开并完成账号登录。

**Q: iPhone 上的改动多久同步过来**

默认每 5 分钟自动同步一次，可在 `config.json` 中修改 `sync_interval_minutes`。也可以点击 UI 右上角的同步按钮立即触发。

**Q: 能否在没有 Outlook 的情况下使用**

暂不支持。Outlook 是连接 iPhone 数据的桥梁。计划在后续版本支持直接通过 iCloud CalDAV 连接。

---

## 🗺️ 后续计划

- [ ] 打包为独立 `.exe`，无需安装 Python
- [ ] 系统托盘图标，关闭窗口后后台运行
- [ ] 年视图
- [ ] 事件拖拽移动
- [ ] 提醒事项拖拽排序
- [ ] 支持直连 iCloud CalDAV（无需 Outlook）(也许会不做)
- [ ] 多账号日历合并显示

---

## 📄 License

MIT License © 2026
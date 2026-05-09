"""
db.py
=====

一个极简的 SQLite 数据访问层，用于存储/查询任务信息。

特点：
- 自动创建数据库文件与 tasks 表（如不存在）。
- 提供 add_task / update_task / delete_task / get_tasks / init_db 等函数。
- 查询结果以「字典列表」形式返回，便于上层业务直接使用。

环境要求：Windows + Python 3.10+（仅使用标准库 sqlite3）。
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Iterable

# 数据库文件默认放在本模块同级目录下（项目根目录通常也在这里）。
_DB_PATH: Path = Path(__file__).with_name("tasks.db")

# 表名与允许更新/过滤的字段集合
_TABLE_NAME = "tasks"
_COLUMNS: tuple[str, ...] = (
    "id",
    "title",
    "start_time",
    "end_time",
    "calendar_event_id",
    "reminder_id",
    "repeat_rule",
    "status",
)
_MUTABLE_COLUMNS: set[str] = set(_COLUMNS) - {"id"}

# 用于避免重复 init（但仍允许多次调用 init_db，保证幂等）
_INITIALIZED = False


def _get_conn() -> sqlite3.Connection:
    """
    获取一个新的 SQLite 连接。

    说明：
    - 每次调用创建独立连接，避免多线程/多模块共享连接的复杂性。
    - 设置 row_factory 使得查询结果可以按 dict 方式取值。
    """
    conn = sqlite3.connect(_DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    """将 sqlite3.Row 转换为普通 dict。"""
    return dict(row)  # Row 本身可迭代 (key, value)


def _ensure_initialized() -> None:
    """确保数据库与表已经初始化（幂等）。"""
    global _INITIALIZED
    if _INITIALIZED:
        return
    init_db()
    _INITIALIZED = True


def init_db() -> dict[str, Any]:
    """
    初始化数据库与 tasks 表（若不存在则创建）。

    返回：
        dict：包含初始化结果的简单信息。
    """
    # SQLite 会在 connect 时自动创建文件，因此这里无需手动 touch。
    create_sql = f"""
    CREATE TABLE IF NOT EXISTS {_TABLE_NAME} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        start_time TEXT,
        end_time TEXT,
        calendar_event_id TEXT,
        reminder_id TEXT,
        repeat_rule TEXT,
        status TEXT
    )
    """
    with _get_conn() as conn:
        conn.execute(create_sql)
        conn.commit()
    return {"ok": True, "db_path": str(_DB_PATH), "table": _TABLE_NAME}


def add_task(
    title: str,
    start_time: str,
    end_time: str,
    calendar_event_id: str | None = None,
    reminder_id: str | None = None,
    repeat_rule: str | None = None,
    status: str = "pending",
) -> dict[str, Any]:
    """
    将任务写入数据库。

    参数：
        title: 任务标题
        start_time: 开始时间（TEXT；建议上层统一使用 ISO 8601 字符串）
        end_time: 结束时间（TEXT；建议上层统一使用 ISO 8601 字符串）
        calendar_event_id: 日历事件 ID（可选）
        reminder_id: iCloud Reminder ID（可选）
        repeat_rule: 重复规则（可选）
        status: 状态（默认 pending）

    返回：
        dict：插入后的整行数据（含自增 id）。
    """
    _ensure_initialized()

    sql = f"""
    INSERT INTO {_TABLE_NAME}
        (title, start_time, end_time, calendar_event_id, reminder_id, repeat_rule, status)
    VALUES
        (?, ?, ?, ?, ?, ?, ?)
    """
    params = (title, start_time, end_time, calendar_event_id, reminder_id, repeat_rule, status)

    with _get_conn() as conn:
        cur = conn.execute(sql, params)
        conn.commit()
        task_id = int(cur.lastrowid)

    # 返回插入后的数据
    rows = get_tasks({"id": task_id})
    return rows[0] if rows else {"ok": True, "id": task_id}


def update_task(task_id: int, **kwargs: Any) -> dict[str, Any]:
    """
    根据 task_id 更新任务字段。

    用法示例：
        update_task(1, status="completed", repeat_rule="RRULE:FREQ=DAILY")

    参数：
        task_id: 任务 id
        kwargs: 需要更新的字段（仅允许 tasks 表的非 id 字段）

    返回：
        dict：更新后的整行数据；如果未找到任务则返回 {"ok": False, "error": "..."}。
    """
    _ensure_initialized()

    if not kwargs:
        return {"ok": False, "error": "no fields to update"}

    invalid_keys = [k for k in kwargs.keys() if k not in _MUTABLE_COLUMNS]
    if invalid_keys:
        return {"ok": False, "error": f"invalid fields: {', '.join(invalid_keys)}"}

    set_parts: list[str] = []
    values: list[Any] = []
    for key, value in kwargs.items():
        set_parts.append(f"{key} = ?")
        values.append(value)

    sql = f"UPDATE {_TABLE_NAME} SET {', '.join(set_parts)} WHERE id = ?"
    values.append(task_id)

    with _get_conn() as conn:
        cur = conn.execute(sql, tuple(values))
        conn.commit()
        if cur.rowcount == 0:
            return {"ok": False, "error": f"task not found: {task_id}"}

    rows = get_tasks({"id": task_id})
    return rows[0] if rows else {"ok": True, "id": task_id}


def delete_task(task_id: int) -> dict[str, Any]:
    """
    删除指定任务。

    返回：
        dict：{"ok": True, "deleted": 1} 或 {"ok": True, "deleted": 0}
    """
    _ensure_initialized()

    sql = f"DELETE FROM {_TABLE_NAME} WHERE id = ?"
    with _get_conn() as conn:
        cur = conn.execute(sql, (task_id,))
        conn.commit()
        deleted = int(cur.rowcount or 0)
    return {"ok": True, "deleted": deleted}


def get_tasks(filter_dict: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """
    查询任务，可按 filter_dict 条件过滤。

    示例：
        get_tasks()                           # 查询全部任务
        get_tasks({"status": "completed"})    # 按状态过滤
        get_tasks({"id": 1})                  # 按 id 查询

    过滤规则：
        - 仅支持等值匹配：字段 = ?
        - filter_dict 中的 key 必须为 tasks 表字段名（允许包含 id）

    返回：
        list[dict]：按 id 升序返回的任务列表。
    """
    _ensure_initialized()

    where_sql = ""
    params: list[Any] = []

    if filter_dict:
        invalid_keys = [k for k in filter_dict.keys() if k not in _COLUMNS]
        if invalid_keys:
            # 为保持返回类型一致，这里返回空列表（也可抛异常；但需求强调“返回结果”）
            return []

        parts: list[str] = []
        for key, value in filter_dict.items():
            parts.append(f"{key} = ?")
            params.append(value)
        where_sql = " WHERE " + " AND ".join(parts)

    sql = f"SELECT {', '.join(_COLUMNS)} FROM {_TABLE_NAME}{where_sql} ORDER BY id ASC"
    with _get_conn() as conn:
        cur = conn.execute(sql, tuple(params))
        rows: Iterable[sqlite3.Row] = cur.fetchall()

    return [_row_to_dict(r) for r in rows]

if __name__ == "__main__":
    init_db()
    add_task("测试任务", "2026-05-06 20:00", "2026-05-06 21:00")
    print(get_tasks())
"""
icloud_sync.py
==============

Utilities for syncing task records to iCloud Calendar and Reminders.

This module is designed to work with the task dictionaries returned by
`db.get_tasks()` and uses the `pyicloud` package to create, update, and delete:

- iCloud Calendar events
- iCloud Reminders items

Requirements:
- Windows + Python 3.10+
- `pyicloud` installed in the current environment
- `config.json` present in the project root
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from pyicloud import PyiCloudService
from pyicloud.exceptions import (
    PyiCloudAPIResponseException,
    PyiCloudFailedLoginException,
    PyiCloudPasswordException,
    PyiCloudServiceNotActivatedException,
)
from pyicloud.services.calendar import EventObject
from pyicloud.services.reminders.models.domain import RecurrenceFrequency


CONFIG_PATH = Path(__file__).with_name("config.json")

_API_CACHE: PyiCloudService | None = None
_CONFIG_CACHE: dict[str, Any] | None = None


def load_config() -> dict[str, Any]:
    """
    Load `config.json`.

    Expected keys:
    - icloud_email
    - app_password
    - reminder_advance_minutes
    """
    global _CONFIG_CACHE

    if _CONFIG_CACHE is not None:
        return _CONFIG_CACHE

    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config file not found: {CONFIG_PATH}")

    with CONFIG_PATH.open("r", encoding="utf-8") as file:
        config = json.load(file)

    required_keys = ("icloud_email", "app_password", "reminder_advance_minutes")
    missing = [key for key in required_keys if key not in config]
    if missing:
        raise KeyError(f"Missing config keys: {', '.join(missing)}")

    _CONFIG_CACHE = config
    return config


def _parse_task_datetime(value: str | None) -> datetime | None:
    """
    Parse a task time string into `datetime`.

    Supported common formats:
    - 2026-05-06T20:00:00
    - 2026-05-06 20:00:00
    - 2026-05-06 20:00
    """
    if not value:
        return None

    normalized = value.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        pass

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(normalized, fmt)
        except ValueError:
            continue

    raise ValueError(f"Unsupported datetime format: {value}")


def _task_note(task: dict[str, Any]) -> str:
    """Build a short description body for the reminder item."""
    parts = [f"Task ID: {task.get('id', '')}"]

    if task.get("start_time"):
        parts.append(f"Start: {task['start_time']}")
    if task.get("end_time"):
        parts.append(f"End: {task['end_time']}")
    if task.get("repeat_rule"):
        parts.append(f"Repeat: {task['repeat_rule']}")
    if task.get("status"):
        parts.append(f"Status: {task['status']}")

    return "\n".join(parts)


def _get_calendar_service(api: PyiCloudService) -> Any:
    """Return the iCloud Calendar service object."""
    return api.calendar


def _get_reminders_service(api: PyiCloudService) -> Any:
    """Return the iCloud Reminders service object."""
    return api.reminders


def _select_calendar_guid(api: PyiCloudService) -> str:
    """
    Select one usable calendar.

    Preference order:
    1. default calendar
    2. family calendar
    3. first available calendar
    """
    calendars = _get_calendar_service(api).get_calendars(as_objs=True)
    if not calendars:
        raise RuntimeError("No iCloud calendars found.")

    for calendar in calendars:
        if getattr(calendar, "is_default", False):
            return calendar.guid
    for calendar in calendars:
        if getattr(calendar, "is_family", False):
            return calendar.guid
    return calendars[0].guid


def _select_reminder_list_id(api: PyiCloudService) -> str:
    """
    Select one usable reminders list.

    The pyicloud reminders API needs a list ID when creating a reminder.
    """
    reminder_lists = list(_get_reminders_service(api).lists())
    if not reminder_lists:
        raise RuntimeError("No iCloud reminder lists found.")
    return reminder_lists[0].id


def _parse_repeat_rule(
    repeat_rule: str | None,
) -> tuple[RecurrenceFrequency, int] | None:
    """
    Parse a simple RRULE-like string into a Reminders recurrence rule.

    Supported examples:
    - FREQ=DAILY
    - RRULE:FREQ=WEEKLY
    - FREQ=MONTHLY;INTERVAL=2
    """
    if not repeat_rule:
        return None

    raw = repeat_rule.strip().upper()
    if raw.startswith("RRULE:"):
        raw = raw[len("RRULE:") :]

    pairs: dict[str, str] = {}
    for part in raw.split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        pairs[key.strip()] = value.strip()

    freq_value = pairs.get("FREQ")
    if not freq_value:
        return None

    frequency_map = {
        "DAILY": RecurrenceFrequency.DAILY,
        "WEEKLY": RecurrenceFrequency.WEEKLY,
        "MONTHLY": RecurrenceFrequency.MONTHLY,
        "YEARLY": RecurrenceFrequency.YEARLY,
    }
    frequency = frequency_map.get(freq_value)
    if frequency is None:
        return None

    interval = int(pairs.get("INTERVAL", "1"))
    return frequency, max(interval, 1)


def get_icloud_api(force_refresh: bool = False) -> PyiCloudService:
    """
    Log in to iCloud and return a cached `PyiCloudService` instance.

    This function also handles interactive 2FA when Apple requires it.
    """
    global _API_CACHE

    if _API_CACHE is not None and not force_refresh:
        return _API_CACHE

    config = load_config()
    email = str(config["icloud_email"]).strip()
    password = str(config["app_password"]).strip()

    if not email or not password:
        raise ValueError("icloud_email and app_password must not be empty.")

    try:
        api = PyiCloudService(email, password, with_family=True)
    except (PyiCloudFailedLoginException, PyiCloudPasswordException) as exc:
        print(f"iCloud login failed: {exc}")
        raise
    except Exception as exc:
        print(f"Unable to connect to iCloud: {exc}")
        raise

    if api.requires_2fa:
        print("iCloud requires two-factor authentication.")
        try:
            sent = api.request_2fa_code()
        except Exception as exc:
            print(f"Unable to request 2FA code automatically: {exc}")
            raise

        if sent:
            print("A verification code has been requested from Apple.")
        else:
            print("Please check your trusted device or SMS for the verification code.")

        code = input("Enter the iCloud verification code: ").strip()
        if not code:
            raise RuntimeError("No verification code was entered.")
        if not api.validate_2fa_code(code):
            print("iCloud 2FA verification failed.")
            raise RuntimeError("Invalid iCloud verification code.")

    elif api.requires_2sa:
        print("iCloud requires two-step authentication.")
        devices = api.trusted_devices
        if not devices:
            raise RuntimeError("No trusted devices available for iCloud verification.")

        device = devices[0]
        if not api.send_verification_code(device):
            raise RuntimeError("Failed to send iCloud verification code.")

        code = input("Enter the iCloud verification code: ").strip()
        if not api.validate_verification_code(device, code):
            print("iCloud verification failed.")
            raise RuntimeError("Invalid iCloud verification code.")

    _API_CACHE = api
    return api


def _build_event(task: dict[str, Any], calendar_guid: str) -> EventObject:
    """Create an `EventObject` from one task dictionary."""
    start_dt = _parse_task_datetime(task.get("start_time"))
    end_dt = _parse_task_datetime(task.get("end_time"))

    if start_dt is None or end_dt is None:
        raise ValueError("Both start_time and end_time are required for calendar sync.")

    event = EventObject(
        pguid=calendar_guid,
        title=str(task.get("title") or "Untitled Task"),
        start_date=start_dt,
        end_date=end_dt,
        guid=str(task.get("calendar_event_id") or ""),
    )

    advance_minutes = int(load_config().get("reminder_advance_minutes", 0) or 0)
    if advance_minutes > 0:
        event.add_alarm_before(minutes=advance_minutes)

    return event


def _sync_reminder_recurrence(
    reminders_service: Any,
    reminder: Any,
    repeat_rule: str | None,
) -> None:
    """
    Sync a reminder recurrence rule.

    Current behavior:
    - creates or updates one simple recurrence rule when supported
    - removes existing recurrence rules when `repeat_rule` is empty
    """
    current_rules = list(reminders_service.recurrence_rules_for(reminder))
    parsed = _parse_repeat_rule(repeat_rule)

    if parsed is None:
        for rule in current_rules:
            reminders_service.delete_recurrence_rule(reminder, rule)
        return

    frequency, interval = parsed
    if current_rules:
        reminders_service.update_recurrence_rule(
            current_rules[0],
            frequency=frequency,
            interval=interval,
        )
        for rule in current_rules[1:]:
            reminders_service.delete_recurrence_rule(reminder, rule)
        return

    reminders_service.create_recurrence_rule(
        reminder,
        frequency=frequency,
        interval=interval,
    )


def create_event(task: dict[str, Any]) -> dict[str, str] | bool | str:
    """
    Create both an iCloud Calendar event and an iCloud Reminder.

    Returns:
    - {"event_id": "...", "reminder_id": "..."} on success
    - False or an error string on failure
    """
    created_event: EventObject | None = None

    try:
        api = get_icloud_api()
        calendar_guid = _select_calendar_guid(api)
        reminder_list_id = _select_reminder_list_id(api)

        calendar_service = _get_calendar_service(api)
        reminders_service = _get_reminders_service(api)

        event = _build_event(task, calendar_guid)
        calendar_service.add_event(event)
        created_event = event

        start_dt = _parse_task_datetime(task.get("start_time"))
        advance_minutes = int(load_config().get("reminder_advance_minutes", 0) or 0)
        reminder_due_date = None
        if start_dt is not None:
            reminder_due_date = start_dt - timedelta(minutes=advance_minutes)

        reminder = reminders_service.create(
            list_id=reminder_list_id,
            title=str(task.get("title") or "Untitled Task"),
            desc=_task_note(task),
            due_date=reminder_due_date,
            completed=str(task.get("status", "")).lower() == "completed",
        )
        _sync_reminder_recurrence(reminders_service, reminder, task.get("repeat_rule"))

        return {"event_id": event.guid, "reminder_id": reminder.id}
    except Exception as exc:
        if created_event is not None:
            try:
                api = get_icloud_api()
                _get_calendar_service(api).remove_event(created_event)
            except Exception:
                pass
        print(f"create_event failed: {exc}")
        return str(exc)


def update_event(task: dict[str, Any]) -> bool | str:
    """
    Update an existing iCloud Calendar event and/or Reminder.

    Notes:
    - Calendar updates are performed by re-posting the event with the same GUID.
    - Reminder updates are performed through `pyicloud`'s typed Reminders API.
    """
    try:
        api = get_icloud_api()
        calendar_service = _get_calendar_service(api)
        reminders_service = _get_reminders_service(api)

        calendar_event_id = str(task.get("calendar_event_id") or "").strip()
        reminder_id = str(task.get("reminder_id") or "").strip()

        if calendar_event_id:
            calendar_guid = _select_calendar_guid(api)
            try:
                event_detail = calendar_service.get_event_detail(
                    calendar_guid,
                    calendar_event_id,
                    as_obj=True,
                )
                event = event_detail
            except Exception:
                event = _build_event(task, calendar_guid)
            else:
                event.title = str(task.get("title") or event.title)
                start_dt = _parse_task_datetime(task.get("start_time"))
                end_dt = _parse_task_datetime(task.get("end_time"))
                if start_dt is not None:
                    event.start_date = start_dt
                    event.local_start_date = start_dt
                if end_dt is not None:
                    event.end_date = end_dt
                    event.local_end_date = end_dt
                event.duration = int(
                    (event.end_date.timestamp() - event.start_date.timestamp()) / 60
                )

                event.alarms = []
                if hasattr(event, "_alarm_metadata"):
                    event._alarm_metadata = {}
                advance_minutes = int(load_config().get("reminder_advance_minutes", 0) or 0)
                if advance_minutes > 0:
                    event.add_alarm_before(minutes=advance_minutes)

            calendar_service.add_event(event)

        if reminder_id:
            reminder = reminders_service.get(reminder_id)
            reminder.title = str(task.get("title") or reminder.title)
            reminder.desc = _task_note(task)
            reminder.completed = str(task.get("status", "")).lower() == "completed"

            start_dt = _parse_task_datetime(task.get("start_time"))
            advance_minutes = int(load_config().get("reminder_advance_minutes", 0) or 0)
            reminder.due_date = (
                start_dt - timedelta(minutes=advance_minutes) if start_dt else None
            )

            reminders_service.update(reminder)
            refreshed = reminders_service.get(reminder.id)
            _sync_reminder_recurrence(
                reminders_service,
                refreshed,
                task.get("repeat_rule"),
            )

        return True
    except Exception as exc:
        print(f"update_event failed: {exc}")
        return str(exc)


def delete_event(task: dict[str, Any]) -> bool | str:
    """
    Delete an existing iCloud Calendar event and/or Reminder.

    Missing remote objects are treated as non-fatal so repeated deletes remain safe.
    """
    try:
        api = get_icloud_api()
        calendar_service = _get_calendar_service(api)
        reminders_service = _get_reminders_service(api)

        calendar_event_id = str(task.get("calendar_event_id") or "").strip()
        reminder_id = str(task.get("reminder_id") or "").strip()

        if calendar_event_id:
            calendar_guid = _select_calendar_guid(api)
            try:
                event = calendar_service.get_event_detail(
                    calendar_guid,
                    calendar_event_id,
                    as_obj=True,
                )
                calendar_service.remove_event(event)
            except (PyiCloudAPIResponseException, KeyError):
                pass

        if reminder_id:
            try:
                reminder = reminders_service.get(reminder_id)
                reminders_service.delete(reminder)
            except (PyiCloudAPIResponseException, KeyError):
                pass

        return True
    except Exception as exc:
        print(f"delete_event failed: {exc}")
        return str(exc)


if __name__ == "__main__":
    try:
        api = get_icloud_api()
        calendars = _get_calendar_service(api).get_calendars(as_objs=True)
        reminder_lists = list(_get_reminders_service(api).lists())
        print(f"Login successful: {load_config().get('icloud_email')}")
        print(f"Available calendars: {len(calendars)}")
        print(f"Available reminder lists: {len(reminder_lists)}")
    except (
        FileNotFoundError,
        KeyError,
        ValueError,
        PyiCloudFailedLoginException,
        PyiCloudPasswordException,
        PyiCloudServiceNotActivatedException,
    ) as exc:
        print(f"Initialization failed: {exc}")

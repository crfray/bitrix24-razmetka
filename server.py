# -*- coding: utf-8 -*-
"""Локальный сервер разметки. Запуск: python server.py project  →  http://localhost:8765
                                     python server.py tasks    →  http://localhost:8766

Держит JSON-файлы спеки, отдаёт их интерфейсу и пишет обратно.
Зависимостей нет, только стандартная библиотека.
"""
import base64
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from contextvars import ContextVar
from functools import wraps
import threading
import hmac
from http.cookies import SimpleCookie, CookieError

import auth

import space

SPACE = space.pick()
ROOT = space.ROOT
DATA = os.environ.get("RAZMETKA_DATA_DIR") or SPACE["data"]
EVENTS = os.path.join(DATA, "events")
APP = os.path.join(ROOT, "app")
MEDIA = os.path.join(DATA, "media")
PORT = int(os.environ.get("PORT") or SPACE["port"])
CHAT_DATA = os.environ.get("TASK_CHATS_DATA_DIR") or os.path.join(ROOT, "data-task-chats")
AREA = ContextVar("area", default="main")
DATA_LOCK = threading.RLock()
AUTH = None
COOKIE_SECURE = os.environ.get("AUTH_COOKIE_SECURE", "1") != "0"
COOKIE_NAME = ("__Host-" if COOKIE_SECURE else "") + "razmetka-" + SPACE["name"]
AUTH_ORIGIN = os.environ.get("AUTH_ORIGIN", "").rstrip("/")
MAX_JSON_BYTES = 1024 * 1024

def data_dir():
    return CHAT_DATA if AREA.get() == "task_chats" else DATA

def events_dir():
    return os.path.join(data_dir(), "events")

def media_dir():
    return os.path.join(data_dir(), "media")

def media_prefix():
    return "task-chats-media/" if AREA.get() == "task_chats" else "media/"

def locked(function):
    @wraps(function)
    def wrapper(*args, **kwargs):
        with DATA_LOCK:
            return function(*args, **kwargs)
    return wrapper


IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".gif": "image/gif", ".webp": "image/webp"}
VIDEO_TYPES = {".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
               ".m4v": "video/mp4"}
MEDIA_TYPES = dict(IMAGE_TYPES)
MEDIA_TYPES.update(VIDEO_TYPES)
MAX_IMAGES = 4
MAX_IMAGE_BYTES = 6 * 1024 * 1024
MAX_VIDEO_BYTES = 80 * 1024 * 1024

STATES = ["draft", "approved", "in_dev", "testing", "awaiting_release",
          "live", "broken", "deprecated"]
LIST_FIELDS = ("c_section", "c_sub_section", "c_element", "status", "measures")
TOOL_RE = re.compile(r"^[a-z0-9_]{1,40}$")

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8"}


def read_json(path, fallback):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return fallback


def write_json(path, payload):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def tool_path(tool):
    if not TOOL_RE.match(tool or ""):
        raise ValueError("недопустимое имя инструмента: %r" % tool)
    return os.path.join(events_dir(), tool + ".json")


@locked
def load_all():
    tools = {}
    if os.path.isdir(events_dir()):
        for name in sorted(os.listdir(events_dir())):
            if not name.endswith(".json"):
                continue
            tool = name[:-5]
            tools[tool] = read_json(os.path.join(events_dir(), name),
                                    {"tool": tool, "events": []})["events"]
    return tools


@locked
def export_combined(tools):
    """Плоский текстовый срез всей спеки — для агентов, разработчиков и диффов."""
    flat = []
    for tool in sorted(tools):
        flat.extend(tools[tool])
    write_json(os.path.join(data_dir(), "export.json"),
               {"событий": len(flat), "события": flat})


def media_limit(ext):
    return MAX_VIDEO_BYTES if ext in VIDEO_TYPES else MAX_IMAGE_BYTES


@locked
def save_raw(ext, blob):
    """Файл приходит телом запроса: base64 для видео раздувает его на треть."""
    ext = "." + (ext or "").lower().lstrip(".")
    if ext not in MEDIA_TYPES:
        raise ValueError("поддерживаются png, jpg, gif, webp, mp4, webm и mov")
    if not blob:
        raise ValueError("файл пустой")
    limit = media_limit(ext)
    if len(blob) > limit:
        raise ValueError("файл больше %d МБ" % (limit // (1024 * 1024)))
    name = next_media_name(ext)
    with open(os.path.join(media_dir(), name), "wb") as fh:
        fh.write(blob)
    return {"ok": True, "path": media_prefix() + name}


def next_media_name(ext):
    os.makedirs(media_dir(), exist_ok=True)
    top = 0
    for name in os.listdir(media_dir()):
        m = re.match(r"img_(\d+)\.", name)
        if m:
            top = max(top, int(m.group(1)))
    return "img_%04d%s" % (top + 1, ext)


@locked
def save_image(payload):
    """Картинка приходит как data-URL: multipart в стандартной библиотеке неудобен."""
    name = payload.get("filename") or "image.png"
    ext = os.path.splitext(name)[1].lower()
    if ext not in IMAGE_TYPES:
        raise ValueError("поддерживаются только png, jpg, gif и webp")
    raw = payload.get("data") or ""
    if "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw, validate=True)
    except Exception:
        raise ValueError("картинка не раскодировалась")
    if not blob:
        raise ValueError("картинка пустая")
    if len(blob) > MAX_IMAGE_BYTES:
        raise ValueError("картинка больше 6 МБ")
    fname = next_media_name(ext)
    with open(os.path.join(media_dir(), fname), "wb") as fh:
        fh.write(blob)
    return {"ok": True, "path": media_prefix() + fname}


def drop_images(event):
    for img in (event.get("images") or []):
        for key in ("file", "original"):
            name = os.path.basename(img.get(key) or "")
            target = os.path.join(media_dir(), name)
            if name and os.path.isfile(target):
                try:
                    os.remove(target)
                except OSError:
                    pass


@locked
def unlink_image(path):
    """Удаляет картинку, но только если на неё больше никто не ссылается."""
    name = os.path.basename(path or "")
    if os.path.splitext(name)[1].lower() not in MEDIA_TYPES:
        return {"ok": False, "ошибка": "это не картинка"}
    used = set()
    for events in load_all().values():
        for event in events:
            for img in (event.get("images") or []):
                used.add(os.path.basename(img.get("file") or ""))
                used.add(os.path.basename(img.get("original") or ""))
    if name in used:
        return {"ok": False, "ошибка": "на файл ещё ссылается событие"}
    target = os.path.join(media_dir(), name)
    if os.path.isfile(target):
        try:
            os.remove(target)
        except OSError:
            return {"ok": False, "ошибка": "файл не удалился"}
    return {"ok": True}


def next_id(tools):
    top = 0
    for events in tools.values():
        for e in events:
            m = re.match(r"evt_(\d+)$", e.get("id", ""))
            if m:
                top = max(top, int(m.group(1)))
    return "evt_%04d" % (top + 1)


def learn_values(event):
    """Новые значения, набранные в форме, попадают в словарь."""
    path = os.path.join(data_dir(), "dictionaries.json")
    d = read_json(path, {"поля": {}})
    fields = d.setdefault("поля", {})
    added = []
    for field in LIST_FIELDS + ("tool", "category", "type"):
        raw = event.get(field)
        values = raw if isinstance(raw, list) else ([raw] if raw else [])
        bucket = fields.setdefault(field, {"значения": [], "синонимы": {}})
        known = {item["значение"] for item in bucket["значения"]}
        for value in values:
            if value and value not in known:
                bucket["значения"].append({"значение": value, "частота": 0})
                known.add(value)
                added.append(field + "=" + value)
    for field in ("p1", "p2", "p3", "p4", "p5"):
        bucket = fields.setdefault(field, {"значения": [], "синонимы": {}})
        known = {item["значение"] for item in bucket["значения"]}
        for value in (event.get("params") or {}).get(field, []):
            if value and value not in known:
                bucket["значения"].append({"значение": value, "частота": 0})
                known.add(value)
                added.append(field + "=" + value)
    if added:
        write_json(path, d)
    return added


@locked
def save_event(event):
    # Не более четырёх картинок, и только имя файла — путь снаружи не принимаем.
    kept = []
    for img in (event.get("images") or []):
        name = os.path.basename(img.get("file") or "")
        if os.path.splitext(name)[1].lower() not in MEDIA_TYPES:
            continue
        if not os.path.isfile(os.path.join(media_dir(), name)):
            continue
        entry = {"file": media_prefix() + name,
                 "caption": (img.get("caption") or "").strip()}
        origin = os.path.basename(img.get("original") or "")
        if origin and os.path.isfile(os.path.join(media_dir(), origin)):
            entry["original"] = media_prefix() + origin
        if img.get("shapes"):
            entry["shapes"] = img["shapes"]
        kept.append(entry)
        if len(kept) == MAX_IMAGES:
            break
    event["images"] = kept
    tools = load_all()
    tool = event.get("tool") or "unsorted"
    event["tool"] = tool
    if not event.get("id"):
        event["id"] = next_id(tools)
    # событие могло сменить инструмент — убираем его отовсюду
    for other, events in tools.items():
        tools[other] = [e for e in events if e.get("id") != event["id"]]
    tools.setdefault(tool, []).append(event)
    write_json(tool_path(tool), {"tool": tool, "events": tools[tool]})
    for other in tools:
        if other != tool and os.path.exists(tool_path(other)):
            write_json(tool_path(other), {"tool": other, "events": tools[other]})
    added = learn_values(event)
    export_combined(tools)
    return {"ok": True, "id": event["id"], "словарь_пополнен": added}


@locked
def delete_event(event_id):
    tools = load_all()
    removed = False
    for tool, events in tools.items():
        for gone in [e for e in events if e.get("id") == event_id]:
            drop_images(gone)
        kept = [e for e in events if e.get("id") != event_id]
        if len(kept) != len(events):
            removed = True
            tools[tool] = kept
            write_json(tool_path(tool), {"tool": tool, "events": kept})
    export_combined(tools)
    return {"ok": removed}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    def send(self, code, body, ctype="application/json; charset=utf-8", headers=None):
        data = body if isinstance(body, bytes) else json.dumps(
            body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def session_token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return ""
        return cookie[COOKIE_NAME].value if COOKIE_NAME in cookie else ""

    def current_session(self):
        return AUTH.session(self.session_token(), SPACE["name"])

    def auth_state(self, session=None):
        session = session if session is not None else self.current_session()
        return {"authenticated": bool(session), "can_edit": bool(session),
                "username": session["username"] if session else None,
                "csrf": session["csrf"] if session else None}

    def cookie_header(self, token, age):
        return (COOKIE_NAME + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age="
                + str(age) + ("; Secure" if COOKIE_SECURE else ""))

    def same_origin(self):
        expected = AUTH_ORIGIN or (("https://" if COOKIE_SECURE else "http://")
                                   + self.headers.get("Host", ""))
        return self.headers.get("Origin", "") == expected

    def read_body(self, limit):
        raw_length = self.headers.get("Content-Length", "")
        if self.headers.get("Transfer-Encoding") or not raw_length.isascii() or not raw_length.isdecimal():
            self.send(400, {"ok": False, "ошибка": "Неверная длина запроса"})
            return None
        length = int(raw_length) if len(raw_length) <= 12 else limit + 1
        if length > limit:
            self.send(413, {"ok": False, "ошибка": "Запрос слишком большой"})
            return None
        self.connection.settimeout(30)
        try:
            body = self.rfile.read(length)
        except (OSError, TimeoutError):
            self.send(408, {"ok": False, "ошибка": "Время загрузки истекло"})
            return None
        if len(body) != length:
            self.send(400, {"ok": False, "ошибка": "Неполное тело запроса"})
            return None
        return body

    def login(self):
        if not self.same_origin():
            return self.send(403, {"ok": False, "ошибка": "Недопустимый источник запроса"})
        if self.headers.get_content_type() != "application/json":
            return self.send(415, {"ok": False, "ошибка": "Требуется JSON"})
        body = self.read_body(4096)
        if body is None:
            return
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeError):
            payload = None
        if not isinstance(payload, dict):
            return self.send(400, {"ok": False, "ошибка": "Неверный запрос"})
        username, password = payload.get("username"), payload.get("password")
        if not isinstance(username, str) or not isinstance(password, str) or not 1 <= len(username.strip()) <= 80 or not 1 <= len(password) <= 256:
            return self.send(400, {"ok": False, "ошибка": "Укажите логин и пароль"})
        session, retry = AUTH.login(username.strip(), password, self.client_address[0], SPACE["name"])
        if retry:
            return self.send(429, {"ok": False, "ошибка": "Слишком много попыток входа. Повторите позже."}, headers={"Retry-After": str(retry)})
        if not session:
            return self.send(401, {"ok": False, "ошибка": "Неверный логин или пароль"})
        AUTH.logout(self.session_token())
        return self.send(200, dict(self.auth_state(session), ok=True),
                         headers={"Set-Cookie": self.cookie_header(session["token"], auth.SESSION_SECONDS)})

    def select_area(self, require_explicit=False):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if require_explicit and "area" not in query:
            self.send(400, {"ok": False, "ошибка": "Refresh the page before editing: an explicit area is required"})
            return False
        selected = query.get("area", ["main"])
        if len(selected) != 1 or selected[0] not in ("main", "task_chats"):
            self.send(400, {"ok": False, "error": "Unknown area"})
            return False
        area = "task_chats" if parsed.path.startswith("/task-chats-media/") else selected[0]
        if area == "task_chats" and SPACE["name"] != "tasks":
            self.send(400, {"ok": False, "error": "Area unavailable"})
            return False
        AREA.set(area)
        return True

    def chat_state(self):
        if SPACE["name"] != "tasks":
            return None
        token = AREA.set("task_chats")
        try:
            return {"tools": load_all(), "dict": read_json(os.path.join(data_dir(), "dictionaries.json"), {})}
        finally:
            AREA.reset(token)

    def do_GET(self):
        if urlparse(self.path).path == "/api/auth":
            return self.send(200, self.auth_state())
        if not self.select_area():
            return
        path = urlparse(self.path).path
        if path == "/api/state":
            tools = load_all()
            return self.send(200, {
                "auth": self.auth_state(),
                "инструменты": tools,
                "словарь": read_json(os.path.join(data_dir(), "dictionaries.json"), {"поля": {}}),
                "состояния": STATES,
                "пространство": SPACE["title"],
                "type_списком": SPACE["type_list"],
                "task_chats": self.chat_state() if AREA.get() == "main" else None,
                "светофор": SPACE.get("lights", False),
            })
        if path.startswith("/media/") or path.startswith("/task-chats-media/"):
            name = os.path.basename(path)
            target = os.path.join(media_dir(), name)
            ext = os.path.splitext(target)[1].lower()
            if ext in MEDIA_TYPES and os.path.isfile(target):
                with open(target, "rb") as fh:
                    return self.send(200, fh.read(), MEDIA_TYPES[ext])
            return self.send(404, {"ошибка": "картинка не найдена"})
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        target = os.path.normpath(os.path.join(APP, rel))
        if os.path.commonpath([os.path.realpath(APP), os.path.realpath(target)]) != os.path.realpath(APP) or not os.path.isfile(target):
            return self.send(404, {"ошибка": "не найдено"})
        ext = os.path.splitext(target)[1]
        with open(target, "rb") as fh:
            self.send(200, fh.read(), MIME.get(ext, "application/octet-stream"))

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/auth/login":
            return self.login()
        session = self.current_session()
        if not session:
            return self.send(401, {"ok": False, "ошибка": "Для редактирования необходимо войти", "auth_required": True})
        if not self.same_origin() or not hmac.compare_digest(self.headers.get("X-CSRF-Token", "").encode("utf-8"), session["csrf"].encode("utf-8")):
            return self.send(403, {"ok": False, "ошибка": "Не удалось проверить запрос. Обновите страницу."})
        if path == "/api/auth/logout":
            AUTH.logout(self.session_token())
            return self.send(200, {"ok": True}, headers={"Set-Cookie": self.cookie_header("", 0)})
        if not self.select_area(require_explicit=SPACE["name"] == "tasks"):
            return
        limit = MAX_VIDEO_BYTES if path == "/api/upload-raw" else (9 * 1024 * 1024 if path == "/api/upload" else MAX_JSON_BYTES)
        body = self.read_body(limit)
        if body is None:
            return
        if path == "/api/upload-raw":
            try:
                return self.send(200, save_raw(self.headers.get("X-Ext"),
                                               body))
            except ValueError as err:
                return self.send(400, {"ok": False, "ошибка": str(err)})
        try:
            payload = json.loads(body.decode("utf-8") or "{}")
        except ValueError:
            return self.send(400, {"ошибка": "тело не разобралось"})
        if not isinstance(payload, dict):
            return self.send(400, {"ok": False, "ошибка": "Ожидается объект JSON"})
        try:
            if path == "/api/event":
                return self.send(200, save_event(payload))
            if path == "/api/upload":
                return self.send(200, save_image(payload))
            if path == "/api/unlink":
                return self.send(200, unlink_image(payload.get("file")))
            if path == "/api/delete":
                return self.send(200, delete_event(payload.get("id")))
            if path == "/api/check":
                return self.send(200, {
                    "ok": False,
                    "сообщение": "Проверка через ClickHouse ещё не подключена. "
                                 "Нужен доступ и структура таблицы событий.",
                })
        except ValueError as err:
            return self.send(400, {"ошибка": str(err)})
        self.send(404, {"ошибка": "нет такого метода"})


def main():
    global AUTH
    AUTH = auth.AuthStore()
    os.makedirs(events_dir(), exist_ok=True)
    os.makedirs(media_dir(), exist_ok=True)
    export_combined(load_all())
    server = ThreadingHTTPServer((os.environ.get("HOST", "127.0.0.1"), PORT), Handler)
    print("Разметка 2.0 · %s — http://localhost:%d" % (SPACE["title"], PORT))
    print("Данные: %s" % DATA)
    print("Остановить: Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nостановлен")
    return 0


if __name__ == "__main__":
    sys.exit(main())

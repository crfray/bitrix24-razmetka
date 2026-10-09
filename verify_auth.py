"""Integration regression: real HTTP, private fixtures, no production data."""
import base64
import copy
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

import auth

ROOT = Path(__file__).resolve().parent
open_url = build_opener(ProxyHandler({})).open
PASSWORD = "temporary-test-password"


def request(url, path, payload=None, headers=None, raw=None):
    body = raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
    supplied = {"Origin": url}
    if payload is not None:
        supplied["Content-Type"] = "application/json"
    supplied.update(headers or {})
    req = Request(url + path, data=body, headers=supplied)
    try:
        response = open_url(req, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        blob = response.read()
        data = json.loads(blob) if response.headers.get_content_type() == "application/json" else blob
        return response.status, data, response.headers


def login(url, username="editor", password=PASSWORD):
    status, body, headers = request(url, "/api/auth/login", {"username": username, "password": password})
    assert status == 200, (status, body)
    cookie = headers["Set-Cookie"]
    assert "HttpOnly" in cookie and "SameSite=Lax" in cookie
    return {"Cookie": cookie.split(";", 1)[0], "X-CSRF-Token": body["csrf"]}


def snapshots(folder):
    return {str(p.relative_to(folder)): p.read_bytes() for p in folder.rglob("*") if p.is_file()}


def run():
    processes = []
    with tempfile.TemporaryDirectory(prefix="razmetka-auth-") as tmp:
        base = Path(tmp)
        store = auth.AuthStore(str(base / "auth" / "users.sqlite3"))
        store.set_password("editor", PASSWORD)
        store.set_password("disabled", PASSWORD)
        store.disable("disabled")
        urls, folders = {}, {}
        seed = {"id": "evt_0001", "tool": "tasks", "event": "test_event", "params": {}, "images": [], "c_section": []}
        try:
            for scope in ("project", "tasks"):
                folder = base / scope
                folders[scope] = folder
                (folder / "events").mkdir(parents=True)
                (folder / "media").mkdir()
                (folder / "events/tasks.json").write_text(json.dumps({"tool": "tasks", "events": [seed]}))
                (folder / "dictionaries.json").write_text('{"поля": {}}', encoding="utf-8")
                (folder / "media/img_0001.png").write_bytes(b"fixture-media")
                with socket.socket() as sock:
                    sock.bind(("127.0.0.1", 0))
                    port = sock.getsockname()[1]
                urls[scope] = "http://127.0.0.1:" + str(port)
                env = dict(os.environ, PORT=str(port), RAZMETKA_DATA_DIR=str(folder), TASK_CHATS_DATA_DIR=str(base / "chats"), RAZMETKA_AUTH_DB=store.path, AUTH_COOKIE_SECURE="0", AUTH_ORIGIN=urls[scope], PYTHONDONTWRITEBYTECODE="1")
                process = subprocess.Popen([sys.executable, "server.py", scope], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                processes.append(process)
                for _ in range(100):
                    assert process.poll() is None, "Server exited"
                    try:
                        if request(urls[scope], "/api/state")[0] == 200:
                            break
                    except OSError:
                        time.sleep(.05)
                else:
                    raise AssertionError("Startup timeout")

            for scope, url in urls.items():
                before = snapshots(folders[scope])
                assert request(url, "/")[0] == 200
                assert request(url, "/media/img_0001.png")[1] == b"fixture-media"
                assert request(url, "/api/state")[1]["auth"]["can_edit"] is False
                for path in ("/api/event", "/api/delete", "/api/unlink", "/api/upload", "/api/upload-raw", "/api/check"):
                    assert request(url, path + "?area=main", {"id": "evt_0001"})[0] == 401, path
                assert snapshots(folders[scope]) == before
                assert request(url, "/api/auth/login", {"username": "editor", "password": PASSWORD}, {"Origin": "https://evil.example"})[0] == 403
                assert request(url, "/api/auth/login", {"username": "editor", "password": "wrong"})[0] == 401
                assert request(url, "/api/auth/login", {"username": "disabled", "password": PASSWORD})[0] == 401
                headers = login(url)
                assert request(url, "/api/auth", headers=headers)[1]["can_edit"] is True
                other = urls["tasks" if scope == "project" else "project"]
                assert request(other, "/api/auth", headers=headers)[1]["can_edit"] is False
                assert request(url, "/api/event?area=main", seed, {"Cookie": headers["Cookie"]})[0] == 403
                assert request(url, "/api/event?area=main", seed, dict(headers, **{"X-CSRF-Token": "wrong"}))[0] == 403
                assert request(url, "/api/event?area=main", seed, dict(headers, Origin="https://evil.example"))[0] == 403
                assert snapshots(folders[scope]) == before
                draft = copy.deepcopy(seed)
                draft["comment"] = "authenticated edit"
                assert request(url, "/api/event?area=main", draft, headers)[1]["ok"]
                assert request(url, "/api/state")[1]["инструменты"]["tasks"][0]["comment"] == draft["comment"]
                assert request(url, "/api/event?area=main", [], headers)[0] == 400
                port = int(url.rsplit(":", 1)[1])
                oversized = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                oversized.request("POST", "/api/event?area=main", body=b"", headers=dict(headers, Origin=url, **{"Content-Length": str(1024 * 1024 + 1)}))
                assert oversized.getresponse().status == 413
                oversized.close()
                status, upload, _ = request(url, "/api/upload-raw?area=main", headers=dict(headers, **{"X-Ext": "png"}), raw=b"new-media")
                assert status == 200 and upload["ok"]
                assert request(url, "/api/unlink?area=main", {"file": upload["path"]}, headers)[1]["ok"]
                image = {"filename": "test.png", "data": base64.b64encode(b"image").decode()}
                assert request(url, "/api/upload?area=main", image, headers)[1]["ok"]
                # Oversized body rejected without waiting for the advertised upload.
                port = int(url.rsplit(":", 1)[1])
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                connection.request("POST", "/api/upload-raw?area=main", body=b"", headers=dict(headers, Origin=url, **{"Content-Length": str(80 * 1024 * 1024 + 1)}))
                assert connection.getresponse().status == 413
                connection.close()
                assert request(url, "/api/auth/logout", headers=headers, raw=b"")[0] == 200
                assert request(url, "/api/event?area=main", draft, headers)[0] == 401
                assert request(url, "/api/auth", headers=headers)[1]["can_edit"] is False
                headers = login(url)
                token = headers["Cookie"].split("=", 1)[1]
                with store.connection() as db:
                    row = db.execute("SELECT token_hash FROM sessions WHERE token_hash=?", (auth.token_hash(token),)).fetchone()
                    assert row and row["token_hash"] != token
                    db.execute("UPDATE sessions SET expires=0 WHERE token_hash=?", (auth.token_hash(token),))
                assert request(url, "/api/delete?area=main", {"id": "evt_0001"}, headers)[0] == 401
                headers = login(url)
                store.set_password("editor", PASSWORD)
                assert request(url, "/api/auth", headers=headers)[1]["can_edit"] is False
                headers = login(url)
                store.disable("editor")
                assert request(url, "/api/delete?area=main", {"id": "evt_0001"}, headers)[0] == 401
                store.set_password("editor", PASSWORD)
                headers = login(url)
                assert request(url, "/api/delete?area=main", {"id": "evt_0001"}, headers)[1]["ok"]

            url = urls["project"]
            def bad_login(_):
                return request(url, "/api/auth/login", {"username": "brute-force", "password": "wrong"})[0]
            with ThreadPoolExecutor(max_workers=12) as pool:
                statuses = list(pool.map(bad_login, range(12)))
            assert statuses.count(401) == 10 and statuses.count(429) == 2, statuses
            assert request(url, "/api/auth/login", {"username": "brute-force", "password": "wrong"})[2].get("Retry-After")
            with store.connection() as db:
                assert db.execute("SELECT password_hash FROM users WHERE username='editor'").fetchone()[0] != PASSWORD.encode()
            assert (Path(store.path).stat().st_mode & 0o777) == 0o600
            print("PASS: anonymous reads; all writes protected; login, cookies, CSRF, upload limits, scope, logout, expiry, password reset, disable and concurrent throttling.")
        finally:
            for process in processes:
                process.terminate()
            for process in processes:
                process.wait(timeout=10)


if __name__ == "__main__":
    run()
raise AssertionError("Intentional CI failure")

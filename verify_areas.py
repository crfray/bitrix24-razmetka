"""Regression checks for fully independent data areas, using temporary fixtures."""
import copy
import auth
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, build_opener, ProxyHandler
urlopen = build_opener(ProxyHandler({})).open
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parent

def run():
    with tempfile.TemporaryDirectory(prefix="razmetka-areas-") as tmp:
        base, chats = Path(tmp)/"main", Path(tmp)/"chats"
        seed = {"id":"evt_0001", "tool":"tasks", "event":"task_create", "type":["task"],
                "category":"task_operations", "c_section":["tasks","crm"],
                "c_sub_section":["list"], "c_element":["create_button"], "params":{},
                "images":[{"file":"media/img_0001.png","caption":"main"}]}
        for folder in (base,chats):
            (folder/"events").mkdir(parents=True)
            (folder/"media").mkdir()
            event = copy.deepcopy(seed)
            if folder == chats:
                event["c_section"] = ["chat_tasks","project"]
                event["images"] = [{"file":"task-chats-media/img_0001.png","caption":"chats"}]
            (folder/"events/tasks.json").write_text(json.dumps({"tool":"tasks","events":[event]}),encoding="utf-8")
            (folder/"dictionaries.json").write_text(json.dumps({"\u043f\u043e\u043b\u044f":{}}),encoding="utf-8")
            (folder/"media/img_0001.png").write_bytes(b"base" if folder==base else b"chat")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1",0)); port=sock.getsockname()[1]
        store = auth.AuthStore(str(Path(tmp)/"auth.sqlite3"))
        store.set_password("test-editor", "temporary-test-password")
        env=dict(os.environ,RAZMETKA_AUTH_DB=store.path,AUTH_COOKIE_SECURE="0",PORT=str(port),RAZMETKA_DATA_DIR=str(base),TASK_CHATS_DATA_DIR=str(chats))
        proc=subprocess.Popen([sys.executable,"server.py","tasks"],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        url="http://127.0.0.1:"+str(port)
        def request(path,payload=None,headers=None):
            raw=json.dumps(payload).encode() if payload is not None else None
            req=Request(url+path,data=raw,headers=dict(auth_headers, **(headers or {})))
            try: response=urlopen(req,timeout=1)
            except HTTPError as error: response=error
            with response:
                blob=response.read()
                return response.status,json.loads(blob) if response.headers.get_content_type()=="application/json" else blob
        def snapshots(folder):
            return {str(f.relative_to(folder)):f.read_bytes() for f in folder.rglob("*") if f.is_file()}
        auth_headers = {}
        try:
            for _ in range(30):
                if proc.poll() is not None: raise AssertionError("Server failed startup")
                try:
                    if request("/api/state")[0]==200: break
                except OSError: time.sleep(.05)
            else: raise AssertionError("Startup timeout")
            login_request = Request(url+"/api/auth/login", data=json.dumps({"username":"test-editor", "password":"temporary-test-password"}).encode(), headers={"Content-Type":"application/json", "Origin":url})
            with urlopen(login_request, timeout=10) as response:
                cookie = response.headers["Set-Cookie"].split(";", 1)[0]
                csrf = json.load(response)["csrf"]
            auth_headers = {"Cookie":cookie, "Origin":url, "X-CSRF-Token":csrf}
            base_snapshot=snapshots(base)
            state=request("/api/state")[1]
            assert len(state["\u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b"]["tasks"])==1
            assert len(state["task_chats"]["tools"]["tasks"])==1
            draft=copy.deepcopy(state["task_chats"]["tools"]["tasks"][0])
            draft["comment"]="chat-only edit"
            draft["c_section"]=["chat_tasks","project","only_in_chats"]
            assert request("/api/event?area=task_chats",draft)[1]["ok"]
            assert snapshots(base)==base_snapshot, "Editing chats modified main files"
            chat_dict=json.loads((chats/"dictionaries.json").read_text(encoding="utf-8"))
            assert "only_in_chats" in json.dumps(chat_dict)
            assert "only_in_chats" not in (base/"dictionaries.json").read_text(encoding="utf-8")
            assert request("/media/img_0001.png")[1]==b"base"
            assert request("/task-chats-media/img_0001.png")[1]==b"chat"
            def check_scope(index):
                scope="?area=task_chats" if index%2 else ""
                ev=request("/api/state"+scope)[1]["\u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u044b"]["tasks"][0]
                assert (ev.get("comment")=="chat-only edit")==bool(index%2)
            with ThreadPoolExecutor(max_workers=8) as pool: list(pool.map(check_scope,range(32)))
            raw_request=Request(url+"/api/upload-raw?area=task_chats",data=b"new-image",headers=dict(auth_headers, **{"X-Ext":"png"}))
            with urlopen(raw_request,timeout=5) as response: upload=json.load(response)
            assert upload["path"].startswith("task-chats-media/")
            assert snapshots(base)==base_snapshot
            assert request("/api/delete?area=task_chats",{"id":"evt_0001"})[1]["ok"]
            assert snapshots(base)==base_snapshot, "Deleting chats modified main files/media"
            chat_snapshot=snapshots(chats)
            draft=copy.deepcopy(seed); draft["comment"]="main-only edit"
            assert request("/api/event?area=main",draft)[1]["ok"]
            assert snapshots(chats)==chat_snapshot, "Editing main modified chats files"
            assert request("/api/delete?area=main",{"id":"evt_0001"})[1]["ok"]
            assert snapshots(chats)==chat_snapshot, "Deleting main modified chats files"
            assert request("/api/state?area=unknown")[0]==400
            assert request("/api/event",seed)[0]==400
            print("PASS: independent reads, edits, deletes, dictionaries, exports, media uploads and concurrent routing.")
        finally:
            proc.terminate();proc.wait(timeout=10)

if __name__=="__main__":
    run()

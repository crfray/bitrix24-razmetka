# -*- coding: utf-8 -*-
"""Проверка целостности файлов проекта. Запуск: python check_files.py tasks

Ничего не меняет. Отвечает на один вопрос: всё ли на месте и читается.
"""
import glob
import io
import json
import os

import space

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = space.pick()["data"]
MEDIA = os.path.join(DATA, "media")

problems = []
total = 0

print("=== события ===")
for path in sorted(glob.glob(os.path.join(DATA, "events", "*.json"))):
    name = os.path.basename(path)
    try:
        data = json.load(io.open(path, encoding="utf-8"))
    except Exception as err:
        problems.append("НЕ ЧИТАЕТСЯ %s: %s" % (name, err))
        continue
    events = data.get("events")
    if not isinstance(events, list):
        problems.append("нет списка events в " + name)
        continue
    total += len(events)
    print("  %-18s %3d" % (name, len(events)))
    for event in events:
        for field in ("id", "event", "tool"):
            if not event.get(field):
                problems.append("%s: пустое поле %s" % (event.get("id", "?"), field))
print("  %-18s %3d  <- всего" % ("", total))

print()
print("=== картинки и видео ===")
refs, broken = set(), []
for path in glob.glob(os.path.join(DATA, "events", "*.json")):
    try:
        events = json.load(io.open(path, encoding="utf-8"))["events"]
    except Exception:
        continue
    for event in events:
        for img in (event.get("images") or []):
            for key in ("file", "original"):
                fname = os.path.basename(img.get(key) or "")
                if not fname:
                    continue
                refs.add(fname)
                if not os.path.isfile(os.path.join(MEDIA, fname)):
                    broken.append("%s -> %s" % (event.get("event"), fname))

on_disk = set(os.listdir(MEDIA)) if os.path.isdir(MEDIA) else set()
print("  файлов на диске:           %d" % len(on_disk))
print("  из них используется:       %d" % len(refs & on_disk))
print("  битых ссылок:              %d" % len(broken))
print("  лежит, но не используется: %d" % len(on_disk - refs))
for item in broken[:10]:
    problems.append("битая ссылка: " + item)

print()
print("=== остальные файлы ===")
for rel in ("dictionaries.json", "export.json"):
    path = os.path.join(DATA, rel)
    try:
        json.load(io.open(path, encoding="utf-8"))
        print("  %-26s читается" % rel)
    except Exception as err:
        problems.append("%s: %s" % (rel, err))
for rel in ("app/index.html", "app/app.js", "app/filters.js", "app/editor.js",
            "app/style.css", "server.py", "space.py", "GLOSSARY.md", "BACKLOG.md"):
    path = os.path.join(ROOT, rel.replace("/", os.sep))
    if os.path.isfile(path):
        print("  %-26s %d байт" % (rel, os.path.getsize(path)))
    else:
        problems.append("ФАЙЛА НЕТ: " + rel)

print()
if problems:
    print("ПРОБЛЕМЫ (%d):" % len(problems))
    for item in problems[:25]:
        print("   " + item)
else:
    print("ПОВРЕЖДЕНИЙ НЕТ: все файлы читаются, обязательные поля заполнены.")

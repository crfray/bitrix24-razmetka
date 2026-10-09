# -*- coding: utf-8 -*-
"""Проверка спеки на аномалии. Запуск: python check_anomalies.py tasks

Ничего не меняет — только находит и перечисляет.
"""
import collections
import glob
import io
import json
import os
import re

import space

ROOT = os.path.dirname(os.path.abspath(__file__))
EVENTS = os.path.join(space.pick()["data"], "events")

CYRILLIC = re.compile(r"[Ѐ-ӿ]")
LATIN = re.compile(r"[A-Za-z]")
ONLY_DIGITS = re.compile(r"^\d+$")
LIST_FIELDS = ("c_section", "c_sub_section", "c_element", "status", "measures")
PARAMS = ("p1", "p2", "p3", "p4", "p5")


def load_events():
    out = []
    for path in sorted(glob.glob(os.path.join(EVENTS, "*.json"))):
        data = json.load(io.open(path, encoding="utf-8"))
        out.extend(data["events"])
    return out


def all_values(event):
    """Пары (поле, значение) по всем спискам значений события."""
    for field in LIST_FIELDS:
        for value in (event.get(field) or []):
            yield field, value
    for field in PARAMS:
        for value in (event.get("params") or {}).get(field, []):
            yield field, value


def check(events):
    found = collections.defaultdict(list)

    def add(kind, event, detail):
        found[kind].append((event.get("event", "?"), event.get("tool", "?"), detail))

    seen_keys = {}
    for e in events:
        # 1. Смешение алфавитов внутри одного значения — невидимая глазом подмена
        for field, value in all_values(e):
            if CYRILLIC.search(value) and LATIN.search(value):
                add("Кириллица внутри латинского значения", e, field + " = " + value)

        # 2. Мусор вида "1" вместо осмысленного значения
        for field, value in all_values(e):
            if ONLY_DIGITS.match(value):
                add("Значение из одних цифр", e, field + " = " + value)

        # 3. Пробелы по краям
        for field, value in all_values(e):
            if value != value.strip():
                add("Лишние пробелы по краям", e, field + " = " + repr(value))

        # 4. Обязательные поля
        if not e.get("tool"):
            add("Не указан инструмент", e, "")
        if not e.get("description"):
            add("Нет описания сценария", e, "")
        if not e.get("category"):
            add("Не указана категория", e, "")

        # 5. Конвенция: не-projects внутри проекта помечается project в c_section
        if e.get("tool") and e["tool"] != "projects":
            sections = " ".join(e.get("c_section") or [])
            if "project" not in sections:
                add("Нет признака принадлежности к проекту", e,
                    "c_section = " + (sections or "пусто"))

        # 6. Одинаковый ключ события в одном инструменте
        key = (e.get("tool"), e.get("event"),
               tuple(sorted(e.get("c_section") or [])),
               tuple(sorted(e.get("c_sub_section") or [])))
        if key in seen_keys:
            add("Дубль: те же имя и контекст", e, "совпадает с " + seen_keys[key])
        else:
            seen_keys[key] = e.get("id", "?")

        # 7. Параметр объявлен, но не описан
        for field in PARAMS:
            for value in (e.get("params") or {}).get(field, []):
                if value.strip().upper() == "JSON":
                    add("Параметр объявлен как JSON, структура не описана", e,
                        field + " = JSON")

        # 8. Значение-шаблон без префикса — нечего подставлять
        for field, value in all_values(e):
            if value.endswith("_") and len(value) < 3:
                add("Пустой шаблон значения", e, field + " = " + value)

    return found


def main():
    events = load_events()
    found = check(events)
    print("событий проверено:", len(events))
    print()
    if not found:
        print("аномалий не найдено")
        return found
    for kind in sorted(found, key=lambda k: -len(found[k])):
        rows = found[kind]
        print("%-46s %d" % (kind, len(rows)))
        for name, tool, detail in rows[:4]:
            print("      %-28s %-10s %s" % (name[:28], tool, detail[:60]))
        if len(rows) > 4:
            print("      … ещё %d" % (len(rows) - 4))
        print()
    return found


if __name__ == "__main__":
    main()

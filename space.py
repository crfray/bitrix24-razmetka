# -*- coding: utf-8 -*-
"""Пространства инструмента: у проектов и задач свои данные, порт и исходный Excel.

Имя пространства — первый аргумент любого скрипта: python server.py tasks.
Без него скрипт не запускается: угадывать папку опасно, импорт её стирает.
"""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DOWNLOADS = os.path.join(os.path.expanduser("~"), "Downloads")

SPACES = {
    # type_list: у задач type - список (task, task_mini, quick_task…), у проектов - одно значение.
    # lights: светофор на каждом значении type и c_* - работает / частично / не работает.
    "project": {"title": "Проекты", "data": "data-project", "port": 8765, "type_list": False,
                "lights": False, "src": os.path.join(DOWNLOADS, "Проекты 2.0 (2).xlsx")},
    "tasks": {"title": "Задачи", "data": "data-tasks", "port": 8766, "type_list": True,
              "lights": True, "src": os.path.join(DOWNLOADS, "Разметка задач 2.0 (3).xlsx")},
}


def pick():
    name = sys.argv[1] if len(sys.argv) > 1 else ""
    if name not in SPACES:
        sys.exit("Укажите пространство: %s. Например: python %s tasks"
                 % (", ".join(SPACES), os.path.basename(sys.argv[0])))
    conf = dict(SPACES[name], name=name)
    conf["data"] = os.path.join(ROOT, conf["data"])
    return conf

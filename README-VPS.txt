Разметка 2.0 — перенос текущего состояния на Linux VPS

Доработка авторизации: см. README-AUTH.md. Без входа разрешён только просмотр;
редактора создать через python3 auth.py set-password editor. Для HTTPS Secure-cookie
включена по умолчанию; для локального HTTP требуется AUTH_COOKIE_SECURE=0.
MANIFEST.json описывает исходный архив до доработки: после изменения кода его
проверка ожидаемо показывает изменённые файлы.

8765: проекты (data-project).
8766: задачи (data-tasks), включая отдельный раздел «Чаты задач» (data-task-chats).
В архиве код и данные работающих приложений, словари и медиафайлы.
Код server.py, space.py и app скопирован без изменений.
Импорт из Excel для запуска НЕ нужен. Запускать import_xlsx.py не требуется.
Основной сервер использует только стандартную библиотеку Python; рекомендуемый
минимум пакета — Python 3.11. Экспорт в Excel отдельно требует openpyxl.

1. Передать архив на VPS (подставить пользователя, адрес и локальный путь):
   scp razmetka-vps-*.zip USER@VPS:/tmp/

2. На VPS с Ubuntu/Debian и systemd:
   sudo apt-get update
   sudo apt-get install -y python3 unzip
   python3 --version
   sudo unzip /tmp/ИМЯ_АРХИВА.zip -d /opt

   Команда распаковки рассчитана на НОВУЮ установку: каталог
   /opt/razmetka-2.0 не должен содержать существующее приложение.

3. Создать пользователя и выдать права на сохранение JSON/медиа:
   id razmetka || sudo useradd --system --user-group --home-dir /opt/razmetka-2.0 --shell /usr/sbin/nologin razmetka
   sudo chown -R razmetka:razmetka /opt/razmetka-2.0

4. Проверить целостность поставки ДО запуска и правок:
   cd /opt/razmetka-2.0
   python3 verify_manifest.py

5. Установить два сервиса:
   sudo cp deploy/razmetka-project.service deploy/razmetka-tasks.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now razmetka-project.service razmetka-tasks.service
   sudo systemctl status razmetka-project.service razmetka-tasks.service --no-pager

6. Проверить ответы:
   curl -f http://127.0.0.1:8765/api/state
   curl -f http://127.0.0.1:8766/api/state

7. Доступ с компьютера через SSH (терминал оставить открытым):
   ssh -N -o ExitOnForwardFailure=yes -L 8765:127.0.0.1:8765 -L 8766:127.0.0.1:8766 USER@VPS
   Открыть http://localhost:8765 и http://localhost:8766.
   Если локальные 8765/8766 заняты текущими приложениями, использовать:
   ssh -N -o ExitOnForwardFailure=yes -L 18765:127.0.0.1:8765 -L 18766:127.0.0.1:8766 USER@VPS
   Тогда открыть http://localhost:18765 и http://localhost:18766.

Серверы слушают 127.0.0.1, как на исходном компьютере. Доступ к ним идёт через SSH;
открывать 8765/8766 в firewall не требуется. Для публичного домена понадобится
отдельно настроить reverse proxy и HTTPS. Авторизация редакторов описана в README-AUTH.md.

Логи:
   sudo journalctl -u razmetka-project -u razmetka-tasks -n 100 --no-pager

Данные хранятся в трёх папках data-*. Правки на VPS сохраняются там и автоматически
не синхронизируются с исходным компьютером. При обновлении кода сохранить эти папки.
Резервная копия (остановить оба сервиса для согласованного снимка):
   sudo systemctl stop razmetka-project razmetka-tasks
   sudo tar -czf /opt/razmetka-data-$(date +%Y%m%d-%H%M%S).tar.gz -C /opt/razmetka-2.0 data-project data-tasks data-task-chats
   sudo systemctl start razmetka-project razmetka-tasks

Для ручного запуска из распакованного каталога, в двух терминалах:
   python3 server.py project
   python3 server.py tasks

Не запускать одновременно ручной процесс и systemd на одном порту.
Снимок и результаты локальной проверки: SNAPSHOT.json.
MANIFEST.json содержит SHA-256 всех файлов поставки (кроме самого манифеста).

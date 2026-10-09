# Локальный запуск через Docker Compose

Выполнять команды из корня приложения. Docker Desktop должен быть запущен.

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps -a
```

- Проекты: http://localhost:8765
- Задачи и чаты задач: http://localhost:8766

Порты опубликованы только на 127.0.0.1. Это локальная конфигурация с HTTP;
AUTH_COOKIE_SECURE=0 применяется только здесь. На сервер её переносить как
production-конфигурацию нельзя: сначала настроить HTTPS и Secure-cookie.

## Что делает Compose

| Сервис | Назначение |
|---|---|
| init-data | Однократно копирует исходные data-* в постоянные тома и назначает UID/GID 10001 |
| project | Запускает python server.py project, порт компьютера 8765 → порт контейнера 8000 |
| tasks | Запускает python server.py tasks, порт компьютера 8766 → порт контейнера 8000 |

init-data должен завершиться с кодом 0 до запуска приложений. Его статус Exited (0)
нормален. У него отключён healthcheck; у приложений действует healthcheck из Dockerfile.
Проверка здоровья не является автоматическим перезапуском зависшего процесса.

Тома project-data, tasks-data, chats-data хранят JSON и медиа; auth-data — общую
SQLite редакторов и сессий. Имена Docker получают префикс razmetka-local_.
Данные внутри томов отделены от исходных файлов на компьютере. Изменения в интерфейсе
не переписывают исходные data-* и не попадают в Git автоматически.

Метка .initialized предотвращает повторный импорт при обновлении/пересоздании
контейнеров. Если импорт был прерван, скрипт откажется писать поверх непустого тома:
сначала проверить его содержимое. Исходники подключены init-data только на чтение.

## Создание редактора

```sh
docker compose exec project python auth.py set-password editor
```

Ввести пароль скрыто дважды. Учётная запись общая для обоих приложений, вход
в каждом выполняется отдельно. Просмотр работает без редактора.

```sh
docker compose exec project python auth.py list
docker compose exec project python auth.py disable editor
```

## Обновление, логи и остановка

```sh
docker compose up -d --build
docker compose logs --tail=50 project tasks
docker compose down
```

Обычный down сохраняет именованные тома. Не добавлять -v: он удаляет тома вместе
с правками, медиа и пользователями. Тома не заменяют резервные копии.

Для проверки пересоздания без удаления данных:

```sh
docker compose up -d --force-recreate project tasks
```

После этого открыть страницу: ранее сохранённые правки и редактор должны остаться.
Все операции работают локально; настройки VPS, CI/CD и мониторинг добавляются отдельно.

## Один адрес с /projects/ и /tasks/

Для локальной проверки Nginx:

```sh
docker compose -f compose.yaml -f compose.proxy.yaml up -d --build --wait
docker compose -f compose.yaml -f compose.proxy.yaml exec gateway nginx -t
```

- http://localhost:8080/projects/
- http://localhost:8080/tasks/

Корневой адрес перенаправляет на /projects/. Frontend формирует пути API,
авторизации и медиа относительно пути приложения. Nginx удаляет префикс
перед отправкой запроса в соответствующий Python-сервис. Прямые локальные
порты 8765 и 8766 также работают.

Ограничение запросов: 20 запросов/с на IP с burst 40; вход — 1 запрос/с
с burst 5. Превышение возвращает 429. Это базовое ограничение частоты,
а не полноценная защита от ботов. HTTPS в этом локальном варианте отсутствует.
При дальнейших up/down использовать оба файла, чтобы управлять gateway.

## Установка Docker на Ubuntu 24.04 VPS

Скрипт deploy/bootstrap-vps.sh устанавливает Docker Engine и Compose из
официального APT-репозитория Docker. Проверить файл перед запуском:

```sh
sudo bash bootstrap-razmetka-vps.sh
```

Скрипт запускается на VPS, где предварительно размещён файл. Пароль sudo
вводится только в терминале. Команды Docker после установки пока выполняются
через sudo. Следующий этап — отдельная конфигурация публикации с HTTPS.

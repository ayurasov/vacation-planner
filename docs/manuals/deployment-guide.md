# О руководстве

Руководство предназначено для системного администратора, который устанавливает и обслуживает «Планировщик отпусков» на сервере организации: требования, установка, настройка, обновление, резервное копирование и восстановление, проверка работоспособности и устранение неполадок.

Архитектура стенда описана в «Описании архитектуры», конвейеры и порядок выпуска — в документе 7.

![Контейнеры стенда](../images/a02-containers.png)

# Требования

| Ресурс | До 1000 пользователей | До 5000 пользователей |
|---|---|---|
| Процессор | 2 vCPU | 4 vCPU; PostgreSQL на отдельном узле |
| Память | 4 ГБ | 8 ГБ на узел приложения |
| Диск | 20 ГБ SSD (данные и копии за 14 дней) | 50 ГБ SSD |
| ОС | Linux x86-64 с Docker Engine 24+ и Docker Compose v2 | то же |
| Сеть | Обратный прокси организации с TLS на 443 → стенд на 80 | балансировщик перед экземплярами `server` |

Клиенты — две последние версии Chrome, Edge, Firefox или Safari; на телефонах — мобильные браузеры.

# Установка

1. Получите исходный код версии:

```bash
git clone <адрес репозитория> vacation-planner
cd vacation-planner
git checkout v0.3.0
```

2. Создайте файл `.env` рядом с `docker-compose.yml`:

```bash
# Секрет подписи токенов: случайная строка не короче 32 символов
JWT_SECRET=<результат openssl rand -base64 48>
# Резервные копии: интервал в секундах и срок хранения в днях
BACKUP_INTERVAL=86400
BACKUP_KEEP_DAYS=14
```

3. Запустите стенд:

```bash
docker compose --profile full up -d --build
```

При первом старте контейнер `server` применяет миграции базы данных. Стенд отвечает на порту 80; прокси организации публикует его по HTTPS.

4. Создайте первого администратора. Для демонстрационного стенда загрузите демо-данные (131 сотрудник; администратор `yurasov.av`):

```bash
docker compose exec server npm run db:seed:prod
```

Для рабочего контура демо-данные не загружайте: создайте администратора SQL-скриптом из раздела «Обслуживание», затем остальных сотрудников — в интерфейсе.

5. Проверьте работоспособность (раздел «Проверка») и смените пароль администратора.

# Настройка

| Переменная | Где | Назначение | По умолчанию |
|---|---|---|---|
| `JWT_SECRET` | `server` | Секрет подписи access-токенов; не короче 32 символов, иначе сервер не стартует | — |
| `DATABASE_URL` | `server` | Строка подключения PostgreSQL; параметр `connection_limit` задаёт размер пула | из compose |
| `TRUST_PROXY` | `server` | Каким прокси доверять при определении адреса клиента (влияет на ограничение частоты входа) | `loopback, linklocal, uniquelocal` |
| `PORT` | `server` | Порт API внутри сети compose | 8080 |
| `BACKUP_INTERVAL` | `backup` | Интервал резервного копирования, секунд | 86400 |
| `BACKUP_KEEP_DAYS` | `backup` | Срок хранения копий, дней | 14 |
| `SEED_DEMO` | seed | `0` — не создавать демо-заявки на согласовании | — |

**Обратный прокси.** Прокси организации должен передавать `X-Forwarded-For` и находиться в частной сети (10/8, 172.16/12, 192.168/16). Если прокси с публичным адресом, укажите его в `TRUST_PROXY`, иначе ограничение частоты входа будет считать всех пользователей одним клиентом.

**HTTPS.** Cookie сессии получает признак `Secure` в production — стенд должен открываться только по HTTPS.

**Заголовки безопасности.** nginx контейнера `web` отдаёт Content Security Policy и запрет встраивания во фреймы. Не добавляйте на прокси собственную CSP, которая разрешает inline-скрипты.

# Проверка

```bash
docker compose --profile full ps                                   # все сервисы running/healthy
curl -s http://localhost/api/v1/employees -o /dev/null -w '%{http_code}\n'   # 401 — API за nginx отвечает
docker compose exec server wget -qO- http://localhost:8080/readyz  # {"ok":true} — БД доступна
docker compose logs backup --tail 5                                # backup: /backups/vacation-….dump
```

После этого войдите в интерфейс и откройте «График отпусков», «Справочники → Производственный календарь» (календарь года загружен) и «Журнал аудита».

# Обновление

1. Прочитайте `docs/versions.md` и `CHANGELOG.md` новой версии: особые шаги и изменения схемы.
2. Сделайте внеочередную резервную копию (раздел «Резервное копирование»).
3. Получите новую версию и пересоберите стенд:

```bash
git fetch --tags && git checkout v0.x.y
docker compose --profile full up -d --build
```

4. Миграции применятся при старте `server`. Выполните проверку.

Откат: вернитесь на предыдущий тег и восстановите копию, снятую перед обновлением, — миграции не откатываются автоматически.

# Резервное копирование

Сервис `backup` снимает копию `pg_dump` в формате custom раз в `BACKUP_INTERVAL` секунд и хранит её `BACKUP_KEEP_DAYS` дней в томе `db-backups`. Файл сначала пишется во временный и переименовывается только после успешного завершения, поэтому в томе нет оборванных копий.

```bash
# Список копий
docker compose exec backup ls -lh /backups
# Внеочередная копия
docker compose exec backup sh -c 'pg_dump -Fc -f /backups/vacation-manual-$(date +%Y%m%d-%H%M).dump'
# Копия на хранилище вне сервера
docker compose cp backup:/backups/<файл>.dump ./
```

Храните копии и вне сервера: том `db-backups` находится на том же диске, что и база.

## Восстановление

```bash
docker compose --profile full stop server web
docker compose exec postgres dropdb -U vacation vacation
docker compose exec postgres createdb -U vacation vacation
docker compose cp ./<файл>.dump postgres:/tmp/restore.dump
docker compose exec postgres pg_restore -U vacation -d vacation /tmp/restore.dump
docker compose --profile full start server web
```

## Ежемесячная проверка восстановления

Раз в месяц восстановите последнюю копию в отдельную базу и сверьте данные:

```bash
docker compose exec postgres createdb -U vacation restore_check
docker compose exec backup sh -c 'pg_restore -d restore_check $(ls -t /backups/*.dump | head -1)'
docker compose exec postgres psql -U vacation -d restore_check -c 'select count(*) from employees; select count(*) from vacation_requests;'
docker compose exec postgres dropdb -U vacation restore_check
```

Результат проверки фиксируйте в журнале эксплуатации.

# Обслуживание

**Производственный календарь на новый год.** Праздники хранятся данными:

```sql
INSERT INTO calendars (year, holidays, transfers)
VALUES (2028, '["2028-01-01","2028-01-02", "…"]', '[]')
ON CONFLICT (year) DO UPDATE SET holidays = EXCLUDED.holidays, transfers = EXCLUDED.transfers;
```

Выполните через `docker compose exec postgres psql -U vacation -d vacation`.

**Первый администратор на рабочем контуре.** Получите scrypt-хеш временного пароля средствами самого сервера:

```bash
docker compose exec server node -e "console.log(require('./dist/auth/passwords').hashPassword(process.argv[1]))" '<временный пароль>'
```

и создайте учётную запись:

```sql
INSERT INTO employees (login, password_hash, name, is_admin, updated_at)
VALUES ('admin', '<хеш из предыдущей команды>', 'Администратор системы', true, now());
```

После первого входа смените пароль в интерфейсе и заведите остальных сотрудников в разделе «Сотрудники».

**Журналы.** `docker compose logs -f server` — API; `web` — запросы nginx; `backup` — результат копирования.

# Устранение неполадок

| Признак | Причина и действие |
|---|---|
| `server` перезапускается, в журнале «JWT_SECRET» | Секрет не задан или короче 32 символов — задайте в `.env` |
| `/readyz` не отвечает | PostgreSQL недоступен — `docker compose ps postgres`, свободное место на диске |
| У всех пользователей «Слишком много попыток входа» | Прокси с публичным адресом не входит в `TRUST_PROXY` — все запросы выглядят одним клиентом |
| После обновления пустой экран | Кеш браузера держит старый `index.html` за прокси — `index.html` отдаётся с `no-cache`, проверьте, что прокси не кеширует его |
| Дни отпуска считаются календарными | Не загружен производственный календарь года — раздел «Обслуживание» |
| `backup: ОШИБКА` в журнале | Нет места на томе или нет доступа к БД — проверьте `docker compose logs postgres` |

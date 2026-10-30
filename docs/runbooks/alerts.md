# О документе

Регламент действий по каждому оповещению мониторинга «Планировщика отпусков» 1.0.0 (E52-04): что значит оповещение, порог, команды первых 5 минут, вероятные причины, действие и условия эскалации. Правила — `deploy/monitoring/alerts.yml` (15 правил), сбор — `deploy/monitoring/prometheus.yml`, панель — `deploy/monitoring/grafana-dashboard.json`; справочник — «Руководство по развёртыванию», раздел «Мониторинг».

Этот регламент отвечает на вопрос «что делать сейчас». Разбор причины замедлений и ошибок — таблица «Симптом → метрика → причина → действие», команды и профилирование в `docs/runbooks/diagnostics.md`; здесь на них даются ссылки, а не копии.

# Когда применять

Сработало правило из `deploy/monitoring/alerts.yml` в Prometheus стенда (профиль `monitoring`, `http://127.0.0.1:9090` на узле стенда, вкладка «Alerts») или в Prometheus организации, куда перенесены задание `vacation-planner` и файл правил. Сбой без оповещения (жалоба пользователя) — `diagnostics.md`.

# Перед началом

| Что нужно | Подробности |
|---|---|
| Доступ | SSH к узлу стенда, право запускать `docker`; Prometheus (`http://127.0.0.1:9090` — через SSH-туннель) и Grafana организации с панелью «Планировщик отпусков» |
| Кто | Дежурный администратор стенда; эскалация — ответственный за систему, администратор БД, разработчики (поддержка правообладателя), служба ИБ |
| Утилиты | `curl`, `jq` |
| Время | Первые 5 минут — сбор сведений по командам ниже; критичные оповещения — сразу, предупреждения — в рабочее время |

Команды выполняются из каталога стенда. Задайте переменные и функции один раз в сеансе:

```bash
C="docker compose"                                                         # стенд без реплики
C="docker compose -f docker-compose.yml -f docker-compose.replica.yml"     # стенд с репликой и архивом WAL
metrics() { $C exec -T server sh -c 'wget -qO- --header "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:8080/metrics'; }
db() { $C exec -T postgres psql -U vacation -d vacation -c "$1"; }
```

После переключения на реплику (`failover.md`) основным сервером работает `postgres-replica` — подставьте его в `db()` и в команды с `postgres`. На стенде с репликой не запускайте `docker compose up` без второго файла: `postgres` будет пересоздан без архивирования WAL.

Общая картина за минуту:

```bash
$C --profile full ps                                                         # все running, postgres healthy
metrics | grep -E '^vp_(db_up|process_count|eventloop_lag_p99_seconds|db_connections|db_max_connections)[ {]'
df -h "$(docker info -f '{{.DockerRootDir}}')"                              # место на диске томов
```

# Сводка

| Оповещение | Важность | Условие | Держится | Раздел |
|---|---|---|---|---|
| `VacationApiDown` | critical | `up{job="vacation-planner"} == 0` | 2 мин | «Доступность» |
| `VacationDatabaseDown` | critical | `max(vp_db_up) == 0` | 1 мин | «Доступность» |
| `VacationServerErrors` | warning | Доля ответов 5xx за 5 минут > 1 % | 5 мин | «Ошибки и задержки» |
| `VacationReadLatencyHigh` | warning | p95 GET за 5 минут > 300 мс | 10 мин | «Ошибки и задержки» |
| `VacationWriteLatencyHigh` | warning | p95 POST, PUT, PATCH, DELETE за 5 минут > 500 мс | 10 мин | «Ошибки и задержки» |
| `VacationEventLoopLag` | warning | `vp_eventloop_lag_p99_seconds` > 0,2 с у экземпляра | 5 мин | «Ошибки и задержки» |
| `VacationDatabaseOverloaded` | warning | Рост `vp_db_errors_total` за 5 минут по коду | сразу | «База данных» |
| `VacationConnectionsNearLimit` | warning | Соединения с БД > 80 % `max_connections` | 5 мин | «База данных» |
| `VacationIdleInTransaction` | warning | Соединений `idle in transaction` > 5 | 5 мин | «База данных» |
| `VacationMailStuck` | warning | Старейшее неотправленное письмо > 30 мин | 10 мин | «Почта и задачи» |
| `VacationMailFailed` | info | Новые письма с исчерпанными попытками за час | сразу | «Почта и задачи» |
| `VacationDigestNotRun` | warning | Еженедельной сводки не было > 8 суток | сразу | «Почта и задачи» |
| `VacationReplicaDisconnected` | warning | Слот репликации не используется | 5 мин | «Реплика и архив WAL» |
| `VacationReplicaLagging` | warning | Отставание реплики > 300 с | 5 мин | «Реплика и архив WAL» |
| `VacationWalArchiveFailing` | critical | Архивирование WAL завершается ошибкой | 10 мин | «Реплика и архив WAL» |

# Доступность

## VacationApiDown

**Что значит.** Prometheus 2 минуты не может забрать `/metrics` у экземпляра `server`. Обычно API недоступен и пользователям; иногда сломан только сбор метрик.

**Порог.** `up{job="vacation-planner"} == 0` в течение 2 минут; critical.

**Первые 5 минут.**

```bash
$C --profile full ps server web
docker inspect --format '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} finished={{.State.FinishedAt}}' $($C --profile full ps -aq server)
$C logs --no-log-prefix --since 15m server | tail -30
$C exec server wget -qO- http://localhost:8080/healthz                       # {"ok":true} — процесс жив
curl -s http://localhost/api/v1/employees -o /dev/null -w '%{http_code}\n'   # 401 — пользователи обслуживаются
```

| Признак | Вероятная причина | Действие |
|---|---|---|
| `server` — `exited`, в журнале «JWT_SECRET не задан или короче 32 символов» | Секрет не задан или короче 32 символов | Задайте `JWT_SECRET` в `.env`, `$C --profile full up -d server` |
| `exited`, `"msg":"API не запустился"` с ошибкой Prisma или миграции | БД недоступна при старте или миграция упала после обновления | БД — раздел `VacationDatabaseDown`; миграция — `update.md`, «Откат» |
| `exited`, `"msg":"Процессы API падают слишком часто — останов"` | Процессы API падают чаще 5 раз в минуту; политики перезапуска в compose нет, контейнер остаётся остановленным | Сохраните журнал (`$C logs --no-log-prefix --timestamps server > server-crash.log`), строки `"level":"error"` перед остановом — разработчикам; `$C --profile full up -d server` |
| `oom=true` | Процессам API не хватило памяти | `free -g`, метрика `process_resident_memory_bytes`; рост памяти часами — строка «Память процесса API растёт» в `diagnostics.md`; `$C --profile full up -d server` |
| Все контейнеры `exited` после перезагрузки узла | В compose нет политики перезапуска — стенд не поднимается сам | `$C --profile full up -d` (и `--profile monitoring`, если Prometheus на стенде) |
| `server` работает, `healthz` и `curl` отвечают | Сломан только сбор: задан `METRICS_TOKEN`, а в `prometheus.yml` не раскомментирован блок `authorization`; Prometheus организации не видит `server:8080` | Текст ошибки — Prometheus, «Status → Targets»; токен — в файл рядом с конфигурацией по комментарию в `prometheus.yml` |
| `server` работает, `healthz` не отвечает | Процессы зависли | Снимите метрики и журнал для разработчиков, затем `$C --profile full restart server` |

**Эскалация.** API не восстановлен за 15 минут — ответственному за систему. Падения процессов, ошибки миграции, нехватка памяти — разработчикам с журналом `server` и сведениями из раздела «Что передать разработчику» `diagnostics.md`.

## VacationDatabaseDown

**Что значит.** `server` жив, но запрос показателей БД завершается ошибкой: пользователи получают `503` «Сервис перегружен. Повторите через несколько секунд.». Если недоступен и `server`, это правило молчит — работает `VacationApiDown`.

**Порог.** `max(vp_db_up) == 0` в течение 1 минуты; critical.

**Первые 5 минут.**

```bash
$C ps postgres
$C logs --since 15m postgres | tail -40
$C exec postgres pg_isready -U vacation -d vacation
$C exec server wget -qO- http://localhost:8080/readyz
df -h "$(docker info -f '{{.DockerRootDir}}')"
```

| Признак | Вероятная причина | Действие |
|---|---|---|
| `postgres` перезапускается, в журнале «No space left on device» | Кончилось место на диске | Освободите место: вынесите старые копии из `db-backups` на внешнее хранилище, удалите неиспользуемые образы (`docker image prune`). Файлы каталога данных и `pg_wal` вручную не удаляйте. Затем `$C up -d postgres` |
| `postgres` — `exited` после перезагрузки узла | В compose нет политики перезапуска | `$C --profile full up -d` |
| В журнале «PANIC», «invalid page», «could not read block» | Повреждение данных или отказ диска | Не перезапускайте по кругу. Стенд с репликой — `failover.md`; без реплики — `backup-restore.md`, «Полное восстановление» |
| `pg_isready` отвечает, `readyz` — нет; в журнале `postgres` «too many clients already» | Исчерпан `max_connections` | Раздел `VacationConnectionsNearLimit` |
| `readyz` не отвечает после переключения на реплику | `server` смотрит на старый узел | `$C exec server printenv DATABASE_URL`; `failover.md`, шаги 4–5 |
| Растёт `pg_wal`, на стенде с репликой сработал `VacationWalArchiveFailing` | WAL не архивируется и заполняет диск | Раздел `VacationWalArchiveFailing` |

**Эскалация.** БД не отвечает 15 минут (RTO, ADR-014) — ответственному за систему для решения о переключении на реплику или восстановлении; признаки повреждения данных — сразу администратору БД.

# Ошибки и задержки

## VacationServerErrors

**Что значит.** Больше 1 % ответов API — ошибки 5xx. Считаются ответы самого `server`: `500` (необработанная ошибка) и `503 service-unavailable` (перегрузка или недоступность БД); ошибки nginx `502`/`504` сюда не попадают. В журнале `server` необработанная ошибка — строка `"msg":"unhandled error"` со стеком (в описании оповещения она названа «Необработанная ошибка»).

**Порог.** `sum(rate(vp_http_requests_total{code=~"5.."}[5m])) / sum(rate(vp_http_requests_total[5m])) > 0.01` в течение 5 минут; warning.

**Первые 5 минут.**

```bash
$C logs --no-log-prefix --since 15m server \
  | jq -rR 'fromjson? | select(.status >= 500) | "\(.status) \(.method) \(.route)"' | sort | uniq -c | sort -rn | head
$C logs --no-log-prefix --since 15m server \
  | jq -cR 'fromjson? | select(.msg=="unhandled error") | {ts, reqId, error}' | tail -5
$C logs --no-log-prefix --since 15m server \
  | jq -rR 'fromjson? | select(.msg=="database unavailable") | .code' | sort | uniq -c
```

| Признак | Вероятная причина | Действие |
|---|---|---|
| `503` по многим маршрутам, есть строки `database unavailable` | Перегрузка или недоступность БД | Раздел `VacationDatabaseOverloaded` или `VacationDatabaseDown` |
| `500` на одном маршруте, `unhandled error` со стеком | Дефект кода или данных | Поиск по коду запроса и комплект для разработчика — `diagnostics.md`, «Жалоба пользователя с кодом запроса» и «Что передать разработчику»; сообщите кадровой службе обходной путь |
| `500` начались сразу после обновления | Ошибка новой версии | `update.md`, «Откат» — решение ответственного |

**Эскалация.** Ошибка мешает входу, подаче или согласованию заявки, графику или кадровому учёту и нет обходного пути — разработчикам с высоким приоритетом; остальные `unhandled error` — разработчикам в рабочем порядке.

## VacationReadLatencyHigh

**Что значит.** 95 % запросов чтения медленнее 300 мс — нарушено требование к задержкам. Потоки событий (SSE) в расчёт не входят.

**Порог.** `histogram_quantile(0.95, …{method="GET"}) > 0.3` в течение 10 минут; warning.

**Первые 5 минут.**

```bash
$C logs --no-log-prefix --since 1h server \
  | jq -rR 'fromjson? | select(.msg=="slow request") | .route' | sort | uniq -c | sort -rn | head
metrics | grep -E '^(vp_eventloop_lag_p99_seconds|vp_process_count|vp_db_connections)[ {]'
docker stats --no-stream
```

В Grafana — панели «Задержка p95 по маршрутам», «Процессор, занятые ядра», «Соединения с БД».

**Вероятные причины и действие.** Причина выбирается по строкам таблицы «Симптом → метрика → причина → действие» в `diagnostics.md`: не хватает ядер API, дорогой запрос к БД, долгая транзакция держит блокировку, медленный один экран. После массового изменения данных (импорт, массовое согласование) возможен короткий всплеск перечитываний графика — проходит сам за минуты.

**Эскалация.** Держится дольше 30 минут в рабочее время или причина — в плане запроса или коде — разработчикам с выдержкой `top-queries.sql`, графиками и журналом (`diagnostics.md`, «Что передать разработчику»).

## VacationWriteLatencyHigh

**Что значит.** 95 % изменяющих запросов медленнее 500 мс. Сюда входит вход `POST /api/v1/auth/login`: проверка пароля намеренно дорогая, и утренняя волна входов или вход после рассылки поднимает p95 записи.

**Порог.** `histogram_quantile(0.95, …{method=~"POST|PUT|PATCH|DELETE"}) > 0.5` в течение 10 минут; warning.

**Первые 5 минут.**

```bash
$C logs --no-log-prefix --since 1h server \
  | jq -rR 'fromjson? | select(.msg=="slow request" and .method != "GET") | "\(.method) \(.route)"' | sort | uniq -c | sort -rn | head
metrics | grep -E '^(vp_eventloop_lag_p99_seconds|vp_db_connections)[ {]'
```

Ожидания блокировок — запрос «Активные запросы и кто кого ждёт» из `diagnostics.md`.

| Признак | Вероятная причина | Действие |
|---|---|---|
| Медленный только `/api/v1/auth/login`, утро или после рассылки | Массовый вход | Ожидаемо; если так при обычной нагрузке — строка «Вход дольше секунды» в `diagnostics.md` |
| Медленны изменения заявок, есть `blocked_by` | Долгая транзакция держит блокировку | Раздел `VacationIdleInTransaction` |
| Медленный `/api/v1/imports/employees` | Импорт большого файла | Ожидаемо на время импорта |
| Медленно всё, ядра свободны | Дорогие запросы к БД или диск | `diagnostics.md`, `top-queries.sql` |

**Эскалация.** Как у `VacationReadLatencyHigh`.

## VacationEventLoopLag

**Что значит.** Процессы API заняты долгими синхронными операциями или им не хватает процессора: любой запрос ждёт своей очереди дольше 200 мс.

**Порог.** `max by (instance) (vp_eventloop_lag_p99_seconds) > 0.2` в течение 5 минут; warning.

**Первые 5 минут.**

```bash
metrics | grep -E '^(vp_eventloop_lag_p99_seconds|vp_eventloop_lag_max_seconds|vp_process_count|process_cpu_seconds_total|process_resident_memory_bytes) '
$C exec server printenv WEB_CONCURRENCY
nproc
docker stats --no-stream
```

| Признак | Вероятная причина | Действие |
|---|---|---|
| Занятые ядра (`rate(process_cpu_seconds_total[5m])`) близки к числу процессов | Не хватает ядер | Строка «Медленно у всех» в `diagnostics.md`; ядра или второй экземпляр — руководство, «Производительность» |
| Контейнеру выделена часть ядер квотой, `WEB_CONCURRENCY=auto` | `auto` видит все ядра узла — процессов больше, чем ядер | Задайте `WEB_CONCURRENCY` числом в `.env`, `$C --profile full up -d server` |
| Ядра свободны, задержка держится | Долгая синхронная операция | Профиль процессора — `diagnostics.md`, «Профиль процессора и снимок памяти» |
| Растёт `process_resident_memory_bytes` | Давление памяти | Строка «Память процесса API растёт» в `diagnostics.md` |

**Эскалация.** Задержка при свободных ядрах — разработчикам с профилем процессора.

# База данных

## VacationDatabaseOverloaded

**Что значит.** Запросы API получили ошибку доступа к БД; пользователи видят `503` «Сервис перегружен». Метка `code` — код Prisma.

**Порог.** `sum by (code) (increase(vp_db_errors_total[5m])) > 0` — без задержки, с первой ошибки; warning.

**Первые 5 минут.**

```bash
metrics | grep -E '^vp_db_(errors_total|connections|max_connections)'
db "select state, count(*) from pg_stat_activity where datname = current_database() group by 1"
```

Долгие запросы и блокировки — запрос «Активные запросы и кто кого ждёт» в `diagnostics.md`.

| Код | Причина | Действие |
|---|---|---|
| `P2024` | Нет свободного соединения в пуле процесса | Сначала долгие запросы в `pg_stat_activity`; если их нет — пул мал для нагрузки: строка «Сервис перегружен» в `diagnostics.md`, размер пула — ниже |
| `P2028` | Транзакция не началась или не завершилась вовремя | Блокировки и долгие транзакции — раздел `VacationIdleInTransaction` |
| `P1001`, `P1002`, `P1017` | БД недоступна или разорвала соединение | Единичные — при перезапуске `postgres` (обновление, переключение), ожидаемо; повторяются — раздел `VacationDatabaseDown` |

Размер пула на процесс — `DB_POOL_SIZE` (по умолчанию min(10, 40 / процессов), не меньше 3). Файл `docker-compose.yml` не передаёт эту переменную из `.env` в контейнер — задайте её в `docker-compose.override.yml` рядом с `docker-compose.yml`, как в `diagnostics.md`, и выполните `$C --profile full up -d server`. Без `-f` compose читает этот файл сам; на стенде с репликой добавьте в `$C` третий файл: `-f docker-compose.override.yml`.

```yaml
services:
  server:
    environment:
      DB_POOL_SIZE: 5
```

**Эскалация.** Повторяющиеся `P2028` без внешней причины — разработчикам (транзакция в коде держит соединение); `P2024` после настройки пула — ответственному за систему: нужна мощность (руководство, «Производительность»).

## VacationConnectionsNearLimit

**Что значит.** Соединений с базой планировщика больше 80 % `max_connections`: следующий процесс или экземпляр получит «too many clients». Считаются все клиентские соединения к базе `vacation` — процессы всех экземпляров `server`, `pg_dump` сервиса `backup`, консоли администраторов; соединения репликации не считаются.

**Порог.** `max(sum by (instance) (vp_db_connections)) / max(vp_db_max_connections) > 0.8` в течение 5 минут; warning.

**Первые 5 минут.**

```bash
db "show max_connections"
db "select application_name, client_addr, state, count(*) from pg_stat_activity where datname = current_database() group by 1, 2, 3 order by 4 desc"
metrics | grep '^vp_process_count '
```

| Признак | Вероятная причина | Действие |
|---|---|---|
| Соединений `server` больше ~40 на экземпляр | Процессов много: пул на процесс не меньше 3, поэтому при числе процессов больше 13 (`WEB_CONCURRENCY=auto` на узле с многими ядрами) экземпляр держит больше 40 соединений; или задан большой `DB_POOL_SIZE` | Задайте `WEB_CONCURRENCY` числом в `.env` или уменьшите `DB_POOL_SIZE` (раздел `VacationDatabaseOverloaded`), `$C --profile full up -d server` |
| Второй экземпляр `server` | Два экземпляра — до 80 соединений из 100 | Ожидаемо; если рядом сторонние клиенты — уберите их |
| Много соединений с `application_name` сторонних программ | Отчётность, консоли администраторов | Закройте сеансы; постоянных потребителей согласуйте с ответственным |
| Много `idle in transaction` | Зависшие транзакции | Раздел `VacationIdleInTransaction` |

Увеличение `max_connections` — изменение конфигурации PostgreSQL с перезапуском; выполняет администратор БД в окно работ. На стенде с репликой значение на реплике должно быть не меньше, чем на основном сервере, иначе реплика не запустится.

**Эскалация.** Предел достигается при обычной нагрузке после настройки процессов и пула — администратору БД и ответственному за систему.

## VacationIdleInTransaction

**Что значит.** Больше пяти соединений открыли транзакцию и ничего не делают: они держат блокировки и соединения пула. Признак зависшего запроса или забытой консоли.

**Порог.** `max(vp_db_connections{state="idle in transaction"}) > 5` в течение 5 минут; warning.

**Первые 5 минут.**

```bash
db "select pid, now() - xact_start as in_transaction, application_name, client_addr, left(query, 120) as last_query from pg_stat_activity where datname = current_database() and state = 'idle in transaction' order by in_transaction desc"
```

Кого они блокируют — столбец `blocked_by` запроса «Активные запросы и кто кого ждёт» в `diagnostics.md`.

| Признак | Вероятная причина | Действие |
|---|---|---|
| `application_name` — консоль (`psql` и др.) | Администратор начал транзакцию и не завершил | Свяжитесь с владельцем; если сеанс блокирует работу — `db "select pg_terminate_backend(<pid>)"` |
| Адрес — контейнер `server`, транзакции живут минуты | Запрос API завис внутри транзакции | Запишите `last_query` и время; строки `slow request` того же времени в журнале `server` дадут маршрут и код запроса; завершите сеанс `pg_terminate_backend` |
| Адрес — внешняя программа | Сторонний клиент | Завершите сеанс, сообщите владельцу |

**Эскалация.** Повторяется из `server` — разработчикам с `last_query`, маршрутом и кодом запроса.

# Почта и задачи

## VacationMailStuck

**Что значит.** Письмо ждёт отправки больше 30 минут: почтовый релей недоступен или отвергает письма. Работа в интерфейсе не страдает — уведомления видны в колокольчике. Правило работает, только если задан `SMTP_HOST`.

**Порог.** `max(vp_mail_outbox_oldest_seconds) > 1800` в течение 10 минут; warning.

**Первые 5 минут.**

```bash
db "select status, count(*) from email_outbox group by status"
db "select id, to_address, attempts, next_attempt_at, left(last_error, 120) as last_error from email_outbox where status = 'pending' order by created_at limit 10"
$C logs --no-log-prefix --since 1h server | jq -cR 'fromjson? | select(.context=="Mail")' | tail -10
```

`last_error` — ответ почтового сервера или сетевая ошибка.

| Признак в `last_error` | Вероятная причина | Действие |
|---|---|---|
| Отказ соединения, тайм-аут | Релей недоступен из сети стенда | Сеть и межсетевой экран; администраторы почты |
| Ошибка входа (код 535) | Неверные `SMTP_USER`, `SMTP_PASSWORD` | Исправьте `.env` |
| Ошибка TLS | `SMTP_SECURE` не соответствует порту (465 — `true`, 587 — `false`) | Исправьте `.env` |
| Отказ в отправителе | Релей не принимает `MAIL_FROM` | Согласуйте отправителя с администраторами почты |

После правки `.env` — `$C --profile full up -d server` (`restart` не перечитывает `.env`), затем «Профиль и настройки → Проверочное письмо себе». Очередь продолжит отправку сама: повторы через 1, 5, 30 минут, 2 и 12 часов, после шестой попытки письмо помечается неотправленным. Подробнее — руководство, раздел «Почта».

**Эскалация.** Причина на стороне релея — администраторам почты. Письма не уходят больше 12 часов — сообщите кадровой службе: часть писем станет неотправленной (`VacationMailFailed`).

## VacationMailFailed

**Что значит.** За последний час появились письма с исчерпанными попытками — они больше не отправляются. Уведомление в интерфейсе у адресата при этом есть.

**Порог.** `max(delta(vp_mail_outbox{status="failed"}[1h])) > 0` — без задержки; info.

**Первые 5 минут.**

```bash
db "select id, to_address, kind, attempts, created_at, left(last_error, 160) as last_error from email_outbox where status = 'failed' order by created_at desc limit 20"
```

| Признак | Вероятная причина | Действие |
|---|---|---|
| Ошибка у одного-двух адресов («нет такого ящика») | Неверный email в карточке сотрудника | Кадровая служба исправляет email; повторной отправки неотправленных писем в планировщике нет |
| Ошибки у всех адресатов | Релей не работал дольше всех повторов | Раздел `VacationMailStuck` |

Неотправленные письма удаляются задачей `data-retention` через 90 дней.

**Эскалация.** Массовые ошибки — администраторам почты.

## VacationDigestNotRun

**Что значит.** Еженедельная сводка руководителям не запускалась больше 8 суток. Сводка формируется по пятницам с 12:00 по часовому поясу организации (`timezone` правил организации, по умолчанию `Europe/Moscow`), если задан `SMTP_HOST`; пропущенная пятница позже не наверстывается.

**Порог.** `time() - max(vp_job_last_run_timestamp_seconds{job="weekly-digest"}) > 8 * 86400` — без задержки; warning.

**Первые 5 минут.**

```bash
db "select name, period, ran_at from job_runs where name = 'weekly-digest' order by ran_at desc limit 3"
db "select timezone from org_settings"
$C exec server printenv SMTP_HOST
$C --profile full ps server
```

| Признак | Вероятная причина | Действие |
|---|---|---|
| `server` не работал в пятницу после 12:00 (авария, окно работ) | Сводка не сформирована | Следующая уйдёт в пятницу сама; сообщите руководителям, если нужно |
| `SMTP_HOST` пуст | Почту отключили намеренно, а отметка прошлой сводки осталась | Отключите правило в Prometheus организации |
| Неверный часовой пояс | Окно «пятница после 12:00» смещено | Исправьте поле `timezone` правил организации операцией `PATCH /api/v1/settings` (администратор; в интерфейсе этого поля нет) |

**Эскалация.** `server` работал в пятницу после 12:00, почта настроена, отметки нет — разработчикам с журналом `server` (контекст `Mail`).

# Реплика и архив WAL

Правила этого раздела работают на стенде с `docker-compose.replica.yml`. После переключения на реплику `VacationReplicaDisconnected` и `VacationReplicaLagging` молчат до возврата к схеме с репликой (`failover.md`).

## VacationReplicaDisconnected

**Что значит.** Слот `replica1` на основном сервере есть, а реплика к нему не подключена. Основной сервер копит WAL для неё, но не больше `max_slot_wal_keep_size` (10 ГБ); после этого слот теряет WAL и реплику придётся создать заново. Пока реплики нет, потеря данных при аварии — до 5 минут (архив WAL).

**Порог.** `min by (slot) (vp_db_replication_slot_active) == 0` в течение 5 минут; warning.

**Первые 5 минут.**

```bash
$C ps postgres-replica
$C logs --since 15m postgres-replica | tail -30
$C exec postgres psql -U vacation -Atc "select slot_name, active, wal_status, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) from pg_replication_slots"
df -h "$(docker info -f '{{.DockerRootDir}}')"
```

| Признак | Вероятная причина | Действие |
|---|---|---|
| Реплика `exited` после перезагрузки или ручного останова | Не запущена | `$C up -d postgres-replica` |
| «password authentication failed for user "replicator"» | `REPLICATION_PASSWORD` изменился после первого запуска | Верните прежний пароль в `.env` или создайте реплику заново (ниже) |
| «No space left on device» в журнале реплики | Нет места на диске | Освободите место, `$C up -d postgres-replica` |
| `wal_status` — `lost`, в журнале реплики «requested WAL segment … has already been removed» | Реплика отсутствовала дольше, чем вмещает 10 ГБ WAL | Создайте реплику заново |

Реплика заново — скрипт `deploy/postgres/replica.sh` при пустом томе сам создаёт роль и слот и копирует данные. Слот удаляется, потому что потерявший WAL слот не годится для новой реплики. Имя тома — с префиксом проекта compose (`docker volume ls | grep db-replica`):

```bash
$C rm -sf postgres-replica
$C exec postgres psql -U vacation -Atc "select pg_drop_replication_slot('replica1')"
docker volume rm vacation-planner_db-replica
$C up -d postgres-replica
$C logs -f postgres-replica            # «replica: копия данных с postgres», затем готовность к подключениям только на чтение
$C exec postgres psql -U vacation -Atc "select application_name, state from pg_stat_replication"   # replica1|streaming
```

**Эскалация.** Реплика не восстанавливается за час или удерживаемый слотом WAL (`vp_db_replication_slot_retained_bytes`) приближается к 10 ГБ при малом запасе диска — администратору БД.

## VacationReplicaLagging

**Что значит.** Реплика применяет изменения с отставанием больше 5 минут: при аварии основного сервера сейчас потеряется столько же.

**Порог.** `max by (replica) (vp_db_replica_lag_seconds) > 300` в течение 5 минут; warning.

**Первые 5 минут.**

```bash
$C exec postgres psql -U vacation -Atc "select application_name, state, write_lag, flush_lag, replay_lag, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) from pg_stat_replication"
$C exec postgres-replica psql -U vacation -Atc "select now() - pg_last_xact_replay_timestamp()"
docker stats --no-stream
```

| Признак | Вероятная причина | Действие |
|---|---|---|
| Отставание уменьшается | Массовое изменение: импорт, первый запуск `data-retention`, восстановление, ежемесячная проверка восстановления | Наблюдайте до схождения |
| `write_lag` мал, `replay_lag` велик | Реплика не успевает применять: диск или процессор, долгие запросы на реплике задерживают применение | `docker stats`, диск; долгие запросы на реплике — `pg_stat_activity` реплики, `pg_terminate_backend` |
| Велик `write_lag` | Сеть или диск реплики | Ресурсы узла и тома `db-replica` |

**Эскалация.** Отставание больше 15 минут (требование к потере данных, ADR-014) и растёт — администратору БД.

## VacationWalArchiveFailing

**Что значит.** Последняя попытка архивировать сегмент WAL неуспешна и успеха после неё не было. Восстановление на момент времени после последнего заархивированного сегмента невозможно, а неархивированные сегменты копятся в `pg_wal` основного сервера — следом закончится место и остановится БД. После устранения причины PostgreSQL сам дозаархивирует накопленные сегменты по порядку — разрыва в архиве не будет.

**Порог.** `max(vp_db_wal_archive_failing) == 1` в течение 10 минут; critical.

**Первые 5 минут.**

```bash
$C exec postgres psql -U vacation -Atc "select archived_count, last_archived_wal, last_archived_time, failed_count, last_failed_wal, last_failed_time from pg_stat_archiver"
$C logs --since 30m postgres | grep -iE 'archive|No space|Permission' | tail -20
$C exec postgres df -h /wal-archive /var/lib/postgresql/data
$C exec postgres ls -l /wal-archive/<last_failed_wal>
```

| Признак | Вероятная причина | Действие |
|---|---|---|
| «No space left on device», `/wal-archive` заполнен | Нет места в хранилище архива | Расширьте хранилище или уменьшите `BASEBACKUP_KEEP` в `.env` и выполните `$C up -d basebackup`: контейнер сразу снимет копию и удалит копии сверх нового числа и WAL до старта самой старой. Сегменты архива новее самой старой физической копии вручную не удаляйте |
| «Permission denied» | Сменился владелец каталога архива (перемонтирование хранилища) | `$C exec -u root postgres chown postgres:postgres /wal-archive` |
| `ls` находит `last_failed_wal` в архиве, в журнале только «archive command failed with exit code 1» | Команда архивирования не перезаписывает существующий файл: в один архив пишут два сервера (бывший основной запущен после переключения) или каталог данных восстанавливали | Сравните файлы: `$C exec postgres sh -c 'cmp /wal-archive/<сегмент> /var/lib/postgresql/data/pg_wal/<сегмент> && echo одинаковые'`. Одинаковые — удалите копию в архиве (`$C exec postgres rm /wal-archive/<сегмент>`), PostgreSQL заархивирует сегмент заново. Разные — остановите второй сервер (`failover.md`, «Работа без реплики») и ничего не удаляйте до решения администратора БД |
| Хранилище архива не смонтировано | Инфраструктура | Верните хранилище |

Проверка после устранения:

```bash
$C exec postgres psql -U vacation -Atc "select pg_switch_wal()"
$C exec postgres psql -U vacation -Atc "select last_archived_wal, last_failed_time > last_archived_time from pg_stat_archiver"   # новый сегмент, f
```

**Эскалация.** Не устранено за 30 минут или на диске основного сервера осталось меньше 20 % — администратору БД и ответственному за систему; сделайте внеочередную логическую копию (`backup-restore.md`) и вынесите её с сервера.

# Проверка

Оповещение считается отработанным, когда:

1. Во вкладке «Alerts» Prometheus правило перешло в `inactive`, а метрика из условия вернулась в норму (выражение из сводки во вкладке «Graph»).
2. Пользователи не жалуются, проверочные команды первых 5 минут дают ожидаемый результат.
3. Причина записана; если она в коде или данных — заявка разработчикам заведена.

# Если не получилось

| Ситуация | Кому и с чем |
|---|---|
| Критичное оповещение не устранено за 15 минут | Ответственному за систему — решение о переключении (`failover.md`), восстановлении (`backup-restore.md`) или откате обновления (`update.md`) |
| Причина в коде или плане запроса | Разработчикам — комплект из `diagnostics.md`, «Что передать разработчику» |
| Повреждение данных, архив, реплика, `max_connections` | Администратору БД |
| Признаки атаки: всплеск неудачных входов, `refresh_reuse`, неожиданные изменения | Службе ИБ — `incident.md` |
| Сбой длился дольше 15 минут или затронул данные | Разбор инцидента — `incident.md` |

# Запись в журнал эксплуатации

| Поле | Пример |
|---|---|
| Оповещение и время срабатывания и снятия (UTC) | `VacationMailStuck`, 07:40–08:25 |
| Кто отработал | Дежурный администратор |
| Причина | Релей отклонял вход: истёк пароль учётной записи `SMTP_USER` |
| Действие | Новый пароль в `.env`, `up -d server`, проверочное письмо отправлено |
| Влияние на пользователей | Письма задержались на 45 минут; потерь нет |
| Эскалация и ссылки | Нет / заявка разработчикам, отчёт об инциденте |

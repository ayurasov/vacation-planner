Нагрузка: http://127.0.0.1:8097, профиль average, численность 2000; работают 115×1080 с, вкладок без действий 600, приход 0 за 900 с, разгон 120 с, пауза ~8000 мс, поток событий

| Операция | Запросов | Ошибок | Отказов 409 | p50, мс | p95, мс | p99, мс | max, мс |
|---|---|---|---|---|---|---|---|
| GET /schedule (отдел) | 9152 | 22 {"503":5,"ECONNRESET":1,"ECONNREFUSED":16} | 0 | 6 | 13 | 27 | 224 |
| GET /vacation-requests (мои) | 4341 | 14 {"503":1,"ECONNREFUSED":13} | 0 | 12 | 23 | 39 | 477 |
| GET /notices/mine | 4341 | 14 {"503":1,"ECONNREFUSED":13} | 0 | 9 | 18 | 32 | 484 |
| GET /balance | 4341 | 14 {"503":1,"ECONNREFUSED":13} | 0 | 10 | 20 | 36 | 476 |
| GET /planning/mine | 4341 | 14 {"503":1,"ECONNREFUSED":13} | 0 | 11 | 21 | 37 | 477 |
| POST /events/ticket | 1792 | 0 | 0 | 148 | 1859 | 2161 | 2239 |
| SSE: подключение до hello | 1792 | 0 | 0 | 21 | 691 | 2273 | 2304 |
| GET /analytics/team | 1666 | 3 {"ECONNREFUSED":3} | 0 | 15 | 28 | 60 | 198 |
| POST /vacation-requests | 1276 | 5 {"ECONNREFUSED":5} | 225 | 27 | 47 | 88 | 470 |
| DELETE /vacation-requests/:id | 1046 | 0 | 0 | 11 | 23 | 51 | 137 |
| GET /analytics/overview | 869 | 1 {"ECONNREFUSED":1} | 0 | 19 | 31 | 60 | 128 |
| GET /analytics/suggestions | 840 | 6 {"ECONNREFUSED":6} | 0 | 18 | 30 | 51 | 96 |
| POST /auth/login | 715 | 0 | 0 | 66 | 109 | 293 | 599 |
| GET /employees/:id | 715 | 0 | 0 | 5 | 12 | 22 | 38 |
| GET /schedule (организация) | 639 | 2 {"503":1,"ECONNREFUSED":1} | 0 | 46 | 75 | 113 | 185 |
| GET /auth/sessions | 437 | 6 {"ECONNREFUSED":6} | 0 | 4 | 9 | 40 | 82 |
| GET /notifications | 436 | 2 {"ECONNREFUSED":2} | 0 | 5 | 10 | 19 | 34 |
| POST /auth/refresh | 300 | 0 | 0 | 8 | 18 | 36 | 59 |
| GET /vacation-requests (очередь) | 234 | 0 | 0 | 15 | 28 | 45 | 47 |
| GET /vacation-requests (бейдж) | 205 | 0 | 0 | 15 | 25 | 35 | 42 |
| GET /notices | 12 | 0 | 0 | 11 | 18 | 18 | 18 |
| GET /planning/:year | 12 | 0 | 0 | 113 | 219 | 219 | 219 |
| GET /login-events | 5 | 0 | 0 | 15 | 19 | 19 | 19 |
| GET /employees (поиск) | 5 | 0 | 0 | 19 | 29 | 29 | 29 |
| POST /vacation-requests/:id/approve | 4 | 0 | 0 | 23 | 280 | 280 | 280 |
| GET /reports/vacations | 4 | 0 | 0 | 453 | 478 | 478 | 478 |
| GET /reports/t7 | 3 | 0 | 0 | 1970 | 2093 | 2093 | 2093 |

Итого: 39523 запросов за 1211 с (33/с), ошибок 103 (0.26 %), p95 чтения 23 мс, p95 записи 42 мс
Поток событий: одновременно открыто до 715, сбоев 362, переподключений 1077, событий {"hello":1792,"notifications":212,"data":50768}

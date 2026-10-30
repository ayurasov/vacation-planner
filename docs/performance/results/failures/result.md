Нагрузка: http://127.0.0.1:8097, профиль average, численность 2000; работают 115×1080 с, вкладок без действий 600, приход 0 за 900 с, разгон 120 с, пауза ~8000 мс, поток событий

| Операция | Запросов | Ошибок | Отказов 409 | p50, мс | p95, мс | p99, мс | max, мс |
|---|---|---|---|---|---|---|---|
| GET /schedule (отдел) | 9396 | 10 {"500":1,"503":4,"UND_ERR_SOCKET":1,"ECONNREFUSED":4} | 0 | 6 | 13 | 26 | 2245 |
| GET /vacation-requests (мои) | 4309 | 13 {"503":1,"ECONNREFUSED":12} | 0 | 13 | 23 | 36 | 1267 |
| GET /balance | 4309 | 14 {"503":2,"ECONNREFUSED":12} | 0 | 10 | 19 | 31 | 1266 |
| GET /notices/mine | 4309 | 13 {"503":1,"ECONNREFUSED":12} | 0 | 9 | 18 | 32 | 1291 |
| GET /planning/mine | 4309 | 13 {"503":1,"ECONNREFUSED":12} | 0 | 11 | 21 | 38 | 1274 |
| POST /events/ticket | 1785 | 0 | 0 | 299 | 1905 | 1979 | 2213 |
| SSE: подключение до hello | 1785 | 0 | 0 | 22 | 376 | 1692 | 2243 |
| GET /analytics/team | 1733 | 5 {"ECONNREFUSED":5} | 0 | 15 | 26 | 39 | 152 |
| POST /vacation-requests | 1274 | 5 {"ECONNREFUSED":5} | 212 | 27 | 47 | 69 | 527 |
| DELETE /vacation-requests/:id | 1057 | 0 | 0 | 12 | 23 | 49 | 85 |
| GET /analytics/overview | 872 | 3 {"500":1,"503":1,"ECONNREFUSED":1} | 0 | 19 | 32 | 44 | 91 |
| GET /analytics/suggestions | 843 | 2 {"503":1,"ECONNREFUSED":1} | 0 | 19 | 31 | 43 | 59 |
| POST /auth/login | 715 | 0 | 0 | 65 | 91 | 130 | 314 |
| GET /employees/:id | 715 | 0 | 0 | 6 | 11 | 19 | 38 |
| GET /schedule (организация) | 598 | 0 | 0 | 45 | 71 | 91 | 630 |
| GET /auth/sessions | 450 | 4 {"503":1,"ECONNREFUSED":3} | 0 | 4 | 9 | 16 | 160 |
| GET /notifications | 440 | 0 | 0 | 5 | 11 | 18 | 27 |
| GET /vacation-requests (бейдж) | 340 | 1 {"503":1} | 0 | 15 | 26 | 41 | 81 |
| POST /auth/refresh | 334 | 0 | 0 | 8 | 16 | 30 | 61 |
| GET /vacation-requests (очередь) | 307 | 0 | 0 | 15 | 26 | 49 | 87 |
| GET /planning/:year | 15 | 0 | 0 | 118 | 152 | 152 | 152 |
| GET /employees (поиск) | 10 | 0 | 0 | 19 | 25 | 25 | 25 |
| POST /vacation-requests/:id/approve | 10 | 0 | 0 | 24 | 33 | 33 | 33 |
| GET /notices | 9 | 0 | 0 | 12 | 22 | 22 | 22 |
| GET /login-events | 4 | 0 | 0 | 14 | 18 | 18 | 18 |
| GET /reports/vacations | 2 | 0 | 0 | 495 | 495 | 495 | 495 |
| GET /reports/t7 | 1 | 0 | 0 | 1327 | 1327 | 1327 | 1327 |

Итого: 39931 запросов за 1210 с (33/с), ошибок 83 (0.21 %), p95 чтения 24 мс, p95 записи 41 мс
Поток событий: одновременно открыто до 715, сбоев 355, переподключений 1070, событий {"hello":1785,"notifications":348,"data":50921}

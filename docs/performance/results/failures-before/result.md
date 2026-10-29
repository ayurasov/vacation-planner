Нагрузка: http://127.0.0.1:8097, профиль average, численность 2000; работают 115×1080 с, вкладок без действий 600, приход 0 за 900 с, разгон 120 с, пауза ~8000 мс, поток событий

| Операция | Запросов | Ошибок | Отказов 409 | p50, мс | p95, мс | p99, мс | max, мс |
|---|---|---|---|---|---|---|---|
| GET /schedule (отдел) | 9240 | 162 {"503":5,"ECONNREFUSED":157} | 0 | 8 | 17 | 35 | 234 |
| GET /planning/mine | 4304 | 74 {"503":2,"ECONNREFUSED":72} | 0 | 13 | 26 | 51 | 2839 |
| GET /balance | 4304 | 73 {"503":1,"ECONNREFUSED":72} | 0 | 12 | 26 | 47 | 2825 |
| GET /notices/mine | 4304 | 73 {"503":1,"ECONNREFUSED":72} | 0 | 10 | 22 | 43 | 2820 |
| GET /vacation-requests (мои) | 4304 | 74 {"503":2,"ECONNREFUSED":72} | 0 | 15 | 30 | 57 | 2839 |
| POST /events/ticket | 1787 | 0 | 0 | 235 | 2404 | 2714 | 2796 |
| SSE: подключение до hello | 1787 | 0 | 0 | 29 | 1262 | 2951 | 3012 |
| GET /analytics/team | 1716 | 22 {"ECONNREFUSED":22} | 0 | 18 | 34 | 54 | 174 |
| POST /vacation-requests | 1350 | 15 {"ECONNREFUSED":15} | 189 | 34 | 58 | 114 | 418 |
| DELETE /vacation-requests/:id | 1146 | 0 | 0 | 14 | 27 | 52 | 233 |
| GET /analytics/suggestions | 886 | 14 {"503":1,"ECONNREFUSED":13} | 0 | 23 | 41 | 73 | 168 |
| GET /analytics/overview | 841 | 9 {"ECONNREFUSED":9} | 0 | 24 | 39 | 57 | 101 |
| POST /auth/login | 715 | 0 | 0 | 81 | 115 | 152 | 191 |
| GET /employees/:id | 715 | 0 | 0 | 7 | 13 | 31 | 49 |
| GET /schedule (организация) | 672 | 4 {"ECONNREFUSED":4} | 0 | 51 | 87 | 125 | 279 |
| GET /auth/sessions | 430 | 8 {"ECONNREFUSED":8} | 0 | 5 | 12 | 25 | 106 |
| GET /notifications | 424 | 5 {"ECONNREFUSED":5} | 0 | 6 | 13 | 21 | 141 |
| GET /vacation-requests (бейдж) | 379 | 2 {"ECONNREFUSED":2} | 0 | 18 | 32 | 65 | 107 |
| POST /auth/refresh | 321 | 0 | 0 | 10 | 21 | 35 | 61 |
| GET /vacation-requests (очередь) | 230 | 2 {"ECONNREFUSED":2} | 0 | 18 | 41 | 70 | 164 |
| GET /planning/:year | 13 | 0 | 0 | 133 | 165 | 165 | 165 |
| GET /notices | 12 | 1 {"ECONNREFUSED":1} | 0 | 13 | 29 | 29 | 29 |
| POST /vacation-requests/:id/approve | 8 | 0 | 0 | 34 | 39 | 39 | 39 |
| GET /reports/t7 | 5 | 0 | 0 | 1537 | 2033 | 2033 | 2033 |
| GET /reports/vacations | 4 | 0 | 0 | 582 | 655 | 655 | 655 |
| GET /employees (поиск) | 3 | 0 | 0 | 21 | 24 | 24 | 24 |
| GET /login-events | 2 | 0 | 0 | 24 | 24 | 24 | 24 |

Итого: 39902 запросов за 1211 с (33/с), ошибок 538 (1.35 %), p95 чтения 30 мс, p95 записи 51 мс
Поток событий: одновременно открыто до 715, сбоев 1072, переподключений 1072, событий {"hello":1787,"notifications":387,"data":50298}

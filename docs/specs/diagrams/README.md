# Диаграммы (Mermaid)

Исходники целевой архитектуры. Рендер: mermaid.live, плагин VS Code Mermaid, или `npx -y @mermaid-js/mermaid-cli`.

## C1. Системный контекст

```mermaid
graph TB
  subgraph Компания
    E["Сотрудник<br/>(браузер)"]
    M["Руководитель<br/>(браузер)"]
    A["Администратор<br/>(браузер)"]
  end
  VP["Планировщик отпусков<br/>Node.js + SQLite"]
  N["Nginx (стенд)<br/>TLS, статика"]
  E --> N
  M --> N
  A --> N
  N --> VP
  VP -. "этап 2" .-> SMTP["Почтовый релей<br/>(уведомления)"]
  VP -. "этап 3" .-> HR["Кадровая система<br/>(импорт сотрудников)"]
```

## C2. Контейнеры

```mermaid
graph LR
  B["Браузер: SPA<br/>vanilla JS, ES-модули"]
  API["API-сервер<br/>Express 4"]
  DOM["Доменный слой<br/>domain/: requests, balance,<br/>schedule, directories, audit"]
  DB[("SQLite WAL<br/>data.db")]
  B -->|HTTPS /api/v1 + JWT| API
  API --> DOM
  DOM --> DB
```

## C3. Компоненты сервера

```mermaid
graph TB
  subgraph api["src/api/ (тонкие роуты)"]
    R1["auth-роуты"]
    R2["request-роуты"]
    R3["directory-роуты"]
  end
  MW["middleware: jwt → права → ajv → problem+json"]
  subgraph domain["src/domain/"]
    D1["requests<br/>автомат заявок"]
    D2["balance<br/>балансы и лимиты"]
    D3["schedule + calendar<br/>график, конфликты"]
    D4["audit"]
  end
  R1 & R2 & R3 --> MW --> D1 & D2 & D3
  D1 & D2 & D3 --> D4
  D1 & D2 & D3 & D4 --> DB[("SQLite")]
```

## Состояния заявки

```mermaid
stateDiagram-v2
  [*] --> pending : создана
  pending --> approved : согласовать
  pending --> rejected : отклонить
  pending --> cancelled : отменить (автор)
  approved --> pending : перенос / запрос удаления
  pending --> [*] : удаление согласовано
  rejected --> [*]
  cancelled --> [*]
```

## Развёртывание стенда

```mermaid
graph TB
  U["Пользователи"] -->|HTTPS 443| N["Nginx (контейнер)"]
  N -->|:3000| APP["vacation-planner (контейнер)"]
  APP --> V[("том db-data: data.db")]
  B2[("Бэкап-хранилище<br/>ежедневно, 30 дней")] -. копия .-> V
```

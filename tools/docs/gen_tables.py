"""Таблицы документов из исходного кода: каталог API, словарь данных, показатели кодовой базы.

    python3 tools/docs/gen_tables.py          # обновить разделы в docs/**/*.md
    python3 tools/docs/gen_tables.py --check  # CI: выйти с ошибкой, если документы устарели

Раздел документа обновляется между маркерами:
    <!-- BEGIN:api-catalog -->  …  <!-- END:api-catalog -->
Доступные блоки: api-catalog, data-dictionary, code-metrics, error-catalog.
"""
import re
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "contracts" / "openapi-vacation-api-v1.yaml"
SCHEMA = ROOT / "server" / "prisma" / "schema.prisma"
PROBLEMS = ROOT / "server" / "src" / "infra" / "problems.ts"

TAGS = {
    "auth": "Вход и сессии", "employees": "Сотрудники", "vacation-requests": "Заявки на отпуск",
    "schedule": "График и режим работы", "directories": "Справочники", "settings": "Настройки",
    "calendar": "Производственный календарь", "notifications": "Уведомления", "audit": "Аудит",
    "reports": "Отчёты", "analytics": "Аналитика", "health": "Пробы", "balance": "Баланс",
}

TABLE_NOTES = {
    "employees": "Сотрудники: учётные записи, роли, нормы дней",
    "departments": "Отделы и их руководители",
    "projects": "Проекты и руководители проектов",
    "groups": "Личные группы для фильтров графика",
    "group_members": "Состав личных групп",
    "vacation_requests": "Заявки на отпуск и их состояние",
    "request_events": "История действий по заявке",
    "work_patterns": "Недельный шаблон офис/удалёнка",
    "work_overrides": "Разовые исключения режима работы",
    "org_settings": "Правила организации (одна строка)",
    "calendars": "Производственный календарь по годам",
    "notifications": "Уведомления пользователей",
    "audit_events": "Неизменяемый журнал изменений",
    "refresh_tokens": "Хеши refresh-токенов (ротация, отзыв)",
}


def md_table(header, rows):
    out = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    out += ["| " + " | ".join(str(c).replace("|", "\\|") for c in r) + " |" for r in rows]
    return "\n".join(out)


# ---------------------------------------------------------------- API
def api_catalog():
    spec = yaml.safe_load(CONTRACT.read_text(encoding="utf-8"))
    rows_by_tag = {}
    for path, item in spec["paths"].items():
        for method in ("get", "post", "put", "patch", "delete"):
            op = item.get(method)
            if not op:
                continue
            tag = (op.get("tags") or ["other"])[0]
            rows_by_tag.setdefault(tag, []).append((method.upper(), f"`/api/v1{path}`", op.get("summary", ""), f"`{op.get('operationId', '')}`"))
    parts = []
    total = 0
    for tag, rows in rows_by_tag.items():
        total += len(rows)
        parts.append(f"**{TAGS.get(tag, tag)}** ({len(rows)})\n\n" + md_table(["Метод", "Путь", "Назначение", "Операция"], rows))
    return f"Всего операций: **{total}** в {len(spec['paths'])} путях; формат — JSON, ошибки — `application/problem+json`.\n\n" + "\n\n".join(parts)


# ---------------------------------------------------------------- Данные
def parse_schema():
    text = SCHEMA.read_text(encoding="utf-8")
    models = []
    for m in re.finditer(r"^model (\w+) \{(.*?)^\}", text, re.S | re.M):
        name, body = m.group(1), m.group(2)
        table = re.search(r'@@map\("(\w+)"\)', body)
        fields = []
        for line in body.splitlines():
            line = line.strip()
            if not line or line.startswith("@@") or line.startswith("//"):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            fname, ftype = parts[0], parts[1]
            base = ftype.rstrip("?[]")
            if base[0].isupper() and base not in ("String", "Int", "Float", "Boolean", "DateTime", "Json", "RequestStatus", "RequestType", "WorkMode"):
                continue  # связи — в ER-схемах
            col = re.search(r'@map\("(\w+)"\)', line)
            comment = line.split("//", 1)[1].strip() if "//" in line else ""
            attrs = []
            if "@id" in line:
                attrs.append("PK")
            if "@unique" in line:
                attrs.append("UK")
            if ftype.endswith("?"):
                attrs.append("null")
            fields.append((col.group(1) if col else fname, ftype.rstrip("?"), " ".join(attrs), comment))
        models.append((name, table.group(1) if table else name, fields))
    return models


def data_dictionary():
    parts = []
    for _name, table, fields in parse_schema():
        parts.append(f"**`{table}`** — {TABLE_NOTES.get(table, '')}\n\n" + md_table(["Поле", "Тип", "Признаки", "Примечание"], [(f"`{f}`", t, a, c) for f, t, a, c in fields]))
    return "\n\n".join(parts)


# ---------------------------------------------------------------- Ошибки
def error_catalog():
    text = PROBLEMS.read_text(encoding="utf-8")
    statuses = dict(re.findall(r"'([a-z/-]+)': (\d{3}),", text))
    titles = dict(re.findall(r"'([a-z/-]+)': '([^']+)',", text))
    rows = [(f"`{code}`", status, titles.get(code, "")) for code, status in statuses.items()]
    return md_table(["Код (type)", "HTTP", "Заголовок (title)"], rows)


# ---------------------------------------------------------------- Показатели
def count_lines(paths):
    n = 0
    for p in paths:
        n += sum(1 for _ in p.open(encoding="utf-8", errors="ignore"))
    return n


def code_metrics():
    srv = [p for p in (ROOT / "server" / "src").rglob("*.ts")]
    web = [p for p in (ROOT / "web" / "src").rglob("*") if p.suffix in (".ts", ".vue") and ".spec." not in p.name]
    tests_srv = list((ROOT / "server" / "test").glob("*.test.ts"))
    tests_web = list((ROOT / "web" / "src").rglob("*.spec.ts")) + list((ROOT / "web" / "e2e").glob("*.spec.ts"))
    count_cases = lambda files: sum(len(re.findall(r"^\s*(?:it|test)\(", f.read_text(encoding="utf-8"), re.M)) for f in files)
    spec = yaml.safe_load(CONTRACT.read_text(encoding="utf-8"))
    ops = sum(1 for item in spec["paths"].values() for m in ("get", "post", "put", "patch", "delete") if m in item)
    migrations = len(list((ROOT / "server" / "prisma" / "migrations").glob("*/migration.sql")))
    controllers = len(list((ROOT / "server" / "src").rglob("*.controller.ts")))
    views = len(list((ROOT / "web" / "src" / "views").glob("*.vue")))
    rows = [
        ("Сервер: файлов TypeScript / строк", f"{len(srv)} / {count_lines(srv):,}".replace(",", " ")),
        ("Сервер: контроллеров / операций API", f"{controllers} / {ops}"),
        ("Модель данных: таблиц / миграций", f"{len(parse_schema())} / {migrations}"),
        ("Клиент: файлов TS и Vue / строк", f"{len(web)} / {count_lines(web):,}".replace(",", " ")),
        ("Клиент: экранов", str(views)),
        ("Тесты сервера: файлов / сценариев", f"{len(tests_srv)} / {count_cases(tests_srv)}"),
        ("Тесты клиента (модульные и e2e): файлов / сценариев", f"{len(tests_web)} / {count_cases(tests_web)}"),
    ]
    return md_table(["Показатель", "Значение"], rows)


BLOCKS = {"api-catalog": api_catalog, "data-dictionary": data_dictionary, "code-metrics": code_metrics, "error-catalog": error_catalog}


def main(check):
    stale = []
    cache = {}
    for md in sorted((ROOT / "docs").rglob("*.md")):
        text = md.read_text(encoding="utf-8")
        new = text
        for name, fn in BLOCKS.items():
            pattern = re.compile(rf"(<!-- BEGIN:{name} -->\n).*?(\n<!-- END:{name} -->)", re.S)
            if pattern.search(new):
                body = cache.setdefault(name, fn())
                new = pattern.sub(lambda m: m.group(1) + body + m.group(2), new)
        if new != text:
            stale.append(md.relative_to(ROOT))
            if not check:
                md.write_text(new, encoding="utf-8")
    for p in stale:
        print(("устарел: " if check else "обновлён: ") + str(p))
    if check and stale:
        sys.exit("Таблицы документов не соответствуют коду: выполните python3 tools/docs/gen_tables.py")


if __name__ == "__main__":
    main("--check" in sys.argv)

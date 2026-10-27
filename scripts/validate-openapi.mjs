// Структурная проверка OpenAPI-контракта без внешних сервисов.
// Гарантирует: файл парсится, схема 3.x, у каждой операции есть operationId,
// теги объявлены, все $ref указывают на существующие компоненты.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT = join(root, 'contracts', 'openapi-vacation-api-v1.yaml');

const errors = [];
const doc = yaml.load(readFileSync(CONTRACT, 'utf-8'));

const assert = (cond, msg) => { if (!cond) errors.push(msg); };

assert(doc && typeof doc === 'object', 'файл не распарсился как YAML-объект');
assert(/^3\.\d+\.\d+$/.test(doc?.openapi || ''), `openapi версия 3.x не указана (получено: ${doc?.openapi})`);
assert(doc?.info?.title && doc?.info?.version, 'info.title и info.version обязательны');
assert(doc?.paths && Object.keys(doc.paths).length > 0, 'не описано ни одного пути');

const declaredTags = new Set((doc?.tags || []).map((t) => t.name));

// Все локальные ссылки $ref в документе должны разрешаться.
const refPattern = /^#\/(.+)$/;
function checkRefs(node, trail) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => checkRefs(v, `${trail}[${i}]`));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') {
        const m = refPattern.exec(v);
        if (!m) { errors.push(`внешний ref не поддерживается: ${v} (${trail})`); continue; }
        let cursor = doc;
        for (const part of m[1].split('/')) {
          cursor = cursor?.[part];
          if (cursor === undefined) break;
        }
        if (cursor === undefined) errors.push(`битая ссылка ${v} в ${trail}`);
      } else {
        checkRefs(v, `${trail}.${k}`);
      }
    }
  }
}
checkRefs(doc, '$');

// У каждой операции: operationId, summary, теги из объявленных, ответы описаны.
const METHOD_RE = /^(get|post|put|patch|delete|options|head|trace)$/;
for (const [path, item] of Object.entries(doc?.paths || {})) {
  if (!item || typeof item !== 'object') continue;
  for (const [method, op] of Object.entries(item)) {
    if (!METHOD_RE.test(method) || typeof op !== 'object') continue;
    const at = `${method.toUpperCase()} ${path}`;
    assert(op.operationId, `${at}: нет operationId`);
    assert(op.summary, `${at}: нет summary`);
    assert(op.responses && Object.keys(op.responses).length > 0, `${at}: не описаны ответы`);
    for (const t of op.tags || []) {
      assert(declaredTags.has(t), `${at}: тег «${t}» не объявлен в корневом tags`);
    }
  }
}

const opIds = Object.values(doc?.paths || {})
  .flatMap((p) => Object.entries(p || {}).filter(([m]) => METHOD_RE.test(m)).map(([, op]) => op?.operationId))
  .filter(Boolean);
assert(new Set(opIds).size === opIds.length, 'operationId дублируются');

if (errors.length) {
  console.error(`Контракт ${CONTRACT} не прошёл проверку:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Контракт корректен: путей ${Object.keys(doc.paths).length}, операций ${opIds.length}, тегов ${declaredTags.size}.`);

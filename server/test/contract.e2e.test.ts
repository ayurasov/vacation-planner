// Сверка реализации с контрактом: контракт — корректный YAML OpenAPI 3.1, каждый маршрут NestJS описан в нём, и наоборот.
// Защищает от тихого расхождения (так в v0.3.0 нашлись незадокументированные /auth/refresh и /auth/password).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, destroyTestApp, type TestApp } from './helpers';

const NON_CONTRACT = new Set(['GET /healthz', 'GET /readyz']); // пробы инфраструктуры, вне API v1

type Contract = { openapi: string; paths: Record<string, Record<string, { operationId?: string }>> };

/** Контракт разбирается полноценным YAML-парсером: синтаксическая ошибка — падение теста. */
function loadContract(): Contract {
  const text = readFileSync(join(__dirname, '..', '..', 'contracts', 'openapi-vacation-api-v1.yaml'), 'utf8');
  return load(text) as Contract;
}

/** Операции контракта: метод и путь в нотации Express. */
function contractOperations(): Set<string> {
  const ops = new Set<string>();
  for (const [path, item] of Object.entries(loadContract().paths)) {
    for (const method of Object.keys(item)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        ops.add(`${method.toUpperCase()} /api/v1${path.replace(/\{(\w+)\}/g, ':$1')}`);
      }
    }
  }
  return ops;
}

/** Маршруты Express-приложения NestJS. */
function appRoutes(t: TestApp): Set<string> {
  type Router = { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> };
  const instance = t.app.getHttpAdapter().getInstance() as { router?: Router; _router?: Router };
  const router = (instance.router ?? instance._router)!; // Express 5 — router, Express 4 — _router
  const out = new Set<string>();
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) out.add(`${method.toUpperCase()} ${layer.route.path}`);
  }
  return out;
}

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await destroyTestApp(t); });

describe('контракт OpenAPI ↔ реализация', () => {
  it('нет маршрутов вне контракта и операций контракта без реализации', () => {
    const contract = contractOperations();
    const routes = [...appRoutes(t)].filter((r) => !NON_CONTRACT.has(r));
    expect(routes.length, 'маршруты приложения не найдены').toBeGreaterThan(40);
    expect(contract.size, 'операции контракта не найдены').toBeGreaterThan(40);
    const normalize = (r: string) => r.replace(/:\w+/g, ':param');
    const c = new Set([...contract].map(normalize));
    const a = new Set(routes.map(normalize));
    expect([...a].filter((r) => !c.has(r)).sort(), 'реализовано, но не описано в контракте').toEqual([]);
    expect([...c].filter((r) => !a.has(r)).sort(), 'описано в контракте, но не реализовано').toEqual([]);
  });

  it('контракт — OpenAPI 3.1; у каждой операции уникальный operationId', () => {
    const contract = loadContract();
    expect(contract.openapi).toMatch(/^3\.1/);
    const ids = Object.values(contract.paths).flatMap((item) => Object.entries(item)
      .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method))
      .map(([, op]) => op.operationId));
    expect(ids.filter((id) => !id), 'операции без operationId').toEqual([]);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i), 'повторяющиеся operationId').toEqual([]);
  });
});

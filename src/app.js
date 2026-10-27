// Фабрика Express-приложения. Отделена от запуска сервера для тестирования
// (тесты поднимают приложение на эфемерном порту с временной БД).
const express = require('express');
const path = require('path');
const {
  openDb, saveStateToDb, loadStateFromDb, readSeed, seedIfEmpty,
} = require('./db');

// Совместный API этапа 0 (state целиком). В этапе 1 заменяется гранулярным
// REST API v1 — см. docs/specs/01-architecture.md и contracts/.
function buildApp({ dbPath, seedPath, skipSeed = false } = {}) {
  const db = openDb(dbPath);
  if (!skipSeed) seedIfEmpty(db, seedPath);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // Полное состояние приложения
  app.get('/api/state', (req, res) => {
    try { res.json(loadStateFromDb(db)); } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Сохранение всего состояния (фронтенд шлёт целиком после любого изменения).
  // Известные ограничения (гонки last-write-wins, отсутствие авторизации)
  // описаны в docs/specs/00-feature-audit.md и закрываются на этапе 1.
  app.put('/api/state', (req, res) => {
    try {
      const state = req.body;
      if (!state || !Array.isArray(state.employees)) {
        return res.status(400).json({ error: 'Некорректное состояние' });
      }
      saveStateToDb(db, state);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Сброс БД к исходному seed
  app.post('/api/reset', (req, res) => {
    try {
      const seed = readSeed(seedPath);
      saveStateToDb(db, seed);
      res.json({ ok: true, employees: seed.employees.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  return { app, db };
}

module.exports = { buildApp };

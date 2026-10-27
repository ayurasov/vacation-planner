// Планировщик отпусков — точка входа: Express + SQLite (better-sqlite3).
// Логика БД — src/db.js, сборка приложения — src/app.js.
const { buildApp } = require('./src/app');

const PORT = process.env.PORT || 3000;

const { app } = buildApp();

app.listen(PORT, '0.0.0.0', () => console.log(`Планировщик отпусков слушает порт ${PORT}`));

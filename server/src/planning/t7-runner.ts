// Сборка формы Т-7 вне основного потока (v1.0.0, E51-06): нагрузочный прогон на одном ядре показал,
// что выгрузка на 2000 сотрудников на 1–6 секунд задерживает все запросы процесса (профиль процессора:
// ExcelJS и сжатие zip). Один поток на процесс создаётся при первой выгрузке и живёт дальше.
// В тестах исходники — TypeScript, поток из них не запускается: книга собирается в основном потоке.
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { buildT7 } from './t7';
import type { T7Data } from './planning.service';

type Pending = { resolve: (b: Buffer) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function start(): Worker {
  const w = new Worker(join(__dirname, 't7.worker.js'));
  w.on('message', (m: { id: number; file?: Uint8Array; error?: string }) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.file) p.resolve(Buffer.from(m.file.buffer, m.file.byteOffset, m.file.byteLength));
    else p.reject(new Error(m.error ?? 'Форма Т-7 не собрана'));
  });
  // Поток упал — ожидающие выгрузки получают ошибку, следующая создаст поток заново
  const fail = (e: Error) => { for (const p of pending.values()) p.reject(e); pending.clear(); worker = null; };
  w.on('error', fail);
  w.on('exit', (code) => fail(new Error(`Поток формы Т-7 завершился (код ${code})`)));
  w.unref();
  return w;
}

export function renderT7(data: T7Data): Promise<Buffer> {
  if (__filename.endsWith('.ts')) return buildT7(data);
  worker ??= start();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, data });
  });
}

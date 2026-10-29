// Поток сборки формы Т-7 (v1.0.0, E51-06): книга XLSX на 2000 сотрудников — около секунды работы
// процессора (ExcelJS и сжатие); в основном потоке она останавливала все запросы процесса.
import { parentPort } from 'node:worker_threads';
import { buildT7 } from './t7';
import type { T7Data } from './planning.service';

parentPort?.on('message', (msg: { id: number; data: T7Data }) => {
  buildT7(msg.data)
    .then((file) => parentPort?.postMessage({ id: msg.id, file }))
    .catch((e: Error) => parentPort?.postMessage({ id: msg.id, error: e.message }));
});

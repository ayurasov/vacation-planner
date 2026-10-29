// SMTP-приёмник для нагрузочных прогонов (E51-03): принимает письма и считает их, ничего не отправляет.
// Без зависимостей. Сервер планировщика направляется на него: SMTP_HOST=127.0.0.1 SMTP_PORT=2525.
//
//   node tools/load/smtp-sink.mjs --port 2525 --out mail.csv
//
// CSV: время приёма письма (мс от запуска) и адрес — по нему видно, с какой скоростью разбирается очередь.
// Раз в 10 секунд печатает число принятых писем и скорость за интервал.
import { createServer } from 'node:net';
import { appendFileSync, writeFileSync } from 'node:fs';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const PORT = Number(arg('port', 2525));
const OUT = arg('out', '');
const started = Date.now();
let total = 0;
let last = 0;
if (OUT) writeFileSync(OUT, 'ms,to\n');

createServer((socket) => {
  let buf = '';
  let data = false;
  let to = '';
  const reply = (line) => socket.write(`${line}\r\n`);
  reply('220 load-sink ESMTP');
  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (data) {
        if (line === '.') {
          data = false;
          total++;
          if (OUT) appendFileSync(OUT, `${Date.now() - started},${to}\n`);
          reply('250 2.0.0 accepted');
        }
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') { reply('250-load-sink'); reply('250 8BITMIME'); }
      else if (cmd === 'HELO') reply('250 load-sink');
      else if (cmd === 'MAIL') { to = ''; reply('250 2.1.0 ok'); }
      else if (cmd === 'RCPT') { to = /<([^>]*)>/.exec(line)?.[1] ?? ''; reply('250 2.1.5 ok'); }
      else if (cmd === 'DATA') { data = true; reply('354 end with <CRLF>.<CRLF>'); }
      else if (cmd === 'RSET' || cmd === 'NOOP') reply('250 ok');
      else if (cmd === 'QUIT') { reply('221 bye'); socket.end(); }
      else reply('502 not implemented');
    }
  });
  socket.on('error', () => {});
}).listen(PORT, '127.0.0.1', () => console.log(`SMTP-приёмник: 127.0.0.1:${PORT}`));

setInterval(() => {
  if (total !== last) console.log(`${Math.round((Date.now() - started) / 1000)} с: принято ${total} (+${total - last} за 10 с)`);
  last = total;
}, 10_000);

# О документе

Программа «Планировщик отпусков» включает свободные компоненты третьих лиц. Документ перечисляет компоненты, которые входят в поставку версии 1.0.0: библиотеки серверной части в образе `server` и библиотеки, собранные в веб-интерфейс (образ `web`), — с версиями, лицензиями и уведомлениями об авторском праве, а также программы в образах контейнеров, которые поставляются вместе с программой. Компоненты, нужные только для сборки, разработки и тестирования, в поставку не входят; они перечислены в отчёте «SBOM и анализ лицензий» (`docs/sbom/licenses-report.md`) и в перечне `docs/sbom/sbom-components.csv` со значением `dev` в колонке `scope`.

Документ сформирован автоматически скриптом `scripts/third-party-notices.mjs` из SBOM и вручную не правится. Полные тексты лицензий приведены в реестре SPDX (ссылки в разделах ниже) и поставляются в составе образа `server` в каталогах самих пакетов (`node_modules/<пакет>/LICENSE`, `NOTICE`); для веб-интерфейса, где библиотеки собраны в один файл, этот документ входит в комплект поставки.

| Параметр | Значение |
| --- | --- |
| Программа, версия | «Планировщик отпусков» 1.0.0 |
| Источник | `sbom/server.cdx.json`, `sbom/web.cdx.json` — CycloneDX 1.5, cyclonedx-npm по `package-lock.json` |
| Дата формирования | 2026-10-29 |
| Компонентов в SBOM (уникальных name@version) | server — 727, web — 421 |
| Сверка SBOM с `package-lock.json` | server — совпадает, web — совпадает; в метаданных SBOM указана версия 0.6.0: SBOM сформирован до смены номера версии, состав зависимостей тот же |
| В поставке | 344: сервер — 336, веб-интерфейс — 8 |
| Строки об авторском праве | Из файлов LICENSE пакетов: найдены для 342 из 344 компонентов |

## Как определён состав поставки

| Часть | Правило | Проверка |
| --- | --- | --- |
| Сервер | `npm prune --omit=dev` в `server/Dockerfile`: в образ входят компоненты SBOM без признака `cdx:npm:package:development` | Совпадает с замыканием `dependencies` из `server/package.json` по графу зависимостей SBOM; необязательные peer-зависимости `typescript@5.9.3` удовлетворяются пакетами разработки и в поставку не входят |
| Веб-интерфейс | Vite собирает в SPA только импортируемый код: замыкание `dependencies` из `web/package.json` без пакетов, работающих лишь при сборке (раздел «Веб-интерфейс: состав сборки») | Прямые зависимости: pinia, vue, vue-router; сверено со сборкой `web/dist`: заголовки лицензий `@vue/reactivity`, `@vue/runtime-core`, `@vue/runtime-dom`, `@vue/shared`, `pinia`, `vue-router` — все в перечне; необязательные peer-зависимости `typescript@5.9.3` удовлетворяются пакетами разработки и в поставку не входят |

# Сводка по лицензиям

| Лицензия (SPDX) | Категория | Сервер | Веб-интерфейс | Обязанности |
| --- | --- | --- | --- | --- |
| `MIT` | Разрешительная | 290 | 8 | Сохранять уведомление об авторском праве и текст разрешения во всех копиях и существенных частях |
| `ISC` | Разрешительная | 16 | 0 | Сохранять уведомление об авторском праве и текст разрешения во всех копиях и существенных частях |
| `Apache-2.0` | Разрешительная | 15 | 0 | Передавать копию лицензии; сохранять уведомления об авторском праве, патентах и товарных знаках и файл NOTICE (если есть); помечать изменённые файлы |
| `BSD-3-Clause` | Разрешительная | 5 | 0 | Сохранять уведомление об авторском праве, перечень условий и отказ от гарантий; при распространении в двоичном виде — воспроизводить их в документации; не использовать имена авторов для продвижения без их разрешения |
| `BSD-2-Clause` | Разрешительная | 3 | 0 | Сохранять уведомление об авторском праве, перечень условий и отказ от гарантий; при распространении в двоичном виде — воспроизводить их в документации |
| `(MIT AND Zlib)` | Разрешительная | 1 | 0 | Выполнять условия обеих лицензий: сохранять уведомления, не искажать происхождение, помечать изменённые версии |
| `(MIT OR GPL-3.0-or-later)` | Двойная: применяется MIT | 1 | 0 | Используется на условиях MIT: сохранять уведомление об авторском праве и текст разрешения во всех копиях и существенных частях |
| `0BSD` | Разрешительная без условий | 1 | 0 | Условий нет; сведения приводятся для полноты |
| `MIT-0` | Разрешительная без условий | 1 | 0 | Условий нет; сведения приводятся для полноты |
| `MIT/X11` | Разрешительная | 1 | 0 | Сохранять уведомление об авторском праве и текст разрешения во всех копиях и существенных частях |
| `PSF-2.0` | Разрешительная | 1 | 0 | Сохранять уведомление об авторском праве PSF и текст лицензии |
| `Unlicense` | Общественное достояние | 1 | 0 | Условий нет; сведения приводятся для полноты |
| **Всего** | | **336** | **8** | |

Компонентов с сильным копилефтом (GPL, AGPL) среди библиотек, связываемых с кодом программы, нет. Компонент с двойной лицензией, включающей GPL (jszip), используется на условиях разрешительной альтернативы. Компонентов со слабым копилефтом (LGPL, MPL) среди библиотек нет. Лицензионные платежи за компоненты не требуются.

# Компоненты по лицензиям

## MIT — MIT License

Разрешительная. Сохранять уведомление об авторском праве и текст разрешения во всех копиях и существенных частях. Текст лицензии: <https://spdx.org/licenses/MIT.html>.

| Компонент | Версия | Часть | Уведомление об авторском праве |
| --- | --- | --- | --- |
| [@borewit/text-codec](https://www.npmjs.com/package/@borewit/text-codec) | 0.2.2 | сервер | Copyright © 2025 Borewit |
| [@fast-csv/format](https://www.npmjs.com/package/@fast-csv/format) | 4.3.5 | сервер | Copyright (c) 2011-2019 C2FO |
| [@fast-csv/parse](https://www.npmjs.com/package/@fast-csv/parse) | 4.3.6 | сервер | Copyright (c) 2011-2019 C2FO |
| [@lukeed/csprng](https://www.npmjs.com/package/@lukeed/csprng) | 1.1.0 | сервер | Copyright (c) Luke Edwards &lt;luke.edwards05@gmail.com&gt; (lukeed.com) |
| [@microsoft/tsdoc](https://www.npmjs.com/package/@microsoft/tsdoc) | 0.16.0 | сервер | Copyright (c) Microsoft Corporation. All rights reserved. |
| [@nestjs/common](https://www.npmjs.com/package/@nestjs/common) | 11.2.8 | сервер | Copyright (c) 2017-present Kamil Mysliwiec &lt;https://kamilmysliwiec.com&gt; |
| [@nestjs/config](https://www.npmjs.com/package/@nestjs/config) | 4.0.4 | сервер | Copyright (c) 2020-2022 Kamil Mysliwiec |
| [@nestjs/core](https://www.npmjs.com/package/@nestjs/core) | 11.2.8 | сервер | Copyright (c) 2017-present Kamil Mysliwiec &lt;https://kamilmysliwiec.com&gt; |
| [@nestjs/mapped-types](https://www.npmjs.com/package/@nestjs/mapped-types) | 2.1.1 | сервер | Copyright (c) 2020-2022 Kamil Mysliwiec |
| [@nestjs/platform-express](https://www.npmjs.com/package/@nestjs/platform-express) | 11.2.8 | сервер | Copyright (c) 2017-present Kamil Mysliwiec &lt;https://kamilmysliwiec.com&gt; |
| [@nestjs/swagger](https://www.npmjs.com/package/@nestjs/swagger) | 11.4.7 | сервер | Copyright (c) 2020-2022 Kamil Mysliwiec |
| [@standard-schema/spec](https://www.npmjs.com/package/@standard-schema/spec) | 1.1.0 | сервер | Copyright (c) 2024 Colin McDonnell |
| [@tokenizer/inflate](https://www.npmjs.com/package/@tokenizer/inflate) | 0.4.1 | сервер | Copyright (c) 2024, Borewit |
| [@tokenizer/token](https://www.npmjs.com/package/@tokenizer/token) | 0.3.0 | сервер | Автор: Borewit |
| [@types/node](https://www.npmjs.com/package/@types/node) | 14.18.63 | сервер | Copyright (c) Microsoft Corporation. |
| [@types/validator](https://www.npmjs.com/package/@types/validator) | 13.15.10 | сервер | Copyright (c) Microsoft Corporation. |
| [@vue/reactivity](https://www.npmjs.com/package/@vue/reactivity) | 3.5.44 | веб-интерфейс | Copyright (c) 2018-present, Yuxi (Evan) You |
| [@vue/runtime-core](https://www.npmjs.com/package/@vue/runtime-core) | 3.5.44 | веб-интерфейс | Copyright (c) 2018-present, Yuxi (Evan) You |
| [@vue/runtime-dom](https://www.npmjs.com/package/@vue/runtime-dom) | 3.5.44 | веб-интерфейс | Copyright (c) 2018-present, Yuxi (Evan) You |
| [@vue/shared](https://www.npmjs.com/package/@vue/shared) | 3.5.44 | веб-интерфейс | Copyright (c) 2018-present, Yuxi (Evan) You |
| [accepts](https://www.npmjs.com/package/accepts) | 1.3.8 | сервер | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [accepts](https://www.npmjs.com/package/accepts) | 2.0.0 | сервер | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [append-field](https://www.npmjs.com/package/append-field) | 1.0.0 | сервер | Copyright (c) 2015 Linus Unnebäck |
| [archiver](https://www.npmjs.com/package/archiver) | 5.3.2 | сервер | Copyright (c) 2012-2014 Chris Talkington, contributors. |
| [archiver-utils](https://www.npmjs.com/package/archiver-utils) | 2.1.0 | сервер | Copyright (c) 2015 Chris Talkington. |
| [archiver-utils](https://www.npmjs.com/package/archiver-utils) | 3.0.4 | сервер | Copyright (c) 2015 Chris Talkington. |
| [array-buffer-byte-length](https://www.npmjs.com/package/array-buffer-byte-length) | 1.0.2 | сервер | Copyright (c) 2023 Inspect JS |
| [array-flatten](https://www.npmjs.com/package/array-flatten) | 1.1.1 | сервер | Copyright (c) 2014 Blake Embrey (hello@blakeembrey.com) |
| [arraybuffer.prototype.slice](https://www.npmjs.com/package/arraybuffer.prototype.slice) | 1.0.4 | сервер | Copyright (c) 2023 ECMAScript Shims |
| [async](https://www.npmjs.com/package/async) | 3.2.6 | сервер | Copyright (c) 2010-2018 Caolan McMahon |
| [async-function](https://www.npmjs.com/package/async-function) | 1.0.0 | сервер | Copyright (c) 2016 EduardoRFS |
| [available-typed-arrays](https://www.npmjs.com/package/available-typed-arrays) | 1.0.7 | сервер | Copyright (c) 2020 Inspect JS |
| [balanced-match](https://www.npmjs.com/package/balanced-match) | 1.0.2 | сервер | Copyright (c) 2013 Julian Gruber &lt;julian@juliangruber.com&gt; |
| [base64-js](https://www.npmjs.com/package/base64-js) | 1.5.1 | сервер | Copyright (c) 2014 Jameson Little |
| [binary](https://www.npmjs.com/package/binary) | 0.3.0 | сервер | Автор: James Halliday |
| [bl](https://www.npmjs.com/package/bl) | 4.1.0 | сервер | Copyright (c) 2013-2019 bl contributors |
| [bluebird](https://www.npmjs.com/package/bluebird) | 3.4.7 | сервер | Copyright (c) 2013-2015 Petka Antonov |
| [body-parser](https://www.npmjs.com/package/body-parser) | 1.20.9 | сервер | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2014-2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [body-parser](https://www.npmjs.com/package/body-parser) | 2.4.0 | сервер | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2014-2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [brace-expansion](https://www.npmjs.com/package/brace-expansion) | 1.1.21 | сервер | Copyright (c) 2013 Julian Gruber &lt;julian@juliangruber.com&gt; |
| [brace-expansion](https://www.npmjs.com/package/brace-expansion) | 2.1.7 | сервер | Copyright (c) 2013 Julian Gruber &lt;julian@juliangruber.com&gt; |
| [buffer](https://www.npmjs.com/package/buffer) | 5.7.1 | сервер | Copyright (c) Feross Aboukhadijeh, and other contributors. |
| [buffer-crc32](https://www.npmjs.com/package/buffer-crc32) | 0.2.13 | сервер | Copyright (c) 2013 Brian J. Brennan |
| [buffer-indexof-polyfill](https://www.npmjs.com/package/buffer-indexof-polyfill) | 1.0.2 | сервер | Copyright (c) 2015 Sarosia |
| [buffers](https://www.npmjs.com/package/buffers) \* | 0.1.1 | сервер | Автор: James Halliday &lt;mail@substack.net&gt; (http://substack.net) |
| [busboy](https://www.npmjs.com/package/busboy) \* | 1.6.0 | сервер | Copyright Brian White. All rights reserved. |
| [bytes](https://www.npmjs.com/package/bytes) | 3.1.2 | сервер | Copyright (c) 2012-2014 TJ Holowaychuk &lt;tj@vision-media.ca&gt;; Copyright (c) 2015 Jed Watson &lt;jed.watson@me.com&gt; |
| [c12](https://www.npmjs.com/package/c12) | 3.1.0 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt; |
| [call-bind](https://www.npmjs.com/package/call-bind) | 1.0.9 | сервер | Copyright (c) 2020 Jordan Harband |
| [call-bind-apply-helpers](https://www.npmjs.com/package/call-bind-apply-helpers) | 1.0.2 | сервер | Copyright (c) 2024 Jordan Harband |
| [call-bound](https://www.npmjs.com/package/call-bound) | 1.0.4 | сервер | Copyright (c) 2024 Jordan Harband |
| [chokidar](https://www.npmjs.com/package/chokidar) | 4.0.3 | сервер | Copyright (c) 2012 Paul Miller (https://paulmillr.com), Elan Shanker |
| [citty](https://www.npmjs.com/package/citty) | 0.1.6 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt;; Copyright (c) Luke Edwards luke.edwards05@gmail.com (lukeed.com) |
| [citty](https://www.npmjs.com/package/citty) | 0.2.2 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt; |
| [class-transformer](https://www.npmjs.com/package/class-transformer) | 0.5.1 | сервер | Copyright (c) 2015-2020 TypeStack |
| [class-validator](https://www.npmjs.com/package/class-validator) | 0.14.4 | сервер | Copyright (c) 2015-2020 TypeStack |
| [compress-commons](https://www.npmjs.com/package/compress-commons) | 4.1.2 | сервер | Copyright (c) 2014 Chris Talkington, contributors. |
| [concat-map](https://www.npmjs.com/package/concat-map) | 0.0.1 | сервер | Автор: James Halliday |
| [confbox](https://www.npmjs.com/package/confbox) | 0.2.4 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt; |
| [confbox](https://www.npmjs.com/package/confbox) | 0.3.1 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt; |
| [consola](https://www.npmjs.com/package/consola) | 3.4.2 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt;; Copyright (c) Nate Moore; Copyright © Jorge Bucaran &lt;https://jorgebucaran.com&gt; |
| [content-disposition](https://www.npmjs.com/package/content-disposition) | 0.5.4 | сервер | Copyright (c) 2014-2017 Douglas Christopher Wilson |
| [content-disposition](https://www.npmjs.com/package/content-disposition) | 1.1.0 | сервер | Copyright (c) 2014-2017 Douglas Christopher Wilson |
| [content-type](https://www.npmjs.com/package/content-type) | 1.0.5 | сервер | Copyright (c) 2015 Douglas Christopher Wilson |
| [content-type](https://www.npmjs.com/package/content-type) | 2.1.0 | сервер | Copyright (c) 2015 Douglas Christopher Wilson |
| [cookie](https://www.npmjs.com/package/cookie) | 0.7.2 | сервер | Copyright (c) 2012-2014 Roman Shtylman &lt;shtylman@gmail.com&gt;; Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [cookie-parser](https://www.npmjs.com/package/cookie-parser) | 1.4.7 | сервер | Copyright (c) 2014 TJ Holowaychuk &lt;tj@vision-media.ca&gt;; Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [cookie-signature](https://www.npmjs.com/package/cookie-signature) | 1.0.6 | сервер | Автор: TJ Holowaychuk &lt;tj@learnboost.com&gt; |
| [cookie-signature](https://www.npmjs.com/package/cookie-signature) | 1.2.2 | сервер | Copyright (c) 2012–2024 LearnBoost &lt;tj@learnboost.com&gt; and other contributors; |
| [core-util-is](https://www.npmjs.com/package/core-util-is) | 1.0.3 | сервер | Copyright Node.js contributors. All rights reserved. |
| [cors](https://www.npmjs.com/package/cors) | 2.8.6 | сервер | Copyright (c) 2013 Troy Goode &lt;troygoode@gmail.com&gt; |
| [crc32-stream](https://www.npmjs.com/package/crc32-stream) | 4.0.3 | сервер | Copyright (c) 2014 Chris Talkington, contributors. |
| [data-view-buffer](https://www.npmjs.com/package/data-view-buffer) | 1.0.2 | сервер | Copyright (c) 2023 Jordan Harband |
| [data-view-byte-length](https://www.npmjs.com/package/data-view-byte-length) | 1.0.2 | сервер | Copyright (c) 2024 Jordan Harband |
| [data-view-byte-offset](https://www.npmjs.com/package/data-view-byte-offset) | 1.0.1 | сервер | Copyright (c) 2024 Jordan Harband |
| [dayjs](https://www.npmjs.com/package/dayjs) | 1.11.23 | сервер | Copyright (c) 2018-present, iamkun |
| [debug](https://www.npmjs.com/package/debug) | 2.6.9 | сервер | Copyright (c) 2014 TJ Holowaychuk &lt;tj@vision-media.ca&gt; |
| [debug](https://www.npmjs.com/package/debug) | 4.4.3 | сервер | Copyright (c) 2014-2017 TJ Holowaychuk &lt;tj@vision-media.ca&gt;; Copyright (c) 2018-2021 Josh Junon |
| [define-data-property](https://www.npmjs.com/package/define-data-property) | 1.1.4 | сервер | Copyright (c) 2023 Jordan Harband |
| [define-properties](https://www.npmjs.com/package/define-properties) | 1.2.1 | сервер | Copyright (C) 2015 Jordan Harband |
| [defu](https://www.npmjs.com/package/defu) | 6.1.7 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt; |
| [depd](https://www.npmjs.com/package/depd) | 2.0.0 | сервер | Copyright (c) 2014-2018 Douglas Christopher Wilson |
| [destr](https://www.npmjs.com/package/destr) | 2.0.5 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt; |
| [destroy](https://www.npmjs.com/package/destroy) | 1.2.0 | сервер | Copyright (c) 2014 Jonathan Ong me@jongleberry.com; Copyright (c) 2015-2022 Douglas Christopher Wilson doug@somethingdoug.com |
| [dunder-proto](https://www.npmjs.com/package/dunder-proto) | 1.0.1 | сервер | Copyright (c) 2024 ECMAScript Shims |
| [ee-first](https://www.npmjs.com/package/ee-first) | 1.1.1 | сервер | Copyright (c) 2014 Jonathan Ong me@jongleberry.com |
| [effect](https://www.npmjs.com/package/effect) | 3.21.0 | сервер | Copyright (c) 2023 Effectful Technologies Inc |
| [empathic](https://www.npmjs.com/package/empathic) | 2.0.0 | сервер | Copyright (c) Luke Edwards &lt;luke.edwards05@gmail.com&gt; (lukeed.com) |
| [encodeurl](https://www.npmjs.com/package/encodeurl) | 2.0.0 | сервер | Copyright (c) 2016 Douglas Christopher Wilson |
| [end-of-stream](https://www.npmjs.com/package/end-of-stream) | 1.4.5 | сервер | Copyright (c) 2014 Mathias Buus |
| [es-abstract](https://www.npmjs.com/package/es-abstract) | 1.24.2 | сервер | Copyright (C) 2015 Jordan Harband |
| [es-abstract-get](https://www.npmjs.com/package/es-abstract-get) | 1.0.0 | сервер | Copyright (c) 2026 Jordan Harband |
| [es-define-property](https://www.npmjs.com/package/es-define-property) | 1.0.1 | сервер | Copyright (c) 2024 Jordan Harband |
| [es-errors](https://www.npmjs.com/package/es-errors) | 1.3.0 | сервер | Copyright (c) 2024 Jordan Harband |
| [es-object-atoms](https://www.npmjs.com/package/es-object-atoms) | 1.1.2 | сервер | Copyright (c) 2024 Jordan Harband |
| [es-set-tostringtag](https://www.npmjs.com/package/es-set-tostringtag) | 2.1.0 | сервер | Copyright (c) 2022 ECMAScript Shims |
| [es-to-primitive](https://www.npmjs.com/package/es-to-primitive) | 1.3.4 | сервер | Copyright (c) 2015 Jordan Harband |
| [escape-html](https://www.npmjs.com/package/escape-html) | 1.0.3 | сервер | Copyright (c) 2012-2013 TJ Holowaychuk; Copyright (c) 2015 Andreas Lubbe; Copyright (c) 2015 Tiancheng "Timothy" Gu |
| [etag](https://www.npmjs.com/package/etag) | 1.8.1 | сервер | Copyright (c) 2014-2016 Douglas Christopher Wilson |
| [exceljs](https://www.npmjs.com/package/exceljs) | 4.4.0 | сервер | Copyright (c) 2014-2019 Guyon Roche |
| [express](https://www.npmjs.com/package/express) | 4.22.3 | сервер | Copyright (c) 2009-2014 TJ Holowaychuk &lt;tj@vision-media.ca&gt;; Copyright (c) 2013-2014 Roman Shtylman &lt;shtylman+expressjs@gmail.com&gt;; Copyright (c) 2014-2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [express](https://www.npmjs.com/package/express) | 5.2.1 | сервер | Copyright (c) 2009-2014 TJ Holowaychuk &lt;tj@vision-media.ca&gt;; Copyright (c) 2013-2014 Roman Shtylman &lt;shtylman+expressjs@gmail.com&gt;; Copyright (c) 2014-2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [exsolve](https://www.npmjs.com/package/exsolve) | 1.2.0 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt;; Copyright (c) 2021 Titus Wormer &lt;mailto:tituswormer@gmail.com&gt;; Copyright Node.js contributors. All rights reserved.; и др. — см. LICENSE пакета |
| [fast-check](https://www.npmjs.com/package/fast-check) | 3.23.2 | сервер | Copyright (c) 2017 Nicolas DUBIEN |
| [fast-csv](https://www.npmjs.com/package/fast-csv) | 4.3.6 | сервер | Copyright (c) 2011-2019 C2FO |
| [fast-safe-stringify](https://www.npmjs.com/package/fast-safe-stringify) | 2.1.1 | сервер | Copyright (c) 2016 David Mark Clements; Copyright (c) 2017 David Mark Clements & Matteo Collina; Copyright (c) 2018 David Mark Clements, Matteo Collina & Ruben Bridgewater |
| [file-type](https://www.npmjs.com/package/file-type) | 21.3.4 | сервер | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) |
| [finalhandler](https://www.npmjs.com/package/finalhandler) | 1.3.2 | сервер | Copyright (c) 2014-2022 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [finalhandler](https://www.npmjs.com/package/finalhandler) | 2.1.1 | сервер | Copyright (c) 2014-2022 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [for-each](https://www.npmjs.com/package/for-each) | 0.3.5 | сервер | Copyright (c) 2012 Raynos. |
| [forwarded](https://www.npmjs.com/package/forwarded) | 0.2.0 | сервер | Copyright (c) 2014-2017 Douglas Christopher Wilson |
| [fresh](https://www.npmjs.com/package/fresh) | 0.5.2 | сервер | Copyright (c) 2012 TJ Holowaychuk &lt;tj@vision-media.ca&gt;; Copyright (c) 2016-2017 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [fresh](https://www.npmjs.com/package/fresh) | 2.0.0 | сервер | Copyright (c) 2012 TJ Holowaychuk &lt;tj@vision-media.ca&gt;; Copyright (c) 2016-2017 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [fs-constants](https://www.npmjs.com/package/fs-constants) | 1.0.0 | сервер | Copyright (c) 2018 Mathias Buus |
| [function-bind](https://www.npmjs.com/package/function-bind) | 1.1.2 | сервер | Copyright (c) 2013 Raynos. |
| [function.prototype.name](https://www.npmjs.com/package/function.prototype.name) | 1.2.0 | сервер | Copyright (c) 2016 Jordan Harband |
| [functions-have-names](https://www.npmjs.com/package/functions-have-names) | 1.2.3 | сервер | Copyright (c) 2019 Jordan Harband |
| [generator-function](https://www.npmjs.com/package/generator-function) | 2.0.1 | сервер | Copyright (c) 2015 Tiancheng “Timothy” Gu |
| [get-intrinsic](https://www.npmjs.com/package/get-intrinsic) | 1.3.0 | сервер | Copyright (c) 2020 Jordan Harband |
| [get-proto](https://www.npmjs.com/package/get-proto) | 1.0.1 | сервер | Copyright (c) 2025 Jordan Harband |
| [get-symbol-description](https://www.npmjs.com/package/get-symbol-description) | 1.1.0 | сервер | Copyright (c) 2021 Inspect JS |
| [giget](https://www.npmjs.com/package/giget) | 2.0.0 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt;; Copyright (c) Isaac Z. Schlueter and Contributors; Copyright (c) 2017-2023 npm, Inc., Isaac Z. Schlueter, and Contributors; и др. — см. LICENSE пакета |
| [globalthis](https://www.npmjs.com/package/globalthis) | 1.0.4 | сервер | Copyright (c) 2016 Jordan Harband |
| [gopd](https://www.npmjs.com/package/gopd) | 1.2.0 | сервер | Copyright (c) 2022 Jordan Harband |
| [has-bigints](https://www.npmjs.com/package/has-bigints) | 1.1.0 | сервер | Copyright (c) 2019 Jordan Harband |
| [has-property-descriptors](https://www.npmjs.com/package/has-property-descriptors) | 1.0.2 | сервер | Copyright (c) 2022 Inspect JS |
| [has-proto](https://www.npmjs.com/package/has-proto) | 1.2.0 | сервер | Copyright (c) 2022 Inspect JS |
| [has-symbols](https://www.npmjs.com/package/has-symbols) | 1.1.0 | сервер | Copyright (c) 2016 Jordan Harband |
| [has-tostringtag](https://www.npmjs.com/package/has-tostringtag) | 1.0.2 | сервер | Copyright (c) 2021 Inspect JS |
| [hasown](https://www.npmjs.com/package/hasown) | 2.0.4 | сервер | Copyright (c) Jordan Harband and contributors |
| [http-errors](https://www.npmjs.com/package/http-errors) | 2.0.1 | сервер | Copyright (c) 2014 Jonathan Ong me@jongleberry.com; Copyright (c) 2016 Douglas Christopher Wilson doug@somethingdoug.com |
| [iconv-lite](https://www.npmjs.com/package/iconv-lite) | 0.4.24 | сервер | Copyright (c) 2011 Alexander Shtuchkin |
| [iconv-lite](https://www.npmjs.com/package/iconv-lite) | 0.7.3 | сервер | Copyright (c) 2011 Alexander Shtuchkin |
| [immediate](https://www.npmjs.com/package/immediate) | 3.0.6 | сервер | Copyright (c) 2012 Barnesandnoble.com, llc, Donavon West, Domenic Denicola, Brian Cavalier |
| [internal-slot](https://www.npmjs.com/package/internal-slot) | 1.1.0 | сервер | Copyright (c) 2019 Jordan Harband |
| [ipaddr.js](https://www.npmjs.com/package/ipaddr.js) | 1.9.1 | сервер | Copyright (C) 2011-2017 whitequark &lt;whitequark@whitequark.org&gt; |
| [is-array-buffer](https://www.npmjs.com/package/is-array-buffer) | 3.0.5 | сервер | Copyright (c) 2015 Chen Gengyuan, Inspect JS |
| [is-async-function](https://www.npmjs.com/package/is-async-function) | 2.1.1 | сервер | Copyright (c) 2021 Jordan Harband |
| [is-bigint](https://www.npmjs.com/package/is-bigint) | 1.1.0 | сервер | Copyright (c) 2018 Jordan Harband |
| [is-boolean-object](https://www.npmjs.com/package/is-boolean-object) | 1.2.2 | сервер | Copyright (c) 2015 Jordan Harband |
| [is-callable](https://www.npmjs.com/package/is-callable) | 1.2.7 | сервер | Copyright (c) 2015 Jordan Harband |
| [is-data-view](https://www.npmjs.com/package/is-data-view) | 1.0.2 | сервер | Copyright (c) 2024 Inspect JS |
| [is-date-object](https://www.npmjs.com/package/is-date-object) | 1.1.0 | сервер | Copyright (c) 2015 Jordan Harband |
| [is-document.all](https://www.npmjs.com/package/is-document.all) | 1.0.0 | сервер | Copyright (c) 2026 Inspect JS |
| [is-finalizationregistry](https://www.npmjs.com/package/is-finalizationregistry) | 1.1.1 | сервер | Copyright (c) 2020 Inspect JS |
| [is-generator-function](https://www.npmjs.com/package/is-generator-function) | 1.1.2 | сервер | Copyright (c) 2014 Jordan Harband |
| [is-map](https://www.npmjs.com/package/is-map) | 2.0.3 | сервер | Copyright (c) 2019 Inspect JS |
| [is-negative-zero](https://www.npmjs.com/package/is-negative-zero) | 2.0.3 | сервер | Copyright (c) 2014 Jordan Harband |
| [is-number-object](https://www.npmjs.com/package/is-number-object) | 1.1.1 | сервер | Copyright (c) 2015 Jordan Harband |
| [is-promise](https://www.npmjs.com/package/is-promise) | 4.0.0 | сервер | Copyright (c) 2014 Forbes Lindesay |
| [is-regex](https://www.npmjs.com/package/is-regex) | 1.2.1 | сервер | Copyright (c) 2014 Jordan Harband |
| [is-set](https://www.npmjs.com/package/is-set) | 2.0.3 | сервер | Copyright (c) 2019 Inspect JS |
| [is-shared-array-buffer](https://www.npmjs.com/package/is-shared-array-buffer) | 1.0.4 | сервер | Copyright (c) 2021 Inspect JS |
| [is-string](https://www.npmjs.com/package/is-string) | 1.1.1 | сервер | Copyright (c) 2015 Jordan Harband |
| [is-symbol](https://www.npmjs.com/package/is-symbol) | 1.1.1 | сервер | Copyright (c) 2015 Jordan Harband |
| [is-typed-array](https://www.npmjs.com/package/is-typed-array) | 1.1.15 | сервер | Copyright (c) 2015 Jordan Harband |
| [is-weakmap](https://www.npmjs.com/package/is-weakmap) | 2.0.2 | сервер | Copyright (c) 2019 Inspect JS |
| [is-weakref](https://www.npmjs.com/package/is-weakref) | 1.1.1 | сервер | Copyright (c) 2020 Inspect JS |
| [is-weakset](https://www.npmjs.com/package/is-weakset) | 2.0.4 | сервер | Copyright (c) 2019 Inspect JS |
| [isarray](https://www.npmjs.com/package/isarray) | 1.0.0 | сервер | Автор: Julian Gruber |
| [isarray](https://www.npmjs.com/package/isarray) | 2.0.5 | сервер | Copyright (c) 2013 Julian Gruber &lt;julian@juliangruber.com&gt; |
| [jiti](https://www.npmjs.com/package/jiti) | 2.7.0 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt; |
| [js-yaml](https://www.npmjs.com/package/js-yaml) | 5.5.0 | сервер | Copyright (C) 2011-2015 by Vitaly Puzrin |
| [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken) | 9.0.3 | сервер | Copyright (c) 2015 Auth0, Inc. &lt;support@auth0.com&gt; (http://auth0.com) |
| [jwa](https://www.npmjs.com/package/jwa) | 2.0.1 | сервер | Copyright (c) 2013 Brian J. Brennan |
| [jws](https://www.npmjs.com/package/jws) | 4.0.1 | сервер | Copyright (c) 2013 Brian J. Brennan |
| [lazystream](https://www.npmjs.com/package/lazystream) | 1.0.1 | сервер | Copyright (c) 2013 J. Pommerening, contributors. |
| [libphonenumber-js](https://www.npmjs.com/package/libphonenumber-js) | 1.13.15 | сервер | Copyright (c) 2016 @catamphetamine &lt;purecatamphetamine@gmail.com&gt; |
| [lie](https://www.npmjs.com/package/lie) | 3.3.0 | сервер | — |
| [load-esm](https://www.npmjs.com/package/load-esm) | 1.0.3 | сервер | Copyright © 2025 Borewit |
| [lodash](https://www.npmjs.com/package/lodash) | 4.18.1 | сервер | Copyright OpenJS Foundation and other contributors &lt;https://openjsf.org/&gt; |
| [lodash.defaults](https://www.npmjs.com/package/lodash.defaults) | 4.2.0 | сервер | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt; |
| [lodash.difference](https://www.npmjs.com/package/lodash.difference) | 4.5.0 | сервер | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt; |
| [lodash.escaperegexp](https://www.npmjs.com/package/lodash.escaperegexp) | 4.1.2 | сервер | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt; |
| [lodash.flatten](https://www.npmjs.com/package/lodash.flatten) | 4.4.0 | сервер | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt; |
| [lodash.groupby](https://www.npmjs.com/package/lodash.groupby) | 4.6.0 | сервер | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt; |
| [lodash.includes](https://www.npmjs.com/package/lodash.includes) | 4.3.0 | сервер | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt; |
| [lodash.isboolean](https://www.npmjs.com/package/lodash.isboolean) | 3.0.3 | сервер | Copyright 2012-2016 The Dojo Foundation &lt;http://dojofoundation.org/&gt; |
| [lodash.isequal](https://www.npmjs.com/package/lodash.isequal) | 4.5.0 | сервер | Copyright JS Foundation and other contributors &lt;https://js.foundation/&gt; |
| [lodash.isfunction](https://www.npmjs.com/package/lodash.isfunction) | 3.0.9 | сервер | Copyright JS Foundation and other contributors &lt;https://js.foundation/&gt; |
| [lodash.isinteger](https://www.npmjs.com/package/lodash.isinteger) | 4.0.4 | сервер | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt; |
| [lodash.isnil](https://www.npmjs.com/package/lodash.isnil) | 4.0.0 | сервер | Copyright 2012-2016 The Dojo Foundation &lt;http://dojofoundation.org/&gt; |
| [lodash.isnumber](https://www.npmjs.com/package/lodash.isnumber) | 3.0.3 | сервер | Copyright 2012-2016 The Dojo Foundation &lt;http://dojofoundation.org/&gt; |
| [lodash.isplainobject](https://www.npmjs.com/package/lodash.isplainobject) | 4.0.6 | сервер | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt; |
| [lodash.isstring](https://www.npmjs.com/package/lodash.isstring) | 4.0.1 | сервер | Copyright 2012-2016 The Dojo Foundation &lt;http://dojofoundation.org/&gt; |
| [lodash.isundefined](https://www.npmjs.com/package/lodash.isundefined) | 3.0.1 | сервер | Copyright 2012-2015 The Dojo Foundation &lt;http://dojofoundation.org/&gt; |
| [lodash.once](https://www.npmjs.com/package/lodash.once) | 4.1.1 | сервер | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt; |
| [lodash.union](https://www.npmjs.com/package/lodash.union) | 4.6.0 | сервер | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt; |
| [lodash.uniq](https://www.npmjs.com/package/lodash.uniq) | 4.5.0 | сервер | Copyright jQuery Foundation and other contributors &lt;https://jquery.org/&gt; |
| [math-intrinsics](https://www.npmjs.com/package/math-intrinsics) | 1.1.0 | сервер | Copyright (c) 2024 ECMAScript Shims |
| [media-typer](https://www.npmjs.com/package/media-typer) | 0.3.0 | сервер | Copyright (c) 2014 Douglas Christopher Wilson |
| [media-typer](https://www.npmjs.com/package/media-typer) | 1.1.1 | сервер | Copyright (c) 2014-2017 Douglas Christopher Wilson |
| [merge-descriptors](https://www.npmjs.com/package/merge-descriptors) | 1.0.3 | сервер | Copyright (c) 2013 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [merge-descriptors](https://www.npmjs.com/package/merge-descriptors) | 2.0.0 | сервер | Copyright (c) Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt;; Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) |
| [methods](https://www.npmjs.com/package/methods) | 1.1.2 | сервер | Copyright (c) 2013-2014 TJ Holowaychuk &lt;tj@vision-media.ca&gt;; Copyright (c) 2015-2016 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [mime](https://www.npmjs.com/package/mime) | 1.6.0 | сервер | Copyright (c) 2010 Benjamin Thomas, Robert Kieffer |
| [mime-db](https://www.npmjs.com/package/mime-db) | 1.52.0 | сервер | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2015-2022 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [mime-db](https://www.npmjs.com/package/mime-db) | 1.54.0 | сервер | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2015-2022 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [mime-types](https://www.npmjs.com/package/mime-types) | 2.1.35 | сервер | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [mime-types](https://www.npmjs.com/package/mime-types) | 3.0.2 | сервер | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [minimist](https://www.npmjs.com/package/minimist) | 1.2.8 | сервер | Автор: James Halliday |
| [mkdirp](https://www.npmjs.com/package/mkdirp) | 0.5.6 | сервер | Copyright 2010 James Halliday (mail@substack.net) |
| [ms](https://www.npmjs.com/package/ms) | 2.0.0 | сервер | Copyright (c) 2016 Zeit, Inc. |
| [ms](https://www.npmjs.com/package/ms) | 2.1.3 | сервер | Copyright (c) 2020 Vercel, Inc. |
| [multer](https://www.npmjs.com/package/multer) | 2.5.0 | сервер | Copyright (c) 2014 Hage Yaapa &lt;\[http://www.hacksparrow.com\](http://www.hacksparrow.com)&gt; |
| [negotiator](https://www.npmjs.com/package/negotiator) | 0.6.3 | сервер | Copyright (c) 2012-2014 Federico Romero; Copyright (c) 2012-2014 Isaac Z. Schlueter; Copyright (c) 2014-2015 Douglas Christopher Wilson |
| [negotiator](https://www.npmjs.com/package/negotiator) | 1.1.0 | сервер | Copyright (c) 2012-2014 Federico Romero; Copyright (c) 2012-2014 Isaac Z. Schlueter; Copyright (c) 2014-2015 Douglas Christopher Wilson |
| [node-fetch-native](https://www.npmjs.com/package/node-fetch-native) | 1.6.7 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt;; Copyright (c) 2016 - 2020 Node Fetch Team; Copyright (c) 2017 Toru Nagashima; и др. — см. LICENSE пакета |
| [normalize-path](https://www.npmjs.com/package/normalize-path) | 3.0.0 | сервер | Copyright (c) 2014-2018, Jon Schlinkert. |
| [nypm](https://www.npmjs.com/package/nypm) | 0.6.12 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt; |
| [object-assign](https://www.npmjs.com/package/object-assign) | 4.1.1 | сервер | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) |
| [object-inspect](https://www.npmjs.com/package/object-inspect) | 1.13.4 | сервер | Copyright (c) 2013 James Halliday |
| [object-keys](https://www.npmjs.com/package/object-keys) | 1.1.1 | сервер | Copyright (C) 2013 Jordan Harband |
| [object.assign](https://www.npmjs.com/package/object.assign) | 4.1.7 | сервер | Copyright (c) 2014 Jordan Harband |
| [ohash](https://www.npmjs.com/package/ohash) | 2.0.12 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt; |
| [on-finished](https://www.npmjs.com/package/on-finished) | 2.4.2 | сервер | Copyright (c) 2013 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2014 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [own-keys](https://www.npmjs.com/package/own-keys) | 1.0.2 | сервер | Copyright (c) 2024 Jordan Harband |
| [parseurl](https://www.npmjs.com/package/parseurl) | 1.3.3 | сервер | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2014-2017 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [path-is-absolute](https://www.npmjs.com/package/path-is-absolute) | 1.0.1 | сервер | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (sindresorhus.com) |
| [path-to-regexp](https://www.npmjs.com/package/path-to-regexp) | 0.1.13 | сервер | Copyright (c) 2014 Blake Embrey (hello@blakeembrey.com) |
| [path-to-regexp](https://www.npmjs.com/package/path-to-regexp) | 8.4.2 | сервер | Copyright (c) 2014 Blake Embrey (hello@blakeembrey.com) |
| [pathe](https://www.npmjs.com/package/pathe) | 2.0.3 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt; - Daniel Roe &lt;daniel@roe.dev&gt;; Copyright Joyent, Inc. and other Node contributors.; Copyright (c) 2023-present Fabio Spampinato |
| [perfect-debounce](https://www.npmjs.com/package/perfect-debounce) | 1.0.0 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt; |
| [pinia](https://www.npmjs.com/package/pinia) | 2.3.1 | веб-интерфейс | Copyright (c) 2019-present Eduardo San Martin Morote |
| [pkg-types](https://www.npmjs.com/package/pkg-types) | 2.4.0 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt; - Daniel Roe &lt;daniel@roe.dev&gt;; Copyright Joyent, Inc. and other Node contributors. |
| [possible-typed-array-names](https://www.npmjs.com/package/possible-typed-array-names) | 1.1.0 | сервер | Copyright (c) 2024 Jordan Harband |
| [process-nextick-args](https://www.npmjs.com/package/process-nextick-args) | 2.0.1 | сервер | — |
| [proxy-addr](https://www.npmjs.com/package/proxy-addr) | 2.0.8 | сервер | Copyright (c) 2014-2016 Douglas Christopher Wilson |
| [pure-rand](https://www.npmjs.com/package/pure-rand) | 6.1.0 | сервер | Copyright (c) 2018 Nicolas DUBIEN |
| [range-parser](https://www.npmjs.com/package/range-parser) | 1.2.1 | сервер | Copyright (c) 2012-2014 TJ Holowaychuk &lt;tj@vision-media.ca&gt;; Copyright (c) 2015-2016 Douglas Christopher Wilson &lt;doug@somethingdoug.com |
| [raw-body](https://www.npmjs.com/package/raw-body) | 2.5.3 | сервер | Copyright (c) 2013-2014 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2014-2022 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [raw-body](https://www.npmjs.com/package/raw-body) | 3.0.2 | сервер | Copyright (c) 2013-2014 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2014-2022 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [rc9](https://www.npmjs.com/package/rc9) | 2.1.2 | сервер | Copyright (c) Pooya Parsa &lt;pooya@pi0.io&gt;; Copyright (c) 2014, Hugh Kennedy |
| [readable-stream](https://www.npmjs.com/package/readable-stream) | 2.3.8 | сервер | Copyright Node.js contributors. All rights reserved.; Copyright Joyent, Inc. and other Node contributors. All rights reserved. |
| [readable-stream](https://www.npmjs.com/package/readable-stream) | 3.6.2 | сервер | Copyright Node.js contributors. All rights reserved.; Copyright Joyent, Inc. and other Node contributors. All rights reserved. |
| [readdirp](https://www.npmjs.com/package/readdirp) | 4.1.2 | сервер | Copyright (c) 2012-2019 Thorsten Lorenz, Paul Miller (https://paulmillr.com) |
| [reflect.getprototypeof](https://www.npmjs.com/package/reflect.getprototypeof) | 1.0.10 | сервер | Copyright (c) 2021 ECMAScript Shims |
| [regexp.prototype.flags](https://www.npmjs.com/package/regexp.prototype.flags) | 1.5.4 | сервер | Copyright (C) 2014 Jordan Harband |
| [router](https://www.npmjs.com/package/router) | 2.2.0 | сервер | Copyright (c) 2013 Roman Shtylman; Copyright (c) 2014-2022 Douglas Christopher Wilson |
| [safe-array-concat](https://www.npmjs.com/package/safe-array-concat) | 1.1.4 | сервер | Copyright (c) 2023 Jordan Harband |
| [safe-buffer](https://www.npmjs.com/package/safe-buffer) | 5.1.2 | сервер | Copyright (c) Feross Aboukhadijeh |
| [safe-buffer](https://www.npmjs.com/package/safe-buffer) | 5.2.1 | сервер | Copyright (c) Feross Aboukhadijeh |
| [safe-push-apply](https://www.npmjs.com/package/safe-push-apply) | 1.0.0 | сервер | Copyright (c) 2024 Jordan Harband |
| [safe-regex-test](https://www.npmjs.com/package/safe-regex-test) | 1.1.0 | сервер | Copyright (c) 2022 Jordan Harband |
| [safer-buffer](https://www.npmjs.com/package/safer-buffer) | 2.1.2 | сервер | Copyright (c) 2018 Nikita Skovoroda &lt;chalkerx@gmail.com&gt; |
| [send](https://www.npmjs.com/package/send) | 0.19.2 | сервер | Copyright (c) 2012 TJ Holowaychuk; Copyright (c) 2014-2022 Douglas Christopher Wilson |
| [send](https://www.npmjs.com/package/send) | 1.2.1 | сервер | Copyright (c) 2012 TJ Holowaychuk; Copyright (c) 2014-2022 Douglas Christopher Wilson |
| [serve-static](https://www.npmjs.com/package/serve-static) | 1.16.3 | сервер | Copyright (c) 2010 Sencha Inc.; Copyright (c) 2011 LearnBoost; Copyright (c) 2011 TJ Holowaychuk; и др. — см. LICENSE пакета |
| [serve-static](https://www.npmjs.com/package/serve-static) | 2.2.1 | сервер | Copyright (c) 2010 Sencha Inc.; Copyright (c) 2011 LearnBoost; Copyright (c) 2011 TJ Holowaychuk; и др. — см. LICENSE пакета |
| [set-function-length](https://www.npmjs.com/package/set-function-length) | 1.2.2 | сервер | Copyright (c) Jordan Harband and contributors |
| [set-function-name](https://www.npmjs.com/package/set-function-name) | 2.0.2 | сервер | Copyright (c) Jordan Harband and contributors |
| [set-proto](https://www.npmjs.com/package/set-proto) | 1.0.0 | сервер | Copyright (c) 2024 Jordan Harband |
| [setimmediate](https://www.npmjs.com/package/setimmediate) | 1.0.5 | сервер | Copyright (c) 2012 Barnesandnoble.com, llc, Donavon West, and Domenic Denicola |
| [side-channel](https://www.npmjs.com/package/side-channel) | 1.1.1 | сервер | Copyright (c) 2019 Jordan Harband |
| [side-channel-list](https://www.npmjs.com/package/side-channel-list) | 1.0.1 | сервер | Copyright (c) 2024 Jordan Harband |
| [side-channel-map](https://www.npmjs.com/package/side-channel-map) | 1.0.1 | сервер | Copyright (c) 2024 Jordan Harband |
| [side-channel-weakmap](https://www.npmjs.com/package/side-channel-weakmap) | 1.0.2 | сервер | Copyright (c) 2019 Jordan Harband |
| [statuses](https://www.npmjs.com/package/statuses) | 2.0.2 | сервер | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2016 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [stop-iteration-iterator](https://www.npmjs.com/package/stop-iteration-iterator) | 1.1.0 | сервер | Copyright (c) 2023 Jordan Harband |
| [streamsearch](https://www.npmjs.com/package/streamsearch) \* | 1.1.0 | сервер | Copyright Brian White. All rights reserved. |
| [string_decoder](https://www.npmjs.com/package/string_decoder) | 1.1.1 | сервер | Copyright Node.js contributors. All rights reserved.; Copyright Joyent, Inc. and other Node contributors. All rights reserved. |
| [string_decoder](https://www.npmjs.com/package/string_decoder) | 1.3.0 | сервер | Copyright Node.js contributors. All rights reserved.; Copyright Joyent, Inc. and other Node contributors. All rights reserved. |
| [string.prototype.trim](https://www.npmjs.com/package/string.prototype.trim) | 1.2.11 | сервер | Copyright (c) 2015 Jordan Harband |
| [string.prototype.trimend](https://www.npmjs.com/package/string.prototype.trimend) | 1.0.10 | сервер | Copyright (c) 2017 Khaled Al-Ansari |
| [string.prototype.trimstart](https://www.npmjs.com/package/string.prototype.trimstart) | 1.0.8 | сервер | Copyright (c) 2017 Khaled Al-Ansari |
| [strtok3](https://www.npmjs.com/package/strtok3) | 10.6.3 | сервер | Copyright © 2026 Borewit |
| [tar-stream](https://www.npmjs.com/package/tar-stream) | 2.2.0 | сервер | Copyright (c) 2014 Mathias Buus |
| [tinyexec](https://www.npmjs.com/package/tinyexec) | 1.3.1 | сервер | Copyright (c) 2024 Tinylibs |
| [tmp](https://www.npmjs.com/package/tmp) | 0.2.7 | сервер | Copyright (c) 2014 KARASZI István |
| [toidentifier](https://www.npmjs.com/package/toidentifier) | 1.0.1 | сервер | Copyright (c) 2016 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [token-types](https://www.npmjs.com/package/token-types) | 6.1.2 | сервер | Copyright © 2026 Borewit |
| [traverse](https://www.npmjs.com/package/traverse) | 0.3.10 | сервер | Copyright (c) 2010 James Halliday and contributors |
| [type-is](https://www.npmjs.com/package/type-is) | 1.6.18 | сервер | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2014-2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [type-is](https://www.npmjs.com/package/type-is) | 2.1.0 | сервер | Copyright (c) 2014 Jonathan Ong &lt;me@jongleberry.com&gt;; Copyright (c) 2014-2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [typed-array-buffer](https://www.npmjs.com/package/typed-array-buffer) | 1.0.3 | сервер | Copyright (c) 2023 Jordan Harband |
| [typed-array-byte-length](https://www.npmjs.com/package/typed-array-byte-length) | 1.0.3 | сервер | Copyright (c) 2020 Inspect JS |
| [typed-array-byte-offset](https://www.npmjs.com/package/typed-array-byte-offset) | 1.0.5 | сервер | Copyright (c) 2020 Inspect JS |
| [typed-array-length](https://www.npmjs.com/package/typed-array-length) | 1.0.8 | сервер | Copyright (c) 2020 Inspect JS |
| [typedarray.prototype.slice](https://www.npmjs.com/package/typedarray.prototype.slice) | 1.0.6 | сервер | Copyright (c) 2023 ECMAScript Shims |
| [uid](https://www.npmjs.com/package/uid) | 2.0.2 | сервер | Copyright (c) Luke Edwards &lt;luke.edwards05@gmail.com&gt; (lukeed.com) |
| [uint8array-extras](https://www.npmjs.com/package/uint8array-extras) | 1.6.0 | сервер | Copyright (c) Sindre Sorhus &lt;sindresorhus@gmail.com&gt; (https://sindresorhus.com) |
| [unbox-primitive](https://www.npmjs.com/package/unbox-primitive) | 1.1.0 | сервер | Copyright (c) 2019 Jordan Harband |
| [unpipe](https://www.npmjs.com/package/unpipe) | 1.0.0 | сервер | Copyright (c) 2015 Douglas Christopher Wilson &lt;doug@somethingdoug.com&gt; |
| [unzipper](https://www.npmjs.com/package/unzipper) | 0.10.14 | сервер | Copyright (c) 2012 - 2013 Near Infinity Corporation |
| [util-deprecate](https://www.npmjs.com/package/util-deprecate) | 1.0.2 | сервер | Copyright (c) 2014 Nathan Rajlich &lt;nathan@tootallnate.net&gt; |
| [utils-merge](https://www.npmjs.com/package/utils-merge) | 1.0.1 | сервер | Copyright (c) 2013-2017 Jared Hanson |
| [uuid](https://www.npmjs.com/package/uuid) | 8.3.2 | сервер | Copyright (c) 2010-2020 Robert Kieffer and other contributors |
| [validator](https://www.npmjs.com/package/validator) | 13.15.35 | сервер | Copyright (c) 2018 Chris O'Hara &lt;cohara87@gmail.com&gt; |
| [vary](https://www.npmjs.com/package/vary) | 1.1.2 | сервер | Copyright (c) 2014-2017 Douglas Christopher Wilson |
| [vue](https://www.npmjs.com/package/vue) | 3.5.44 | веб-интерфейс | Copyright (c) 2018-present, Yuxi (Evan) You |
| [vue-demi](https://www.npmjs.com/package/vue-demi) | 0.14.10 | веб-интерфейс | Copyright (c) 2020-present, Anthony Fu |
| [vue-router](https://www.npmjs.com/package/vue-router) | 4.6.4 | веб-интерфейс | Copyright (c) 2019-present Eduardo San Martin Morote |
| [which-boxed-primitive](https://www.npmjs.com/package/which-boxed-primitive) | 1.1.1 | сервер | Copyright (c) 2019 Jordan Harband |
| [which-builtin-type](https://www.npmjs.com/package/which-builtin-type) | 1.2.1 | сервер | Copyright (c) 2020 ECMAScript Shims |
| [which-collection](https://www.npmjs.com/package/which-collection) | 1.0.2 | сервер | Copyright (c) 2019 Inspect JS |
| [which-typed-array](https://www.npmjs.com/package/which-typed-array) | 1.1.24 | сервер | Copyright (c) 2015 Jordan Harband |
| [xmlchars](https://www.npmjs.com/package/xmlchars) | 2.2.0 | сервер | Copyright Louis-Dominique Dubeau and contributors to xmlchars |
| [zip-stream](https://www.npmjs.com/package/zip-stream) | 4.1.1 | сервер | Copyright (c) 2014 Chris Talkington, contributors. |

\* Поле `license` в манифесте пакета не заполнено; лицензия установлена по тексту файла LICENSE (как в отчёте «SBOM и анализ лицензий»). При обновлении версии проверяется вручную.

## ISC — ISC License

Разрешительная. Сохранять уведомление об авторском праве и текст разрешения во всех копиях и существенных частях. Текст лицензии: <https://spdx.org/licenses/ISC.html>.

| Компонент | Версия | Часть | Уведомление об авторском праве |
| --- | --- | --- | --- |
| [fs.realpath](https://www.npmjs.com/package/fs.realpath) | 1.0.0 | сервер | Copyright (c) Isaac Z. Schlueter and Contributors; Copyright Joyent, Inc. and other Node contributors. |
| [fstream](https://www.npmjs.com/package/fstream) | 1.0.12 | сервер | Copyright (c) Isaac Z. Schlueter and Contributors |
| [glob](https://www.npmjs.com/package/glob) | 7.2.3 | сервер | Copyright (c) Isaac Z. Schlueter and Contributors |
| [graceful-fs](https://www.npmjs.com/package/graceful-fs) | 4.2.11 | сервер | Copyright (c) 2011-2022 Isaac Z. Schlueter, Ben Noordhuis, and Contributors |
| [inflight](https://www.npmjs.com/package/inflight) | 1.0.6 | сервер | Copyright (c) Isaac Z. Schlueter |
| [inherits](https://www.npmjs.com/package/inherits) | 2.0.4 | сервер | Copyright (c) Isaac Z. Schlueter |
| [iterare](https://www.npmjs.com/package/iterare) | 1.2.1 | сервер | Copyright (c) 2016, Felix Frederick Becker |
| [listenercount](https://www.npmjs.com/package/listenercount) | 1.0.1 | сервер | Copyright (c) MMXV jden &lt;jason@denizac.org&gt; |
| [minimatch](https://www.npmjs.com/package/minimatch) | 3.1.5 | сервер | Copyright (c) Isaac Z. Schlueter and Contributors |
| [minimatch](https://www.npmjs.com/package/minimatch) | 5.1.9 | сервер | Copyright (c) 2011-2023 Isaac Z. Schlueter and Contributors |
| [once](https://www.npmjs.com/package/once) | 1.4.0 | сервер | Copyright (c) Isaac Z. Schlueter and Contributors |
| [rimraf](https://www.npmjs.com/package/rimraf) | 2.7.1 | сервер | Copyright (c) Isaac Z. Schlueter and Contributors |
| [saxes](https://www.npmjs.com/package/saxes) | 5.0.1 | сервер | Автор: Louis-Dominique Dubeau &lt;ldd@lddubeau.com&gt; |
| [semver](https://www.npmjs.com/package/semver) | 7.8.5 | сервер | Copyright (c) Isaac Z. Schlueter and Contributors |
| [setprototypeof](https://www.npmjs.com/package/setprototypeof) | 1.2.0 | сервер | Copyright (c) 2015, Wes Todd |
| [wrappy](https://www.npmjs.com/package/wrappy) | 1.0.2 | сервер | Copyright (c) Isaac Z. Schlueter and Contributors |

## Apache-2.0 — Apache License 2.0

Разрешительная. Передавать копию лицензии; сохранять уведомления об авторском праве, патентах и товарных знаках и файл NOTICE (если есть); помечать изменённые файлы. Текст лицензии: <https://spdx.org/licenses/Apache-2.0.html>.

| Компонент | Версия | Часть | Уведомление об авторском праве |
| --- | --- | --- | --- |
| [@prisma/client](https://www.npmjs.com/package/@prisma/client) | 6.19.3 | сервер | Автор: Tim Suchanek &lt;suchanek@prisma.io&gt; |
| [@prisma/config](https://www.npmjs.com/package/@prisma/config) | 6.19.3 | сервер | Автор: Alberto Schiabel &lt;schiabel@prisma.io&gt; |
| [@prisma/debug](https://www.npmjs.com/package/@prisma/debug) | 6.19.3 | сервер | Автор: Tim Suchanek &lt;suchanek@prisma.io&gt; |
| [@prisma/engines](https://www.npmjs.com/package/@prisma/engines) | 6.19.3 | сервер | Автор: Tim Suchanek &lt;suchanek@prisma.io&gt; |
| [@prisma/engines-version](https://www.npmjs.com/package/@prisma/engines-version) | 7.1.1-3.c2990dca591cba766e3b7ef5d9e8a84796e47ab7 | сервер | Автор: Tim Suchanek &lt;suchanek@prisma.io&gt; |
| [@prisma/fetch-engine](https://www.npmjs.com/package/@prisma/fetch-engine) | 6.19.3 | сервер | Автор: Tim Suchanek &lt;suchanek@prisma.io&gt; |
| [@prisma/get-platform](https://www.npmjs.com/package/@prisma/get-platform) | 6.19.3 | сервер | Автор: Tim Suchanek &lt;suchanek@prisma.io&gt; |
| [@scarf/scarf](https://www.npmjs.com/package/@scarf/scarf) | 1.4.0 | сервер | Copyright 2020 Scarf Systems, Inc. |
| [crc-32](https://www.npmjs.com/package/crc-32) | 1.2.2 | сервер | Copyright (C) 2014-present SheetJS LLC |
| [ecdsa-sig-formatter](https://www.npmjs.com/package/ecdsa-sig-formatter) | 1.0.11 | сервер | Copyright 2015 D2L Corporation |
| [prisma](https://www.npmjs.com/package/prisma) | 6.19.3 | сервер | Автор: Tim Suchanek &lt;suchanek@prisma.io&gt; |
| [readdir-glob](https://www.npmjs.com/package/readdir-glob) | 1.1.3 | сервер | Copyright 2020 Yann Armelin |
| [reflect-metadata](https://www.npmjs.com/package/reflect-metadata) | 0.2.2 | сервер | Copyright (c) Microsoft Corporation. All rights reserved. |
| [rxjs](https://www.npmjs.com/package/rxjs) | 7.8.2 | сервер | Copyright (c) 2015-2018 Google, Inc., Netflix, Inc., Microsoft Corp. and contributors |
| [swagger-ui-dist](https://www.npmjs.com/package/swagger-ui-dist) | 5.32.13 | сервер | Copyright 2020-2021 SmartBear Software Inc. |

Файлы NOTICE есть у пакетов: `swagger-ui-dist`; они остаются в образе `server` в каталогах пакетов.

## BSD-3-Clause — BSD 3-Clause License

Разрешительная. Сохранять уведомление об авторском праве, перечень условий и отказ от гарантий; при распространении в двоичном виде — воспроизводить их в документации; не использовать имена авторов для продвижения без их разрешения. Текст лицензии: <https://spdx.org/licenses/BSD-3-Clause.html>.

| Компонент | Версия | Часть | Уведомление об авторском праве |
| --- | --- | --- | --- |
| [buffer-equal-constant-time](https://www.npmjs.com/package/buffer-equal-constant-time) | 1.0.1 | сервер | Copyright (c) 2013, GoInstant Inc., a salesforce.com company |
| [deepmerge-ts](https://www.npmjs.com/package/deepmerge-ts) | 7.1.5 | сервер | Copyright (c) 2021, Rebecca Stevens |
| [duplexer2](https://www.npmjs.com/package/duplexer2) | 0.1.4 | сервер | Copyright (c) 2013, Deoxxa Development |
| [ieee754](https://www.npmjs.com/package/ieee754) | 1.2.1 | сервер | Copyright 2008 Fair Oaks Labs, Inc. |
| [qs](https://www.npmjs.com/package/qs) | 6.16.1 | сервер | Copyright (c) 2014, Nathan LaFreniere and other \[contributors\](https://github.com/ljharb/qs/graphs/contributors) |

## BSD-2-Clause — BSD 2-Clause License

Разрешительная. Сохранять уведомление об авторском праве, перечень условий и отказ от гарантий; при распространении в двоичном виде — воспроизводить их в документации. Текст лицензии: <https://spdx.org/licenses/BSD-2-Clause.html>.

| Компонент | Версия | Часть | Уведомление об авторском праве |
| --- | --- | --- | --- |
| [dotenv](https://www.npmjs.com/package/dotenv) | 16.6.1 | сервер | Copyright (c) 2015, Scott Motte |
| [dotenv](https://www.npmjs.com/package/dotenv) | 17.4.1 | сервер | Copyright (c) 2015, Scott Motte |
| [dotenv-expand](https://www.npmjs.com/package/dotenv-expand) | 12.0.3 | сервер | Copyright (c) 2016, Scott Motte |

## (MIT AND Zlib) — MIT License и zlib License одновременно

Разрешительная. Выполнять условия обеих лицензий: сохранять уведомления, не искажать происхождение, помечать изменённые версии. Текст лицензии: <https://spdx.org/licenses/MIT.html>, <https://spdx.org/licenses/Zlib.html>.

| Компонент | Версия | Часть | Уведомление об авторском праве |
| --- | --- | --- | --- |
| [pako](https://www.npmjs.com/package/pako) | 1.0.11 | сервер | Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn |

## (MIT OR GPL-3.0-or-later) — MIT License или GNU GPL 3.0 и выше — по выбору

Двойная: применяется MIT. Используется на условиях MIT: сохранять уведомление об авторском праве и текст разрешения во всех копиях и существенных частях. Текст лицензии: <https://spdx.org/licenses/MIT.html>.

| Компонент | Версия | Часть | Уведомление об авторском праве |
| --- | --- | --- | --- |
| [jszip](https://www.npmjs.com/package/jszip) | 3.10.2 | сервер | Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso |

## 0BSD — BSD Zero Clause License

Разрешительная без условий. Условий нет; сведения приводятся для полноты. Текст лицензии: <https://spdx.org/licenses/0BSD.html>.

| Компонент | Версия | Часть | Уведомление об авторском праве |
| --- | --- | --- | --- |
| [tslib](https://www.npmjs.com/package/tslib) | 2.8.1 | сервер | Copyright (c) Microsoft Corporation. |

## MIT-0 — MIT No Attribution

Разрешительная без условий. Условий нет; сведения приводятся для полноты. Текст лицензии: <https://spdx.org/licenses/MIT-0.html>.

| Компонент | Версия | Часть | Уведомление об авторском праве |
| --- | --- | --- | --- |
| [nodemailer](https://www.npmjs.com/package/nodemailer) | 10.2.1 | сервер | Copyright (c) 2011-2023 Andris Reinman |

## MIT/X11 — MIT/X11 (ранняя редакция MIT License)

Разрешительная. Сохранять уведомление об авторском праве и текст разрешения во всех копиях и существенных частях. Текст лицензии: <https://spdx.org/licenses/MIT.html>.

| Компонент | Версия | Часть | Уведомление об авторском праве |
| --- | --- | --- | --- |
| [chainsaw](https://www.npmjs.com/package/chainsaw) | 0.1.0 | сервер | Автор: James Halliday &lt;mail@substack.net&gt; (http://substack.net) |

## PSF-2.0 — Python Software Foundation License 2.0

Разрешительная. Сохранять уведомление об авторском праве PSF и текст лицензии. Текст лицензии: <https://spdx.org/licenses/PSF-2.0.html>.

| Компонент | Версия | Часть | Уведомление об авторском праве |
| --- | --- | --- | --- |
| [argparse](https://www.npmjs.com/package/argparse) | 3.0.4 | сервер | Copyright (c) 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019 Python Software Foundation; All Rights Reserved |

## Unlicense — The Unlicense

Общественное достояние. Условий нет; сведения приводятся для полноты. Текст лицензии: <https://spdx.org/licenses/Unlicense.html>.

| Компонент | Версия | Часть | Уведомление об авторском праве |
| --- | --- | --- | --- |
| [big-integer](https://www.npmjs.com/package/big-integer) | 1.6.52 | сервер | Автор: Peter Olson &lt;peter.e.c.olson+npm@gmail.com&gt; |

## Примечания к отдельным компонентам

| Компонент | Примечание |
| --- | --- |
| @prisma/engines | При сборке образа загружает исполняемые движки Prisma (query engine, schema engine; Apache-2.0) под платформу образа; они остаются в `node_modules`. |
| @scarf/scarf | Зависимость swagger-ui-dist для статистики установок: сценарий `postinstall` при `npm ci` отправляет событие на scarf.sh, если сбор не отключён (`SCARF_ANALYTICS=false` или `scarfSettings.enabled: false`). Во время работы программы не используется. |
| jszip | Двойная лицензия `MIT OR GPL-3.0-or-later`: программа использует компонент на условиях MIT; GPL не применяется. |
| nodemailer | Отправка писем через почтовый релей организации (`SMTP_HOST`); без настройки почты не используется. |
| prisma | Командная строка Prisma: применяет миграции при старте контейнера `server` (`prisma migrate deploy`). Пакет поставляется собранным и включает код сторонних библиотек. |
| swagger-ui-dist | Собранный пакет интерфейса документации API (`/api/docs`): включает React (MIT), DOMPurify (`MPL-2.0 OR Apache-2.0`, применяется Apache-2.0) и другие библиотеки; их уведомления — в файлах `swagger-ui-*.js.LICENSE.txt` и `NOTICE` пакета, которые остаются в образе. |

# Веб-интерфейс: состав сборки

Веб-интерфейс поставляется как статическая сборка Vite в образе `web` (nginx). В браузер уходит только импортируемый код библиотек; прямые зависимости — `pinia`, `vue`, `vue-router`. Шрифты, иконки и стили собственные или системные; внешних CDN и шрифтовых сервисов нет. Пакеты, которые npm считает рабочими зависимостями, но которые в сборку не попадают:

| Пакет | Версия | Почему не входит в сборку |
| --- | --- | --- |
| @vue/compiler-dom | 3.5.44 | компилятор шаблонов — работает только при сборке |
| @vue/compiler-sfc | 3.5.44 | компилятор однофайловых компонентов: шаблоны компилируются при сборке (@vitejs/plugin-vue), в браузер уходит runtime-сборка Vue |
| @vue/devtools-api | 6.6.4 | интеграция с Vue Devtools: код исключается из production-сборки |
| @vue/server-renderer | 3.5.44 | серверный рендеринг не используется |
| csstype | 3.2.3 | только объявления типов TypeScript, исполняемого кода нет |

Их собственные зависимости в сборку тоже не входят: `@babel/helper-string-parser@7.29.11`, `@babel/helper-validator-identifier@7.29.7`, `@babel/parser@7.29.11`, `@babel/types@7.29.11`, `@jridgewell/sourcemap-codec@1.6.0`, `@vue/compiler-core@3.5.44`, `@vue/compiler-ssr@3.5.44`, `entities@7.0.1`, `estree-walker@2.0.2`, `magic-string@0.30.21`, `nanoid@3.3.20`, `picocolors@1.1.1`, `postcss@8.5.32`, `source-map-js@1.2.2`.

# Среда выполнения: образы контейнеров

Программа поставляется в контейнерах Docker. Образы строятся на официальных образах Docker Hub, которые содержат отдельные программы — среду Node.js, веб-сервер nginx, СУБД PostgreSQL, систему мониторинга Prometheus — и пакеты базового дистрибутива Linux. Эти программы распространяются вместе с программой «Планировщик отпусков», но не связываются с её кодом: они работают как самостоятельные процессы и взаимодействуют с программой через сеть, файлы и командную строку.

| Образ | Где используется | Основное ПО и лицензия | Базовая ОС и пакеты | В поставке |
| --- | --- | --- | --- | --- |
| `node:20-alpine` | server/Dockerfile: стадия сборки «build»; server/Dockerfile: рабочий образ `server`; web/Dockerfile: стадия сборки «build» | Node.js — MIT (в составе — V8, libuv, OpenSSL, ICU и др. на условиях их лицензий); npm — Artistic-2.0 (`npx` применяет миграции при старте) | Alpine Linux: musl (MIT), BusyBox (GPL-2.0-only), apk-tools (GPL-2.0-only), OpenSSL (Apache-2.0), zlib (Zlib), ca-certificates (MPL-2.0 AND MIT) | Да |
| `nginx:1.27-alpine` | web/Dockerfile: рабочий образ `web` | nginx — BSD-2-Clause; envsubst из GNU gettext (GPL-3.0-or-later) подставляет переменные в шаблон конфигурации при старте как отдельная программа | Alpine Linux: musl (MIT), BusyBox (GPL-2.0-only), apk-tools (GPL-2.0-only), OpenSSL (Apache-2.0), zlib (Zlib), ca-certificates (MPL-2.0 AND MIT) | Да |
| `postgres:17-alpine` | docker-compose.yml: сервис `postgres`; docker-compose.yml: сервис `backup` (профиль `full`); docker-compose.replica.yml: сервис `postgres-replica`; docker-compose.replica.yml: сервис `basebackup` | PostgreSQL — PostgreSQL License; расширение pg_stat_statements (PostgreSQL License); сценарий входа образа — bash (GPL-3.0-or-later) | Alpine Linux: musl (MIT), BusyBox (GPL-2.0-only), apk-tools (GPL-2.0-only), OpenSSL (Apache-2.0), zlib (Zlib), ca-certificates (MPL-2.0 AND MIT) | Да |
| `prom/prometheus:v3.5.0` | docker-compose.yml: сервис `prometheus` (профиль `monitoring`) | Prometheus — Apache-2.0 | BusyBox (GPL-2.0-only) | Необязательный (профиль мониторинга) |

В рабочий образ `server` дополнительно устанавливаются пакеты Alpine: `openssl` (OpenSSL — Apache-2.0; нужен движку Prisma).

Конфигурация nginx программы не загружает динамические модули (нет директив `load_module` в `web/nginx-main.conf`): дополнительные модули официального образа не используются.

## Агрегирование и исходные тексты

Лицензии GPL встречаются только у программ базовых образов (BusyBox, apk-tools, bash, envsubst). Они поставляются рядом с программой как отдельные программы — это агрегирование, а не связывание: код программы «Планировщик отпусков» не компонуется с ними и не является их производным произведением, поэтому условия GPL на программу не распространяются. Обязанности по этим лицензиям — сохранить их тексты (они есть в образах) и обеспечить доступ к исходным текстам: исходные тексты пакетов Alpine Linux опубликованы в репозитории aports (<https://gitlab.alpinelinux.org/alpine/aports>), сценарии сборки официальных образов — в репозиториях `docker-library` (<https://github.com/docker-library>) и `nginx/docker-nginx` (<https://github.com/nginx/docker-nginx>); правообладатель предоставляет копию по запросу.

Образы указаны по тегам без фиксированного дайджеста, поэтому точный перечень пакетов базовой ОС определяется на дату сборки. Для поставки фиксируйте дайджесты образов и формируйте их SBOM средствами сканирования образов (например, `syft <образ> -o cyclonedx-json`).

# Уведомление

Права на перечисленные компоненты принадлежат их авторам. Компоненты распространяются на условиях их лицензий; лицензионный договор на программу «Планировщик отпусков» не ограничивает прав, предоставленных этими лицензиями. Тексты лицензий передаются в составе поставки; исходные тексты компонентов доступны по ссылкам в таблицах, а правообладатель предоставляет их копию по запросу.

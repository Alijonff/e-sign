# Очередь задач Codex

Каждая карточка — полная спецификация. Codex выполняет **только** её, по правилам из `AGENTS.md`, и в конце пишет `docs/progress/tasks/<ID>.status.json`. Если в карточке чего-то не хватает для однозначного решения — `state: "question"`, не угадывать.

Формат строки под заголовком: `D <зависимости или —> · ⏱ <минуты> · M <модель>/<усилие>`. Зависимости должны быть приняты (`done`).

## Общее для всех карточек

- Стек: Node.js 22, TypeScript 5 (strict), npm workspaces (`shared`, `server`, `web`). Версии пакетов — актуальные стабильные, фиксируются в `package-lock.json`.
- Контракт API и интерфейс `PadDriver` — `shared/src/index.ts` (читать внимательно, **не менять**). Ядро вставки подписи — `server/src/core/` (готово, **не менять**; использовать `readPageInfos`, `stampSignature`, `normalizeSignaturePng`, `CoreError`). Тестовые PDF — `samples/` (вымышленные), генератор `tools/samples/` (не менять).
- Тексты интерфейса и сообщения об ошибках для пользователя — по-русски, коротко. Имена в коде — по-английски.
- Корневые проверки (должны проходить после каждой задачи): `npm run typecheck && npm run lint && npm test && npm run build`.
- Не добавлять пакеты сверх перечисленных в карточке без необходимости; если добавил — записать в `decisions_made` зачем.
- Секретов и реальных документов нет; пароль и ключи — только из переменных окружения.

---

### T-001 · Каркас сервера и веб-приложения
D — · ⏱ 60 · M sol/high
Контекст: в репозитории уже есть `shared/` (контракт), `server/src/core/` (ядро PDF) и тесты ядра. Нужен каркас, на который остальные задачи добавляют функции параллельно, не конфликтуя по файлам.

**Сервер (`server/`):**
- Добавить зависимости: `fastify`, `@fastify/cookie`, `@fastify/multipart`, `@fastify/static`, `@fastify/rate-limit`; dev: `tsx`, `esbuild`.
- Файлы: `src/config.ts` (чтение env: `PORT`=3000, `HOST`=0.0.0.0, `APP_PASSWORD`, `SESSION_SECRET`, `DATA_DIR`=`./data`, `MAX_UPLOAD_MB`=25, `RETENTION_DAYS`=7, `NODE_ENV`; в production без `APP_PASSWORD` — ошибка запуска; вне production пароль по умолчанию `dev` с предупреждением в лог; без `SESSION_SECRET` генерируется случайный на процесс), `src/app.ts` (`buildApp(config)` → Fastify-инстанс; `GET /health` → `{"ok":true}`; регистрация маршрутов через `registerRoutes(app, config)` из `src/routes/index.ts`, пока пустая функция; раздача `web/dist` через `@fastify/static` с запасным `index.html` для путей вне `/api`, если каталог `web/dist` существует), `src/index.ts` (запуск, корректное завершение по SIGTERM).
- Скрипты `server/package.json`: `dev` (`tsx watch src/index.ts`), `build` (esbuild собирает `src/index.ts` в один файл `dist/index.js` для Node 22, пакет `@e-sign/shared` вшивается в сборку, остальные зависимости внешние), `start` (`node dist/index.js`), `typecheck`, `lint`, `test`.
- После `npm run build` из корня команда `node server/dist/index.js` должна запускаться и отвечать на `/health`.
- Тест `test/app.test.ts`: `/health` через `app.inject`.

**Веб (`web/`):** Vite + React 19 + TypeScript, `react-router` 7, `pdfjs-dist` (нужен T-003; здесь только установить), `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`.
- `vite.config.ts`: порт 5173, прокси `/api` и `/health` на `http://localhost:3000`, алиас на `@e-sign/shared` не нужен (workspace).
- Маршруты (`BrowserRouter`): `/login` → `LoginPage`, `/` → `UploadPage`, `/doc/:id` → `DocumentPage`. Любой маршрут, кроме `/login`, проверяет `GET /api/session`: если `authenticated: false` — переход на `/login`.
- Файлы-заглушки с готовыми сигнатурами (последующие задачи заменят содержимое, не сигнатуры):
  - `src/pages/LoginPage.tsx`, `src/pages/UploadPage.tsx` — заглушка с заголовком.
  - `src/pages/DocumentPage.tsx` — грузит `GET /api/documents/:id`, хранит состояние `blocks: SignatureBlock[]` и шаг `'mark' | 'sign' | 'result'`, показывает нужный шаг.
  - `src/steps/MarkStep.tsx` — `props: { document: DocumentInfo; blocks: SignatureBlock[]; onBlocksChange(blocks: SignatureBlock[]): void; onNext(): void }`, заглушка.
  - `src/steps/SignStep.tsx` — `props: { document: DocumentInfo; blocks: SignatureBlock[]; onBack(): void; onSigned(result: SignResponse): void }`, заглушка.
  - `src/steps/ResultStep.tsx` — `props: { document: DocumentInfo; onAnother(): void }`, заглушка.
  - `src/pad/index.ts` — `createPadDriver(kind: PadKind): PadDriver` и `defaultPadKind(): PadKind` (читает параметр адреса `?pad=mock|signotec`, затем `import.meta.env.VITE_PAD_DRIVER`, по умолчанию `mock`); `src/pad/mock.ts` и `src/pad/signotec.ts` — классы-заглушки `MockPadDriver` и `SignotecPadDriver`, реализующие `PadDriver`, все методы бросают `PadError('unknown', 'Не реализовано')`.
  - `src/api.ts` — типизированный клиент по контракту `shared`: `getSession`, `login`, `logout`, `uploadDocument(file)`, `getDocument(id)`, `signDocument(id, request)`, плюс функции-ссылки `documentFileUrl(id)`, `signedFileUrl(id)`. Ошибки — класс `ApiClientError` с полями `status` и `code` из `ApiError`. Все запросы с `credentials: 'same-origin'`.
- Минимальные стили: один `src/styles.css`, чистый современный вид, светлая тема, работает на ширине от 360 px.
- Скрипты `web/package.json`: `dev`, `build` (`tsc -b && vite build`), `typecheck`, `lint`, `test`.
- Тесты: `api.test.ts` (клиент разбирает `ApiError`), `pad/index.test.ts` (выбор драйвера по параметру и по env), рендер `App` с моком `fetch` (неавторизованный → `/login`).

**Корень:** добавить `web` в `workspaces`; `eslint.config.js` (ESLint 9, плоский конфиг, `typescript-eslint`, `eslint-plugin-react-hooks` для `web`), скрипты `lint` в `shared`, `server`, `web` (`eslint .`); `.nvmrc` со значением `22`; в корневой `package.json` поле `engines.node` `>=22`.

- Файлы, которые можно менять: `package.json`, `package-lock.json`, `eslint.config.js`, `.nvmrc`, `server/package.json`, `server/tsconfig.json`, `server/src/{config,app,index}.ts`, `server/src/routes/index.ts`, `server/test/app.test.ts`, `shared/package.json` (только `scripts`), всё в `web/`.
- Не менять: `shared/src/**`, `server/src/core/**`, `server/test/{placement,pdf}.test.ts`, `server/test/helpers.ts`, `samples/**`, `tools/**`, `docs/**` (кроме файла статуса).
- Готово: корневые проверки зелёные; `npm run dev -w server` и `npm run dev -w web` стартуют; `node server/dist/index.js` отвечает на `/health`.
- Не делать: вход по паролю, загрузку документов, разметку, планшет (это T-002…T-005).

### T-002 · Сервер: вход, документы, подпись
D T-001 · ⏱ 75 · M sol/high
Контекст: контракт — `shared/src/index.ts` (раздел «API»), ядро — `server/src/core/`. Нужно реализовать все эндпоинты и хранение.
- Файлы: `server/src/routes/{auth,documents}.ts`, `server/src/{storage,session,cleanup}.ts`, тесты `server/test/{auth,documents,cleanup}.test.ts`, подключение в `server/src/routes/index.ts`. Новых пакетов не нужно.
- **Вход.** `POST /api/login` с `{password}`: сравнение через `crypto.timingSafeEqual` (по хэшам SHA-256 обеих строк); успех → 204 и cookie `sid` (HttpOnly, SameSite=Lax, Secure в production, срок 12 часов): значение — `<expiresAtMs>.<hmacSha256(expiresAtMs, SESSION_SECRET)>`. Неверный пароль → 401 `unauthorized`. Ограничение `@fastify/rate-limit` на `/api/login`: 10 запросов в минуту с одного адреса (429). `POST /api/logout` → 204, cookie сбрасывается. `GET /api/session` → `{authenticated}` (доступен без входа). Все остальные `/api/*` без валидной cookie → 401 `unauthorized`; `/health` открыт.
- **Хранение (`storage.ts`).** Каталог `DATA_DIR/<uuid v4>/`: `original.pdf`, `meta.json` (`id`, `name`, `sizeBytes`, `pageCount`, `pages`, `createdAt`, `signedAt?`), `signed.pdf`, `signature.png`, `signdata.b64` (если пришла). Идентификатор из URL проверять регулярным выражением UUID v4 до обращения к диску (защита от `../`). Запись `meta.json` атомарная (временный файл + rename).
- **`POST /api/documents`** (multipart, поле `file`, лимит `MAX_UPLOAD_MB`, превышение → 413 `file_too_large`): прочитать в память, проверить через `readPageInfos` (ошибки `CoreError` → HTTP 400/422 с тем же `code`: `pdf_invalid` и `pdf_encrypted` → 422), имя файла очистить от путей и управляющих символов (в `meta.json` только для показа), сохранить, вернуть 201 `DocumentInfo` (`signed: false`). Не PDF → 422 `not_pdf`.
- **`GET /api/documents/:id`** → `DocumentInfo`; нет документа → 404 `document_not_found`. **`GET /api/documents/:id/file`** и **`/signed`** → `application/pdf`, `Content-Disposition: inline; filename*=UTF-8''<имя>` (для signed — к имени добавляется суффикс `-подписано`), `Cache-Control: no-store`; `/signed` без подписанной версии → 404.
- **`POST /api/documents/:id/sign`** (`SignRequest`): тело ≤ 5 МБ; `normalizeSignaturePng(Buffer.from(base64))`, затем `stampSignature(original, blocks, png)` из ядра; сохранить `signed.pdf`, `signature.png` (нормализованный), `signdata.b64`; обновить `meta.json`; ответ `SignResponse` (`stampedBlocks = blocks.length`). Повторная подпись разрешена: каждый раз берётся оригинал, `signed.pdf` перезаписывается. `CoreError` → 400 с тем же `code` (`invalid_blocks`, `invalid_signature`). `padKind` проверять по списку `mock|signotec`, иначе 400 `bad_request`.
- **Очистка (`cleanup.ts`).** Функция `cleanupExpired(dataDir, retentionDays, now)` удаляет каталоги документов старше `RETENTION_DAYS` (по `createdAt` из `meta.json`; каталог без читаемого `meta.json` старше срока по времени изменения тоже удаляется); запуск при старте сервера и раз в час (`setInterval` с `unref`, остановка при закрытии приложения).
- **Единый формат ошибок:** `{"error":{"code","message"}}`, сообщения для пользователя по-русски. Необработанная ошибка → 500 `internal` без стека в ответе и с записью в лог.
- Тесты (через `app.inject`, временный `DATA_DIR`, образцы из `samples/`): вход верный/неверный/лимит; доступ без cookie → 401; загрузка каждого образца; не PDF; слишком большой файл; зашифрованный PDF (собрать в тесте через `pdf-lib` невозможно — пропусти этот случай, покрыт в ядре); подпись образцов `01` и `05` с блоками на повёрнутой странице; повторная подпись; подпись с блоком вне документа → 400; `../` в id → 404; очистка по сроку.
- Не менять: `shared/src/**`, `server/src/core/**`, `web/**`, `samples/**`.
- Готово: корневые проверки зелёные.
- Не делать: интерфейс, планшет, Docker.

### T-003 · Веб: вход, загрузка и разметка блоков
D T-001 · ⏱ 90 · M sol/high
Контекст: заглушки и сигнатуры созданы в T-001 (`web/src/pages/*`, `web/src/steps/MarkStep.tsx`, `web/src/api.ts`). Сервер делает T-002 параллельно; тестировать с мокнутым `fetch`.
- Файлы: `web/src/pages/{LoginPage,UploadPage}.tsx`, `web/src/steps/MarkStep.tsx`, новые файлы в `web/src/mark/` (компоненты и логика), `web/src/styles.css` (только добавлять), тесты рядом. Пакеты: `pdfjs-dist` (уже стоит).
- **LoginPage:** поле пароля, кнопка «Войти», ошибка «Неверный пароль» при 401 и «Слишком много попыток, подождите минуту» при 429; после входа — на `/`.
- **UploadPage:** зона «Перетащите PDF или нажмите, чтобы выбрать», `accept="application/pdf"`, индикатор загрузки, понятные ошибки по `code` (`not_pdf` «Это не PDF», `pdf_encrypted` «PDF защищён паролем», `file_too_large` «Файл больше N МБ», остальные — текст из ответа), после успеха — переход на `/doc/:id`. Кнопка «Выйти» в шапке.
- **MarkStep:**
  - Страницы документа показываются **подряд вертикальной лентой**. Отрисовка через `pdfjs-dist` (`getDocument({url: documentFileUrl(id)})`, воркер подключить способом Vite `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`), ширина страницы — `min(доступная ширина, 900 px)`, чёткость учитывает `devicePixelRatio`. Страницы рисуются лениво (`IntersectionObserver`), пока страница не отрисована — рамка нужного размера.
  - Поворот страницы учитывается самим pdf.js; размеры берутся из `document.pages[i]` (видимые). **Блоки хранятся в долях видимой страницы (0..1, начало слева сверху)** — ровно как в `SignatureBlock`.
  - Рисование блока: зажать указатель на пустом месте страницы и протянуть (Pointer Events, работает мышью и пальцем). Меньше `MIN_BLOCK_FRACTION` по любой стороне — блок не создаётся. Блок не выходит за границы страницы.
  - Выбранный блок: перемещение за тело, изменение размера за 4 угловых маркера (минимум `MIN_BLOCK_FRACTION`), удаление кнопкой на блоке и клавишей Delete/Backspace. Не больше `MAX_BLOCKS` блоков.
  - Блок подписан номером «1», «2»… в порядке страниц сверху вниз; стиль: рамка и полупрозрачная заливка, подпись «Подпись».
  - Правая панель (на узком экране — под лентой): список блоков («Стр. 2 · блок 3»), клик прокручивает к блоку, кнопка удаления; счётчик «Блоков: N». Кнопка «Далее: подпись» неактивна без блоков и вызывает `onNext`. Подсказка над лентой: «Отметьте места, куда поставить подпись: проведите мышью по странице».
  - Состояние блоков принадлежит `DocumentPage` (через `blocks` и `onBlocksChange`), MarkStep сам блоки не хранит.
  - Идентификаторы блоков — `crypto.randomUUID()`.
- **Чистая логика в `web/src/mark/blocks.ts`** (без React, с юнит-тестами): `createBlockFromDrag(start, end, pageSize)`, `moveBlock(block, dx, dy)`, `resizeBlock(block, handle, dx, dy)`, `clampBlock(block)`, `sortBlocks(blocks)`. Доли в долях страницы, а не в пикселях. Тесты: границы, минимальный размер, обратное направление протягивания, перемещение у края, изменение размера за каждый угол.
- Тесты компонентов (jsdom, `pdfjs-dist` замокать): LoginPage (успех, 401, 429), UploadPage (ошибки по коду), MarkStep (кнопка «Далее» неактивна без блоков, активна с блоками; удаление блока из списка).
- Не менять: `shared/src/**`, `server/**`, `web/src/{api.ts,pad/**}`, `web/src/steps/{SignStep,ResultStep}.tsx`, `web/src/pages/DocumentPage.tsx` (если не хватает поля в сигнатуре — `state: "question"`).
- Готово: корневые проверки зелёные; ручной сценарий описан в `decisions_made` (что проверялось и как).
- Не делать: планшет, отправку подписи, предпросмотр результата.

### T-004 · Веб: шаг подписи с mock-планшетом и результат
D T-001 · ⏱ 75 · M sol/high
Контекст: интерфейс планшета — `PadDriver`, `PadError`, `CaptureOptions`, `SignatureCapture` в `shared/src/index.ts`. Реальный драйвер делает T-005, здесь нужен `mock` для разработки на Mac и экран подписи. Сервер делает T-002 параллельно; тестировать с мокнутым `fetch`.
- Файлы: `web/src/pad/mock.ts` (+ `mock-canvas` компонент рядом), `web/src/steps/{SignStep,ResultStep}.tsx`, новые файлы в `web/src/sign/`, `web/src/styles.css` (только добавлять), тесты рядом. Новых пакетов не нужно.
- **MockPadDriver** (`kind: 'mock'`): `connect()` готов сразу; `capture({prompt, signal})` открывает модальное окно с холстом 640×320 (пропорция 2:1, как экран планшета 320×160) и текстом `prompt` сверху, рисование мышью и пальцем (Pointer Events, плавная линия, толщина 3 px), кнопки «Подтвердить» (неактивна, пока нет штрихов), «Очистить», «Отмена». Подтверждение → `SignatureCapture`: PNG с **белым непрозрачным фоном** (как с реального планшета), `imageWidth/imageHeight`, `signDataBase64` — Base64 от JSON с точками штрихов `{x,y,t}`. «Отмена» и `signal.abort()` → `PadError('cancelled', …)`. Окно открывается через React-портал, управляется императивно из драйвера (например, через небольшой `MockPadHost`, смонтированный в `App`; сам хост положи в `web/src/pad/MockPadHost.tsx`, а в `App.tsx` его подключение — единственная правка вне карточки, запиши в `changed_files` с «Вне карточки»). `cancel()` закрывает окно без ошибки.
- **SignStep** (`props` из T-001): показывает «Блоков для подписи: N на M страницах», кнопки «Назад» (→ `onBack`) и «Подписать на планшете». По нажатию: состояния `подключение` → `ждём подпись клиента` (с кнопкой «Отменить») → `отправка` → `готово` (вызов `onSigned`). Драйвер берётся из `createPadDriver(defaultPadKind())` один раз на экран; `connect()` при первом нажатии, `disconnect()` при размонтировании. Текст для планшета: `buildPadPrompt(document)` в `web/src/sign/prompt.ts` — «Подписываю документ: <имя без .pdf>», обрезка до 60 символов с «…» (юнит-тест). После получения подписи — `signDocument(document.id, {blocks, signature: {imagePngBase64, signDataBase64, padKind}})` из `api.ts`.
- **Ошибки** показываются по-русски с кнопкой «Повторить»: `PadError` по `code` — `service_unavailable` «Служба планшета не отвечает. Проверьте, что signoPAD-API/Web запущена на этом компьютере», `pad_not_found` «Планшет не найден. Проверьте подключение по USB», `cancelled` — без красной ошибки, просто возврат к кнопке «Подписать на планшете», `timeout` «Подпись не получена вовремя», прочие — «Ошибка планшета: …»; `ApiClientError` по `code` из контракта (`invalid_blocks` «Блоки подписи не подходят к документу, вернитесь и проверьте разметку», `invalid_signature` «Подпись не распознана, попросите клиента подписать ещё раз», `unauthorized` — переход на `/login`, прочие — текст сервера).
- **ResultStep:** «Документ подписан», встроенный просмотр подписанного PDF (`<iframe src={signedFileUrl(id)}>` высотой не меньше 70% экрана), две кнопки: «Скачать» (ссылка `signedFileUrl(id)` с атрибутом `download`) и «Загрузить другой документ» (вызывает `onAnother`).
- Тесты (jsdom): MockPadDriver (рисование через синтетические pointer-события → PNG непустой, отмена → `PadError('cancelled')`, abort), `buildPadPrompt`, SignStep с поддельным драйвером (успех → вызван `onSigned`; `PadError('pad_not_found')` → сообщение; отмена → нет ошибки; ошибка API → сообщение) — для подмены драйвера сделать так, чтобы `SignStep` принимал необязательный `props.driver?: PadDriver`.
- Не менять: `shared/src/**`, `server/**`, `web/src/api.ts`, `web/src/pad/index.ts`, `web/src/pad/signotec.ts`, `web/src/pages/**`, `web/src/steps/MarkStep.tsx`.
- Готово: корневые проверки зелёные.
- Не делать: разметку блоков, реальный драйвер signotec, Docker.

### T-005 · Веб: драйвер signotec (signoPAD-API/Web)
D T-001 · ⏱ 90 · M sol/high
Контекст: реальный планшет Evolis Sig100 (= signotec Sigma) управляется через службу signoPAD-API/Web, которую ставят на Windows-ПК. Страница подключается к ней по WebSocket через JavaScript-библиотеку signotec. Справка — `docs/BRIEF.md`, разделы 4 и 5. **Файла библиотеки у нас пока нет** (имя и версию из дистрибутива даст Ali, положит в `web/public/vendor/`), поэтому драйвер пишется по документации, а все обращения к библиотеке изолированы в одном тонком слое, чтобы после проверки на реальном планшете поправить вызовы в одном месте.
- Файлы: `web/src/pad/signotec.ts` (класс `SignotecPadDriver implements PadDriver`, `kind: 'signotec'`), `web/src/pad/signotec/` (загрузчик библиотеки, типы `vendor.d.ts`, слой `vendor.ts`, перевод ошибок), тесты рядом, `docs/SIGNOTEC.md` (что реализовано, что не проверено, как подключить библиотеку и проверить на Windows). Новых пакетов не нужно.
- **Документация первоисточника.** В `docs/BRIEF.md`, раздел 9, есть ссылка на PDF «signoPAD-API/Web» (v3.5.0). Скачай его во временный каталог **вне репозитория** (например `/tmp`), прочитай нужные главы (подключение, `searchForPads`, `openPad`, `startSignature` и его параметры, `getSignatureImage`, `getSignatureData`, `closePad`, события, коды ошибок) и используй **точные** имена и сигнатуры. В брифе отмечены опечатки в примерах документации — сверяйся с описаниями методов. В репозиторий PDF не добавлять; расхождения с брифом запиши в `decisions_made` и `docs/SIGNOTEC.md`.
- **Загрузчик библиотеки:** вставляет `<script src>` один раз; адрес — `import.meta.env.VITE_SIGNOTEC_LIB_URL`, по умолчанию `/vendor/STPadServerLib.js`; если файл не загрузился — `PadError('service_unavailable', 'Библиотека signotec не найдена: положите файл в web/public/vendor/')`. Глобальные пространства имён библиотеки (`STPadServerLibCommons`, `STPadServerLibDefault`) описать в `vendor.d.ts` по документации.
- **Адрес службы:** `import.meta.env.VITE_SIGNOTEC_WS_URL`, по умолчанию `wss://local.signotecwebsocket.de:49494`.
- **Порядок вызовов** (стандартный режим): `createConnection(url, onopen, onclose, onerror)` (обернуть в Promise с таймаутом 8 секунд) → `searchForPads` (если в документации нужен) → `openPad({padIndex: 0})` → `startSignature(params)` (`fieldName` из запроса, `customText` = `prompt` из `CaptureOptions`, подтверждение и текст — по документации) → ждать подтверждения на планшете (событие или `confirmSignature` — как в документации) → `getSignatureImage` в формате PNG (толщина пера подобрать так, чтобы линия была заметной на изображении ~320×160; значение записать в `decisions_made`) → `getSignatureData` → `closePad` → при `disconnect()` `destroyConnection()`. Каждый `await` — в `try/catch`.
- **Перевод ошибок (`errors.ts`):** отрицательный `errorCode` и `errorMessage` библиотеки → `PadError` с кодами контракта: нет соединения/отказ сертификата → `service_unavailable`; нет планшета/занят → `pad_not_found`; отмена на планшете (`cancelSignature`/`stopSignature`) → `cancelled`; не пришла подпись за 3 минуты → `timeout`; остальное → `unknown` с `driverCode`. Таблицу сопоставления кодов возьми из главы с кодами ошибок; нет уверенности — `unknown`.
- **Кнопки на планшете:** «Повторить» очищает экран, подпись продолжается (в стандартном режиме это делает сам планшет); «Отмена» → `cancelled`.
- **`cancel()`** вызывает `cancelSignature` (если подпись идёт), **`disconnect()`** — `closePad` и `destroyConnection`; оба не бросают ошибок. Параллельный второй `capture` во время первого — `PadError('unknown', 'Подпись уже идёт')`.
- **`signal` из `CaptureOptions`:** при abort вызвать `cancel()` и вернуть `PadError('cancelled')`.
- **Результат:** `SignatureCapture` с `imagePngBase64` (без префикса `data:`), реальными `imageWidth`/`imageHeight` (прочитать из PNG-заголовка), `signDataBase64`. Если `getSignatureData` не удался — подпись всё равно возвращается без `signDataBase64` (запись в консоль `console.warn`), потому что картинка важнее.
- **Тесты (jsdom):** подменяют глобальные `STPadServerLibCommons`/`STPadServerLibDefault` поддельной реализацией с теми же именами методов: успешный сценарий (порядок вызовов проверяется), таймаут соединения, отказ `openPad`, отмена на планшете, `abort`, ошибка `getSignatureData` не ломает результат, повторный `capture` во время первого, разбор PNG-заголовка.
- Не менять: `shared/src/**`, `server/**`, `web/src/api.ts`, `web/src/pad/{index,mock}.ts`, `web/src/pages/**`, `web/src/steps/**`. (Файл `web/src/pad/signotec.ts` — заглушка из T-001 — заменить.)
- Готово: корневые проверки зелёные; `docs/SIGNOTEC.md` содержит список «не проверено без реального планшета» и пошаговую проверку на Windows (установка службы, открытие `STPadServer.html` из дистрибутива, перенос файла библиотеки, запуск `npm run dev -w web` и открытие `?pad=signotec`).
- Не делать: интерфейс подписи (`SignStep`), `mock`, серверную часть.

### T-006 · Выкладка: Dockerfile и Railway
D T-001, T-002 · ⏱ 45 · M sol/medium
Контекст: приложение — один Node-сервис (сервер раздаёт собранный `web/dist`). Хостинг — Railway, подключается к GitHub-репозиторию; выкладка = push в репозиторий. **Ничего не запускать на Railway и не создавать репозиториев** — только файлы.
- Файлы: `Dockerfile`, `.dockerignore`, `railway.json`, `.env.example`, `docs/DEPLOY.md`.
- **Dockerfile** (многоэтапный, `node:22-slim`): установка зависимостей `npm ci`, `npm run build` (собирает `server/dist/index.js` и `web/dist`), в финальном образе только нужное: `server/dist`, `web/dist`, `package*.json` и production-зависимости сервера; запуск не от root; `ENV NODE_ENV=production`, `DATA_DIR=/data`, `PORT` берётся из окружения платформы; `CMD ["node","server/dist/index.js"]`.
- **railway.json:** сборка по Dockerfile, `healthcheckPath` `/health`, политика перезапуска при сбоях.
- **.env.example:** все переменные из T-001 с пояснениями и пустыми секретами (`APP_PASSWORD=`, `SESSION_SECRET=`).
- **docs/DEPLOY.md** (по-русски, коротко): создать проект и сервис в Railway из GitHub-репозитория, подключить **Volume** к `/data`, задать переменные (`APP_PASSWORD`, `SESSION_SECRET` — длинная случайная строка, `RETENTION_DAYS`, `MAX_UPLOAD_MB`), домен, проверка `/health`; напоминание, что выкладка делается только пушем в репозиторий; что документы клиентов лежат на Volume и удаляются через `RETENTION_DAYS`.
- Проверка: `docker build` выполнять только если Docker установлен; иначе — локальная имитация: `npm ci && npm run build`, затем `NODE_ENV=production APP_PASSWORD=test SESSION_SECRET=x DATA_DIR=$(mktemp -d) node server/dist/index.js` и `curl` на `/health` и `/` (должен вернуться HTML приложения). Результат записать в `tests` статуса.
- Не менять: исходный код `server/src/**`, `web/src/**`, `shared/**` (если для запуска нужна правка — `state: "question"`).
- Готово: файлы созданы, локальная имитация отвечает на `/health` и `/`.
- Не делать: реальный деплой, создание репозитория, GitHub Actions.

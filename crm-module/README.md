# Модуль подписи для CRM (esign-module.js)

Готовый файл для браузера: **один файл `esign-module.js`**, не зависит от фреймворка CRM. Подключается обычным `<script>` и создаёт глобальный объект `ESign`. Внутри: разметка блоков подписи на страницах PDF (pdf.js), драйвер планшета Evolis Sig100 (signotec Sigma) и вшитая библиотека signotec `STPadServerLib.js` 3.5.0 (лицензия MIT).

Готовый файл лежит здесь: [`crm-module/site/esign-module.js`](site/esign-module.js) (около 2 МБ, 580 КБ в сжатом виде). Проверочная страница: [`crm-module/site/index.html`](site/index.html). На демонстрационном стенде она открывается по адресу `/crm-demo/index.html`.

Что модуль **не** делает: не вставляет подпись в PDF и ничего не отправляет на сервер. Он возвращает блоки и картинку подписи, а вставку в PDF делает сервер CRM (правила и код на C#: [docs/CSHARP.md](../docs/CSHARP.md)).

## Требования

- Chrome или Edge (актуальные), Windows.
- На компьютере сотрудника установлена и запущена служба signotec **signoPAD-API/Web**, планшет подключён по USB. Подробности: [docs/CRM-INTEGRATION.md](../docs/CRM-INTEGRATION.md), раздел 8.
- Страница CRM, на которой работает модуль: на демонстрации проверено по HTTPS; по обычному HTTP внутри сети банка и при новых ограничениях Chrome на доступ к локальной сети не проверено, это нужно проверить на стенде банка.

## Подключение

```html
<script src="/static/esign-module.js"></script>
<div id="marker"></div>
<script>
  // 1. Разметка блоков на странице PDF
  const marker = ESign.mountMarker(document.getElementById('marker'), {
    pdfUrl: '/crm/documents/123/file',            // PDF, открывается из браузера пользователя
    onChange: (blocks) => { /* список блоков изменился */ },
    onLoad: (info) => { /* info.pageCount, info.pages */ },
    onError: (error) => { /* не удалось открыть PDF */ },
  });

  // 2. Подпись на планшете (по кнопке «Подписать»)
  async function sign() {
    const blocks = marker.getBlocks();
    if (blocks.length === 0) return;
    try {
      const signature = await ESign.captureSignature({
        prompt: ESign.buildPrompt('Договор № 17'),   // текст на экране планшета
      });
      // 3. Отправить на сервер CRM блоки и картинку подписи
      await fetch('/crm/documents/123/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          blocks,
          signature: {
            imagePngBase64: signature.imagePngBase64,
            signDataBase64: signature.signDataBase64,
          },
        }),
      });
    } catch (error) {
      const info = ESign.describeError(error);
      alert(info.message);                           // info.details — для поддержки
    }
  }
</script>
```

## Что есть в `ESign`

| Вызов | Что делает |
|---|---|
| `ESign.mountMarker(контейнер, параметры)` | Показывает страницы PDF и даёт рисовать блоки мышью или пальцем. Возвращает управляющий объект (ниже). |
| `ESign.captureSignature(параметры)` | Подключается к службе, открывает планшет, показывает текст, ждёт подпись, закрывает планшет. Возвращает `{imagePngBase64, imageWidth, imageHeight, signDataBase64?}`. |
| `ESign.createPad(параметры)` | Драйвер планшета для ручного управления: `connect()`, `capture({prompt, signal})`, `cancel()`, `disconnect()`. |
| `ESign.buildPrompt(имя)` | Текст для экрана планшета «Подписываю документ: …» (до 60 символов). |
| `ESign.describeError(ошибка)` | `{code, message, details}`: сообщение по-русски и техническая строка. |
| `ESign.limits` | `{maxBlocks: 50, minBlockFraction: 0.02}`. |
| `ESign.version`, `ESign.signotecLibraryVersion` | Версии модуля и вшитой библиотеки. |
| `ESign.PadError` | Класс ошибок планшета. |

### Параметры `mountMarker`

| Параметр | Назначение |
|---|---|
| `pdfUrl` (обязателен) | Адрес PDF. Открывается из браузера пользователя, поэтому с cookie CRM, если они нужны. |
| `blocks` | Начальные блоки, например из шаблона документа. |
| `onChange(blocks)` | Вызывается при любом изменении списка блоков, получает копию списка. |
| `onLoad({pageCount, pages})` | PDF открыт. `pages` — видимые размеры страниц в пунктах и поворот. |
| `onError(error)` | PDF не открылся. |
| `pdfWorkerUrl` | Адрес файла `pdf.worker.min.mjs`. Нужен только при строгой политике безопасности CRM (см. ниже). |

Управляющий объект: `getBlocks()`, `setBlocks(blocks)`, `removeBlock(id)`, `clear()`, `destroy()`.

### Параметры `captureSignature` и `createPad`

| Параметр | Назначение |
|---|---|
| `prompt` (только `captureSignature`) | Текст на экране планшета. |
| `signal` (только `captureSignature`) | `AbortSignal`: прервать ожидание подписи (отмена). |
| `wsUrl` | Адрес службы. По умолчанию `wss://local.signotecwebsocket.de:49494`. |
| `libUrl` | Адрес файла `STPadServerLib.js`. Если не задан, используется вшитая копия. |

Параметры `wsUrl` и `libUrl` действуют на всю страницу (драйвер один на страницу).

## Формат блока

```json
{ "id": "93f441fd-…", "page": 0, "x": 0.178, "y": 0.183, "width": 0.364, "height": 0.053 }
```

`page` считается с нуля. `x, y, width, height` — доли **видимой** страницы (0..1, начало слева сверху, ось y вниз). Минимальный размер блока 2% по каждой стороне, не больше 50 блоков. Сервер переводит их в точки PDF по правилам из [docs/CSHARP.md](../docs/CSHARP.md).

## Ошибки планшета

`ESign.describeError(error).code`: `service_unavailable` (служба signotec не отвечает), `pad_not_found` (планшет не найден или занят), `cancelled` (отмена), `timeout` (подпись не пришла за 3 минуты), `unknown`. Для `cancelled` ошибку пользователю показывать не нужно.

## Политика безопасности страницы (CSP)

Модуль по умолчанию использует два приёма, которые строгая CSP может запретить:

1. **Вшитая библиотека signotec** подключается внутренним скриптом. Если CSP это запрещает (`script-src` без `'unsafe-inline'`), положите `STPadServerLib.js` на сервер CRM и передайте `libUrl`.
2. **Воркер pdf.js** создаётся из `blob:`. Если CSP это запрещает (`worker-src`), положите `pdf.worker.min.mjs` на сервер CRM и передайте `pdfWorkerUrl`. Файл лежит в проекте: `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` после `npm install`.

Кроме того, CSP страницы должна разрешать подключение к `wss://local.signotecwebsocket.de:49494` (`connect-src`).

## Сборка из исходников

```bash
npm install
npm run build:module      # создаёт crm-module/site/esign-module.js
npm run test:module       # тесты хранения блоков
```

Исходники: `crm-module/src/` (вход `index.ts`, разметка `marker.tsx` и `mount.tsx`, планшет `pad.ts`, состояние `store.ts`). Разметка и драйвер планшета используют те же файлы, что и наш сайт (`web/src/mark/`, `web/src/pad/`), поэтому исправления в них попадают в модуль после пересборки.

## Что проверено, что нет

**Проверено:** файл собирается, загружается на странице, открывает PDF (включая документ с повёрнутой страницей), блоки рисуются и попадают в `onChange` с долями страницы, вшитая библиотека signotec подключается, при отсутствии службы возвращается понятная ошибка `service_unavailable`. Драйвер планшета — тот же код, что на сайте (88 тестов сайта с подменой службы).

**Не проверено:** работа модуля на странице реальной CRM банка (стили, CSP), подпись через модуль на настоящем планшете (на сайте-демонстрации связка проверялась, но после последних правок повторной проверки на Windows не было), работа в старых браузерах.

# Перенос и внедрение в C#

Документ для разработчика: как встроить подпись на планшете Evolis Sig100 в CRM на C# (или в любую программу на C#) и как воспроизвести серверную часть нашего приложения. Контекст проекта банка (CRM в браузере на серверах банка, собственные ПК сотрудников без RDP, роли, требования, открытые вопросы) — в [CRM-INTEGRATION.md](CRM-INTEGRATION.md). Исходная логика приложения — в [README.md](../README.md). Все факты о библиотеке signotec взяты из [документации signoPAD-API для Windows](https://backend.signotec.com/wp-content/uploads/2026/06/signopad-api-windows-doku-en.pdf) (263 страницы), всё непроверенное помечено.

**Для веб-CRM банка читайте раздел 0 (путь C): готовый модуль для браузера + ядро PDF на сервере CRM.** Разделы 1–4 (пути A и B) нужны, только если подпись внедряется в программу на ПК или нужен полный порт приложения.

> Статус кода на C# в этом документе: **ни один фрагмент не компилировался и не запускался** (на машине подготовки нет .NET SDK). Корректность проверяйте по контрольным числам (раздел 6.3) и тестовым PDF из `samples/`.

## 0. Рекомендуемая схема для веб-CRM (путь C)

### 0.1. Кто что делает

```
Браузер сотрудника                              Сервер CRM (C#)
┌─────────────────────────────────┐            ┌────────────────────────────────┐
│ Страница документа CRM          │            │ 1. отдаёт PDF документа        │
│  + esign-module.js (готовый)    │  GET PDF   │ 2. принимает блоки и картинку  │
│    · разметка блоков            │◄──────────►│    подписи (POST sign)         │
│    · драйвер планшета           │  POST sign │ 3. проверяет блоки             │
│            │ wss :49494         │            │ 4. готовит картинку подписи    │
│            ▼                    │            │ 5. вставляет её в PDF          │
│ Служба signotec → планшет       │            │ 6. сохраняет, пишет журнал     │
└─────────────────────────────────┘            └────────────────────────────────┘
```

- **Браузерная часть готова:** [crm-module/README.md](../crm-module/README.md). Файл `crm-module/site/esign-module.js` подключается на страницу CRM, возвращает блоки и картинку подписи. Проверочная страница: `crm-module/site/index.html`.
- **Серверную часть пишет программист CRM на C#:** этот раздел и разделы 6–8.

### 0.2. Контракт серверной части

Формат запросов совпадает с нашим приложением (`shared/src/index.ts`), поэтому модуль работает с любым сервером, который его выполняет. Адреса в CRM могут быть любыми; важны содержание и формат.

**Получить PDF** (для показа в браузере): обычный адрес CRM, отдающий оригинал документа (`application/pdf`) пользователю с правом на документ. Адрес передаётся модулю как `pdfUrl`.

**Принять подпись:** `POST …/sign`, тело `application/json` до 5 МБ.

```json
{
  "blocks": [
    { "id": "93f441fd-18dc-44ae-bf56-66916472c7e8", "page": 1, "x": 0.14, "y": 0.26, "width": 0.30, "height": 0.06 }
  ],
  "signature": {
    "imagePngBase64": "iVBORw0KGgo…",
    "signDataBase64": "dGVzdA==",
    "padKind": "signotec"
  }
}
```

Ответ 200: `{"document": {…сведения о документе в CRM…}, "stampedBlocks": 1}`. Что именно возвращать в `document`, решает CRM; модуль ответ не использует.

**Отдать подписанный PDF:** адрес CRM, отдающий последнюю подписанную версию (`application/pdf`, `Cache-Control: no-store`).

Рекомендуемые DTO для системы, использующей `System.Text.Json` (имена полей в JSON — camelCase, как в примере выше):

```csharp
public sealed record SignatureBlockDto(string Id, int Page, double X, double Y, double Width, double Height);
public sealed record SignatureInputDto(string ImagePngBase64, string? SignDataBase64, string? PadKind);
public sealed record SignRequestDto(List<SignatureBlockDto> Blocks, SignatureInputDto Signature);
```

Ошибки сервера (формат нашего приложения; CRM может использовать свой, но коды стоит сохранить, чтобы тексты были понятны):

| HTTP | `error.code` | Когда |
|---|---|---|
| 401 | `unauthorized` | нет входа или нет права на документ |
| 404 | `document_not_found` | документа нет или он недоступен пользователю |
| 400 | `invalid_blocks` | блоки не прошли проверку (6.0) |
| 400 | `invalid_signature` | картинка подписи не читается или пустая |
| 400 | `bad_request` | тело запроса не разобрано |
| 413 | `file_too_large` | превышен размер запроса |
| 422 | `pdf_invalid`, `pdf_encrypted` | PDF не читается или защищён паролем (при загрузке) |
| 500 | `internal` | непредвиденная ошибка (без подробностей в ответе) |

### 0.3. Порядок обработки `…/sign` на сервере

1. Проверить право пользователя подписывать этот документ.
2. Прочитать **оригинал** PDF (не предыдущую подписанную версию).
3. Прочитать страницы: для каждой видимый размер и `/Rotate` (раздел 5.2).
4. **Проверить блоки** (6.0). Любая ошибка: `invalid_blocks`.
5. Декодировать `imagePngBase64`, **подготовить картинку** (6.1).
6. Для каждого блока посчитать `Placement` (6) и нарисовать картинку.
7. Сохранить новую версию документа: подписанный PDF, картинку подписи, `SignData` (если есть). Оригинал не менять. Желательно сохранить SHA-256 оригинала и подписанного PDF.
8. Записать в журнал: пользователь, время, документ, число блоков, устройство (`padKind`), результат.
9. Ответить 200.

### 0.4. Интерфейсы, которые удобно выделить в коде

```csharp
public sealed record PageInfo(double Width, double Height, int Rotation); // видимый размер в пунктах и /Rotate

public interface IPdfStamper
{
    IReadOnlyList<PageInfo> ReadPages(byte[] pdf);                     // pdf_invalid / pdf_encrypted → SignException
    byte[] Stamp(byte[] pdf, IReadOnlyList<SignatureBlockDto> blocks, byte[] signaturePng);
}

public sealed class SignException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;   // invalid_blocks | invalid_signature | pdf_invalid | pdf_encrypted
}
```

Библиотеку для PDF выбирает программист банка с учётом лицензий (кандидаты: PDFsharp, лицензия MIT; iText 7 лицензируется как AGPL либо коммерчески; PDFium-обёртки для показа). Требования к ней: открыть PDF, прочитать CropBox/MediaBox и `/Rotate` (с учётом наследования от родителей), нарисовать PNG с прозрачностью в заданной точке с заданным размером и поворотом. Для PDFsharp, возможно, потребуется настройка системы координат (начало сверху слева, автоматический учёт поворота); это нужно проверить по таблице 6.3.

### 0.5. Подключение модуля на странице CRM

Пример в [crm-module/README.md](../crm-module/README.md). Кратко:

```html
<script src="/static/esign-module.js"></script>
<script>
  const marker = ESign.mountMarker(container, { pdfUrl: '/crm/documents/123/file', onChange: renderBlockList });

  async function sign() {
    const signature = await ESign.captureSignature({ prompt: ESign.buildPrompt('Договор № 17') });
    await fetch('/crm/documents/123/sign', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blocks: marker.getBlocks(),
                             signature: { imagePngBase64: signature.imagePngBase64,
                                          signDataBase64: signature.signDataBase64, padKind: 'signotec' } }),
    });
  }
</script>
```

Если CRM использует строгую политику безопасности страницы (CSP), см. раздел «Политика безопасности» в README модуля. Модуль не зависит от фреймворка CRM и не меняет стили страницы вне своего контейнера.

### 0.6. Что получает программист

| Что | Где | Состояние |
|---|---|---|
| Готовый модуль для браузера | `crm-module/site/esign-module.js` | Готов, проверен в браузере (без реального планшета на этой машине) |
| Исходники модуля и сборка | `crm-module/` | Готовы |
| Проверочная страница модуля | `crm-module/site/index.html` | Готова; на стенде: `/crm-demo/index.html` |
| Геометрия, обработка картинки, проверка блоков на C# | разделы 6.0–6.3 ниже | Код не компилировался |
| Контрольные числа для проверки | раздел 6.3 | Получены запуском нашей версии |
| Тестовые PDF | `samples/` | Готовы |
| Чек-лист приёмки | раздел 8 | Готов |

## 1. Два других пути (для программ на ПК и для полного порта)

| | Путь A. Гибрид для программы на ПК | Путь B. Полный порт на C# |
|---|---|---|
| Идея | Небольшая Windows-программа на C# открывает **наш сайт** внутри себя (WebView2) и даёт ему планшет через `STPadLibNet.dll` | Всё приложение заново на C#: интерфейс, сервер, PDF |
| Что остаётся | Сервер на Railway, разметка блоков, вставка подписи, весь интерфейс без изменений | Ничего, переписывается всё |
| Что пишется | Оболочка (окно, мост, работа с планшетом), новый драйвер `native` в сайте | Интерфейс разметки, сервер, ядро PDF, хранение, вход |
| Что исчезает у сотрудника | Служба signoPAD-API/Web, сертификаты, запись в `hosts`, настройки Edge | То же |
| Что нужно ставить | Одна наша программа | Одна наша программа (и сервер, если локальный) |
| Объём работ | Малый | Большой |
| Риск | Низкий: серверная часть и геометрия уже проверены | Средний: геометрию и PDF нужно воспроизвести и проверить заново |

Отдельный вариант для уже существующей C#-программы: взять из пути A только «мост и работу с планшетом» (раздел 4) и подключить к её интерфейсу, а картинку подписи отправлять в наш сервер или вставлять локально (раздел 6).

## 2. Что даёт библиотека STPadLibNet

Факты из документации:

- `STPadLibNet.dll` — .NET-библиотека классов, пространство имён `signotec.STPadLibNet`. Подходит для .NET Framework 4.6.2 и новее и для .NET 6 и новее.
- Есть невизуальный класс `STPadLib` и визуальный `STPadLibControl` (Windows Forms; в WPF через Windows Forms Host). Для нашей задачи нужен `STPadLib`.
- Это «mixed mode» библиотека (управляемый и неуправляемый код). Нужно вызывать `Dispose()`, когда экземпляр больше не нужен.
- Библиотеку **можно поставлять вместе со своей программой** отдельными файлами (раздел документации «Notes for redistribution»). Нужны сама DLL, файлы `STPad.ini` и `STPadStores.ini` (если применимо) и среды выполнения Microsoft: C++ Redistributable 2015–2022 (версия 14.3) и, для `STPadLibNet.dll`, .NET Framework 4.6.2 (установщик signotec ставит их сам; в собственном установщике это нужно предусмотреть).
- События вызываются **в потоке DLL**, а не в потоке окна. Менять интерфейс из обработчика напрямую нельзя, нужен `Invoke` или `TaskCompletionSource`.
- Только Windows. На Mac не работает.
- Сигма в режиме HID, по даташиту, драйвер не требует. На Windows 8.1 signotec рекомендует свой HID-драйвер (`PadDrivers` в установщике).

Не проверено: коммерческие условия распространения DLL (в документации есть разрешение на поставку файлов, условия лицензии отдельно); работа именно Sig100 через `STPadLibNet` (на нашем ПК не пробовали); битность проекта должна совпадать с битностью DLL (проверить по поставляемым файлам).

## 3. Что делает планшет в нативном режиме (важное отличие)

В нашем сайте служба signotec сама рисует на планшете окно подписи: поле, текст и кнопки «OK», «Повторить», «Отмена». **В нативной библиотеке этого нет.** Программа должна сама:

1. нарисовать картинку экрана планшета (320×160: текст «Подписываю документ: …», область подписи, три кнопки) и показать её на планшете (`DisplaySetImage` или `DisplaySetImageFromFile`; текст можно выводить `DisplaySetText`);
2. ограничить область подписи над кнопками (`SensorSetSignRect`);
3. задать «горячие точки» на кнопках (`SensorAddHotSpot(left, top, width, height)`, возвращает идентификатор) и по событию `SensorHotSpotPressed` выполнять действие кнопки.

Это самая большая новая работа в пути A.

## 4. Путь A: гибрид «C#-оболочка + наш сайт»

### 4.1. Схема

```
Программа на C# (WPF или WinForms, .NET 8, Windows)
┌─────────────────────────────────────────────────────┐
│ WebView2: открывает https://<наш сайт>              │
│   сайт ──postMessage──►  мост  ──►  PadService      │
│   сайт ◄──сообщение────  мост  ◄──  (STPadLibNet)   │
└─────────────────────────────────────────────────────┘
         │ USB (HID)
         ▼
   Планшет Sig100
```

Сервер, разметка, вставка подписи, вход и скачивание остаются на сайте без изменений. Меняется только способ получить подпись.

### 4.2. Мост между сайтом и программой

WebView2: сайт вызывает `window.chrome.webview.postMessage(json)`, программа получает событие `CoreWebView2.WebMessageReceived` и отвечает `CoreWebView2.PostWebMessageAsJson(json)`. Это стандартный механизм WebView2.

Сообщения сайт → программа (поле `id` — для сопоставления ответа):

```json
{ "id": "1", "type": "pad.connect" }
{ "id": "2", "type": "pad.capture", "prompt": "Подписываю документ: Договор 17" }
{ "id": "3", "type": "pad.cancel" }
{ "id": "4", "type": "pad.disconnect" }
```

Ответ программа → сайт:

```json
{ "id": "2", "ok": true,
  "result": { "imagePngBase64": "...", "imageWidth": 640, "imageHeight": 320, "signDataBase64": "..." } }
{ "id": "2", "ok": false,
  "error": { "code": "pad_not_found", "message": "Планшет не найден", "driverCode": -22 } }
```

`code` — те же значения, что у `PadErrorCode`: `service_unavailable`, `pad_not_found`, `cancelled`, `timeout`, `unknown`. Для нативного варианта `service_unavailable` означает «библиотека не загрузилась».

Безопасность моста: принимать сообщения только от нашего адреса (проверять `Source` документа), открывать в окне только наш адрес, остальные переходы блокировать (`NavigationStarting`), не включать лишних возможностей (`AreDevToolsEnabled=false` в рабочей версии).

### 4.3. Что менять в нашем репозитории

Эти правки небольшие, их делает Claude (меняется контракт):

1. `shared/src/index.ts`: добавить `'native'` в `PadKind`.
2. `server/src/routes/documents.ts`: разрешить `padKind === 'native'` (сейчас сервер принимает только `mock` и `signotec`).
3. `web/src/pad/native.ts`: класс `NativePadDriver implements PadDriver`, который шлёт сообщения моста и ждёт ответы по `id`; `capture` поддерживает `AbortSignal` (при отмене шлёт `pad.cancel`).
4. `web/src/pad/index.ts`: если есть `window.chrome?.webview`, выбирать `native` по умолчанию; параметр `?pad=` и `VITE_PAD_DRIVER` остаются.
5. Тесты: драйвер с поддельным `window.chrome.webview` (успех, ошибка, отмена, таймаут).

### 4.4. Сторона C#

Проекты решения:

```
ESign.Host/           WPF или WinForms: окно с WebView2, мост
ESign.Pad/            PadService: работа с STPadLibNet, без зависимостей от окна
ESign.Pad.Tests/      тесты PadService на подменённом интерфейсе планшета
```

`PadService` скрывает библиотеку за своим интерфейсом, чтобы остальной код тестировался без планшета:

```csharp
public interface IPadService : IAsyncDisposable
{
    Task ConnectAsync(CancellationToken ct);
    Task<SignatureResult> CaptureAsync(string prompt, CancellationToken ct);
    Task CancelAsync();
    Task DisconnectAsync();
}

public sealed record SignatureResult(string ImagePngBase64, int ImageWidth, int ImageHeight, string? SignDataBase64);

public sealed class PadException(string code, string message, int? driverCode = null) : Exception(message)
{
    public string Code { get; } = code;          // service_unavailable | pad_not_found | cancelled | timeout | unknown
    public int? DriverCode { get; } = driverCode;
}
```

Ошибки: в описаниях методов у отрицательных кодов возврата стоит пометка «not STPadLibNet.dll». Судя по этому, .NET-класс сообщает об ошибках исключениями, а не кодами. Проверить на первом запуске и завернуть в `PadException`.

Порядок работы `CaptureAsync` (имена методов взяты из документации; точные сигнатуры и возвращаемые значения .NET-класса сверить в разделах «STPadLibNet.dll»). Событие `SensorHotSpotPressed(hotSpotId)` срабатывает, когда перо поднято внутри прямоугольника, заданного `SensorAddHotSpot`; сам метод возвращает идентификатор точки. Прямоугольники кнопок не должны пересекаться с областью подписи и друг с другом.

1. `ConnectAsync`: `DeviceGetCount()`; если 0 или меньше, ошибка `pad_not_found`; `DeviceOpen(0, true)` (индекс из документации начинается с 0; наш опыт с signotec-службой показал, что индекс может быть другим, поэтому брать первый найденный и логировать).
2. Показать экран подписи (раздел 3): картинка с текстом `prompt` и кнопками, `SensorSetSignRect`, три `SensorAddHotSpot`.
3. `SignatureStart()`. Подписанные точки приходят событием `SignatureDataReceived(x, y, pressure, timestamp)`, их можно использовать для показа подписи в программе.
4. Событие `SensorHotSpotPressed(id)`:
   - «Повторить» — `SignatureRetry()` (очищает подпись, ожидание продолжается);
   - «Отмена» — `SignatureCancel()` и ошибка `cancelled`;
   - «OK» — `SignatureConfirm()`, затем шаг 5.
5. Получить результат: `SignatureSaveAsStreamEx(resolution, width, height, fileType, penWidth, penColor, options)`, `fileType` = 1 (PNG). Параметры по документации: `resolution` 75–600 ppi, `width`/`height` 0 — оригинальный размер (иначе максимум в пикселях), `penWidth` > 0 — фиксированная ширина пера, `penColor` — цвет подписи, `options` — битовая маска (по умолчанию картинка с пропорциями прямоугольника вокруг подписи). Затем `SignatureGetSignData()` для биометрии (необязательно).
6. Закрыть: `DeviceClose(0)`, `Dispose()`. Событие `DeviceDisconnected(index)` (USB выдернули) должно завершать подпись ошибкой `pad_not_found`.
7. Таймаут ожидания подписи 3 минуты (как у нас) → ошибка `timeout`; `CancellationToken` → `cancelled`.

Цвет: можно передать синий `penColor` прямо в `SignatureSaveAsStreamEx`, но **окончательную окраску и обрезку полей всё равно делает сервер** (`normalizeSignaturePng`), так что картинка может быть любой с белым или прозрачным фоном.

Потоки: обработчики событий вызываются в потоке DLL. Результат передавать через `TaskCompletionSource`, интерфейс обновлять через `Dispatcher.Invoke`.

### 4.5. Упаковка

- Целевая платформа: `net8.0-windows`, x64 (проверить битность DLL), публикация `self-contained` или с установкой .NET Desktop Runtime.
- Положить рядом: `STPadLibNet.dll` (и её зависимости из комплекта), `STPad.ini`, при необходимости установка C++ Redistributable.
- WebView2 Runtime (Evergreen) обычно уже есть в Windows 11 и актуальной Windows 10; иначе поставить установщиком Evergreen.
- Установщик: MSIX, WiX или Inno Setup. Подпись исполняемых файлов сертификатом подписи кода, чтобы не срабатывал SmartScreen (непроверено, зависит от политики компании).
- Обновления: сайт обновляется сам при push на Railway. Программу обновлять нужно только при изменении моста или работы с планшетом.

### 4.6. Задачи для разработки (порядок)

1. Claude: правки контракта и сервера (раздел 4.3, пункты 1–2), протокол моста зафиксировать в `shared`.
2. Codex: `NativePadDriver` и выбор драйвера в сайте (пункты 3–5).
3. Разработчик C#: `ESign.Pad` (интерфейс, `PadService`, экран планшета, события, ошибки) + тесты на подмене.
4. Разработчик C#: `ESign.Host` (окно, WebView2, мост, ограничение адресов).
5. Установщик и проверка на Windows-ПК с планшетом по чек-листу (раздел 8).

## 5. Путь B: полный порт на C#

Брать только если нужен полностью автономный клиент без нашего сайта. Соответствие компонентов:

| Что у нас | Что на C# (кандидаты, лицензии проверить) |
|---|---|
| Fastify-сервер | ASP.NET Core Minimal API: те же адреса и формат ошибок (раздел 6.2) |
| Вход и cookie `sid` | `HMACSHA256`, `CryptographicOperations.FixedTimeEquals`; ограничение попыток встроенным `RateLimiter` |
| Хранение в `DATA_DIR/<uuid>/` | та же структура файлов; атомарная запись через временный файл и `File.Move` |
| Очистка по сроку | `BackgroundService` с таймером раз в час |
| `pdf-lib` (вставка картинки) | PDFsharp (лицензия MIT), либо PDFium/другая; iText 7 — AGPL, требует коммерческой лицензии |
| `pngjs` (обработка подписи) | SkiaSharp (MIT) или `System.Drawing` только под Windows |
| `pdf.js` (показ страниц) | WebView2 с `pdf.js` либо PDFium-обёртки; для разметки нужен свой слой поверх страницы |
| React-интерфейс разметки | WPF `Canvas` с прямоугольниками и обработкой мыши, или тот же React в WebView2 |
| `PadDriver` | `IPadService` (раздел 4.4) |

### 5.1. Что переносить без изменений

- **Контракт API** ([shared/src/index.ts](../shared/src/index.ts)): те же адреса, поля и коды ошибок. Тогда наш сайт можно будет подключить к C#-серверу без правок.
- **Правила проверки блоков:** минимум 2% по каждой стороне, не больше 50, внутри страницы, id уникальны.
- **Ограничения:** загрузка 25 МБ, подпись до 5 МБ в теле, сессия 12 часов, вход 10 попыток в минуту, хранение 7 дней.
- **Геометрию вставки** (раздел 6).

### 5.2. Что проверять на новой библиотеке PDF

- Размер видимой страницы берётся из CropBox, иначе из MediaBox; наследование атрибутов страницы от родителей дерева страниц.
- `/Rotate` может быть любым кратным 90, в том числе отрицательным или больше 360: нормализовать `((r % 360) + 360) % 360`.
- Система координат рисования у библиотеки может отличаться (начало сверху слева, поворот страницы может применяться автоматически). Сверяйте по контрольным значениям (раздел 6.3) и по визуальной проверке на `samples/05-letter-s-povernutoy-stranicey.pdf`.
- Защищённые паролем PDF отклонять с кодом `pdf_encrypted`.

## 6. Геометрия вставки подписи: эталонная реализация на C#

Перевод [server/src/core/placement.ts](../server/src/core/placement.ts). Правило описано в README (раздел 4).

```csharp
public readonly record struct Block(double X, double Y, double Width, double Height); // доли видимой страницы
public readonly record struct PageGeometry(double BoxX, double BoxY, double BoxWidth, double BoxHeight, int Rotation); // 0/90/180/270
public readonly record struct Placement(double X, double Y, double Width, double Height, double RotateDegrees);

public static class Placer
{
    public static int NormalizeRotation(int angle)
    {
        var r = ((angle % 360) + 360) % 360;
        return r is 0 or 90 or 180 or 270 ? r : throw new ArgumentException("Поворот не кратен 90");
    }

    public static (double W, double H) DisplaySize(PageGeometry g) =>
        g.Rotation is 90 or 270 ? (g.BoxHeight, g.BoxWidth) : (g.BoxWidth, g.BoxHeight);

    public static (double X, double Y) DisplayToUser(PageGeometry g, double dx, double dy) => g.Rotation switch
    {
        0   => (g.BoxX + dx,               g.BoxY + g.BoxHeight - dy),
        90  => (g.BoxX + dy,               g.BoxY + dx),
        180 => (g.BoxX + g.BoxWidth - dx,  g.BoxY + dy),
        270 => (g.BoxX + g.BoxWidth - dy,  g.BoxY + g.BoxHeight - dx),
        _   => throw new ArgumentOutOfRangeException(nameof(g)),
    };

    public static Placement PlaceImageInBlock(Block b, PageGeometry g, double imgW, double imgH, double paddingFraction = 0.04)
    {
        if (!(imgW > 0) || !(imgH > 0)) throw new ArgumentException("Размер картинки должен быть больше нуля");
        var (W, H) = DisplaySize(g);
        double bx = b.X * W, by = b.Y * H, bw = b.Width * W, bh = b.Height * H;
        double pad = paddingFraction * Math.Min(bw, bh);
        double availW = Math.Max(bw - 2 * pad, 0.001), availH = Math.Max(bh - 2 * pad, 0.001);
        double s = Math.Min(availW / imgW, availH / imgH);
        double w = imgW * s, h = imgH * s;
        double dx = bx + (bw - w) / 2;             // левый край картинки на видимой странице
        double dyBottom = by + (bh + h) / 2;       // нижний край картинки на видимой странице (y вниз)
        var (x, y) = DisplayToUser(g, dx, dyBottom);
        return new Placement(x, y, w, h, g.Rotation); // поворот против часовой стрелки, градусы
    }
}
```

### 6.0. Проверка блоков (то же, что `validateBlocks`)

```csharp
public static class BlockValidator
{
    public const int MaxBlocks = 50;
    public const double MinFraction = 0.02;

    public static void Validate(IReadOnlyList<SignatureBlockDto> blocks, int pageCount)
    {
        if (blocks.Count == 0) throw new SignException("invalid_blocks", "Не отмечено ни одного блока подписи");
        if (blocks.Count > MaxBlocks) throw new SignException("invalid_blocks", $"Блоков не больше {MaxBlocks}");
        const double eps = 1e-9;
        var ids = new HashSet<string>();
        foreach (var b in blocks)
        {
            if (!ids.Add(b.Id)) throw new SignException("invalid_blocks", $"Повторяется идентификатор блока {b.Id}");
            if (b.Page < 0 || b.Page >= pageCount)
                throw new SignException("invalid_blocks", $"Блок {b.Id}: страницы {b.Page} нет в документе (страниц: {pageCount})");
            if (!double.IsFinite(b.X) || !double.IsFinite(b.Y) || !double.IsFinite(b.Width) || !double.IsFinite(b.Height))
                throw new SignException("invalid_blocks", $"Блок {b.Id}: координаты должны быть числами");
            if (b.Width < MinFraction || b.Height < MinFraction)
                throw new SignException("invalid_blocks", $"Блок {b.Id}: слишком маленький");
            if (b.X < -eps || b.Y < -eps || b.X + b.Width > 1 + eps || b.Y + b.Height > 1 + eps)
                throw new SignException("invalid_blocks", $"Блок {b.Id}: выходит за границы страницы");
        }
    }
}
```

### 6.1. Подготовка картинки подписи (то же, что `normalizeSignaturePng`)

Параметры: порог фона 235 (яркость `0.299R + 0.587G + 0.114B`), поля после обрезки 4 px, цвет чернил RGB (20, 40, 170).

1. Если в PNG нет прозрачности: для каждого пикселя `luma >= 235` → `alpha = 0`, иначе `alpha = min(255, round((235 − luma) / 235 · 255 · 1.4))`.
2. Если прозрачность есть, `alpha` не менять.
3. Цвет **всех** пикселей заменить на (20, 40, 170).
4. Обрезать по прямоугольнику пикселей с `alpha > 8`, добавить 4 px с каждой стороны (в пределах картинки).
5. Если ни одного такого пикселя нет, ошибка `invalid_signature` («На картинке нет подписи»).

Реализация на массиве пикселей RGBA (8 бит на канал, **непремультиплицированный** альфа-канал). Декодирование и кодирование PNG выполняет выбранная библиотека. Внимание: многие библиотеки хранят пиксели в порядке BGRA или с премультиплицированной прозрачностью; приведите данные к RGBA перед вызовом.

```csharp
public static class SignatureInk
{
    public static (byte[] Rgba, int Width, int Height) Normalize(
        byte[] rgba, int width, int height,
        int backgroundLuma = 235, int margin = 4, (byte R, byte G, byte B)? ink = null)
    {
        var (r, g, b) = ink ?? ((byte)20, (byte)40, (byte)170);
        var data = (byte[])rgba.Clone();

        bool hasTransparency = false;
        for (int i = 3; i < data.Length; i += 4)
            if (data[i] < 255) { hasTransparency = true; break; }

        int minX = width, minY = height, maxX = -1, maxY = -1;
        for (int y = 0; y < height; y++)
        for (int x = 0; x < width; x++)
        {
            int i = (y * width + x) * 4;
            if (!hasTransparency)
            {
                double luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                int alpha = luma >= backgroundLuma
                    ? 0
                    : (int)Math.Round((backgroundLuma - luma) / backgroundLuma * 255 * 1.4, MidpointRounding.AwayFromZero);
                data[i + 3] = (byte)Math.Min(255, alpha);
            }
            data[i] = r; data[i + 1] = g; data[i + 2] = b;
            if (data[i + 3] > 8)
            {
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        }
        if (maxX < 0) throw new SignException("invalid_signature", "На картинке нет подписи");

        int x0 = Math.Max(minX - margin, 0), y0 = Math.Max(minY - margin, 0);
        int x1 = Math.Min(maxX + margin, width - 1), y1 = Math.Min(maxY + margin, height - 1);
        int cw = x1 - x0 + 1, ch = y1 - y0 + 1;
        var cropped = new byte[cw * ch * 4];
        for (int y = 0; y < ch; y++)
            Buffer.BlockCopy(data, ((y0 + y) * width + x0) * 4, cropped, y * cw * 4, cw * 4);
        return (cropped, cw, ch);
    }
}
```

Проверка: на тестовой картинке (белый фон, чёрные штрихи, широкие поля) результат должен быть меньше исходной по обеим осям, угол картинки прозрачным, все непрозрачные пиксели цвета (20, 40, 170). Те же проверки есть в наших тестах `server/test/pdf.test.ts`.

### 6.2. Что должен делать серверный метод подписи

`POST /api/documents/{id}/sign`: взять оригинал, проверить блоки, подготовить картинку (6.1), для каждого блока посчитать `Placement` и нарисовать картинку, сохранить `signed.pdf`, `signature.png`, `signdata.b64`, обновить `meta.json`. Ответ `{document, stampedBlocks}`.

### 6.3. Контрольные значения

Блок `x=0.1, y=0.7, width=0.4, height=0.12`, картинка 600×240 px, отступ 0.04. Результат `PlaceImageInBlock` должен совпадать с таблицей с точностью до 1e-3:

| Страница | Rotation | X | Y | Width | Height |
|---|---|---|---|---|---|
| A4 595.28×841.89, начало (0, 0) | 0 | 63.5691 | 156.0476 | 230.0299 | 92.0119 |
| A4 | 90 | 485.2723 | 170.4184 | 164.2973 | 65.7189 |
| A4 | 180 | 531.7109 | 685.8424 | 230.0299 | 92.0119 |
| A4 | 270 | 110.0077 | 671.4716 | 164.2973 | 65.7189 |
| Letter 612×792, начало (12, −7) | 0 | 86.3040 | 139.3616 | 218.5920 | 87.4368 |
| Letter | 90 | 510.9024 | 146.1440 | 168.9120 | 67.5648 |
| Letter | 180 | 549.6960 | 638.6384 | 218.5920 | 87.4368 |
| Letter | 270 | 125.0976 | 631.8560 | 168.9120 | 67.5648 |

Для повёрнутых страниц `BoxWidth/BoxHeight` — это размеры **до** поворота (в пространстве PDF), а видимые размеры вычисляются функцией `DisplaySize`.

Эти значения получены запуском [server/src/core/placement.ts](../server/src/core/placement.ts). При сомнениях воспроизведите их командой `npm test -w server`: тест `placement.test.ts` проверяет те же углы независимой обратной картой.

## 7. Что менять, если C# встраивается в уже существующую программу

Если у вас есть своя программа на C# с документами:

1. Получение подписи берите из `PadService` (раздел 4.4) без нашего сайта.
2. Вставку подписи делайте либо нашим сервером (POST `/api/documents/{id}/sign` с блоками и картинкой), либо локально по разделу 6.
3. Блоки в вашей программе должны храниться в долях видимой страницы (0..1, начало слева сверху), чтобы формулы раздела 6 работали без изменений.
4. Показать картинку подписи в предпросмотре можно сразу после получения от планшета: белый фон и пустые поля уберёт `6.1`.

## 8. Чек-лист приёмки

Проверить на Windows-ПК с планшетом на каждом из файлов `samples/01…05`:

- [ ] Подключение при подключённом планшете, при отключённом USB и при уже занятом планшете даёт правильные ошибки (`pad_not_found`).
- [ ] На экране планшета виден текст, области подписи и кнопки; все три кнопки работают (OK, Повторить, Отмена).
- [ ] Подпись попадает во все блоки; пропорции сохранены; подпись синяя; повёрнутая страница в `05` читается прямо.
- [ ] Отмена на планшете возвращает на экран подписи без ошибки; отмена кнопкой на сайте останавливает подпись.
- [ ] Выдернутый USB во время подписи даёт ошибку, и повторная попытка после подключения работает.
- [ ] Подпись не пришла за 3 минуты → `timeout`.
- [ ] Закрытие окна программы освобождает планшет (его можно открыть из другой программы).
- [ ] Модуль `esign-module.js` на странице CRM: PDF открывается, блоки рисуются мышью, `onChange` отдаёт блоки в долях страницы; проверочная страница `crm-demo/index.html` на ПК с планшетом получает подпись.
- [ ] Сервер: все блоки проходят проверку 6.0 (включая отклонение выхода за страницу, дубля id, слишком малого блока, пустого списка); контрольные числа 6.3 совпадают с точностью 1e-3.
- [ ] Страницы PDF с поворотом 90/180/270 и со смещённым CropBox (в `samples/05`) дают подпись, стоящую прямо и в нужном месте.
- [ ] Строгая CSP страницы CRM: работают варианты `libUrl` и `pdfWorkerUrl` из README модуля.
- [ ] Результат визуально совпадает с эталоном, полученным нашей версией (рендер страниц в картинки и сравнение).

## 9. Открытые вопросы перед стартом

1. Путь A или B (рекомендую A).
2. Способ раздачи программы: установщик MSIX, WiX или Inno Setup; есть ли сертификат подписи кода.
3. Лицензионные условия signotec на поставку `STPadLibNet.dll` с вашей программой (проверить в письменном виде).
4. Нужно ли сохранять браузерный режим как запасной (служба signotec остаётся рабочей).
5. Целевые версии: .NET 8 для новой программы или .NET Framework 4.6.2 для старой.
6. Хранить ли `SignData` (биометрию подписи) и сколько. Сейчас сохраняется рядом с документом.

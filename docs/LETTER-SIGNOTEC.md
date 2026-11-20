# Черновик письма в signotec / Evolis

Не отправлено. Перед отправкой Ali проверяет текст и подставляет контакты. Отправлять от своего имени, с рабочей почты.

Кому: поддержка signotec (`info@signotec.de`) и поставщику планшета (Evolis). Язык — английский.

---

**Subject:** Evolis Sig100 (signotec Sigma): macOS support and legally binding signatures in a browser workflow

Hello,

We use the Evolis Sig100 signature pad (article ST-BE105-2-UEVL), which we understand is the signotec Sigma. We are building a web application where an employee uploads a PDF, marks the signature areas, and the customer signs once on the pad. The signature is then placed into all marked areas of the PDF.

We have checked that signoSign/2 works with this pad. For our own application we plan to use signoPAD-API/Web (documentation v3.5.0). Could you please help with the following:

1. **macOS.** Is signoPAD-API/Web (the WebSocket service and the JavaScript library) supported on macOS? If yes, which macOS versions and which installer? If not, is there any supported way to use the Sigma pad from a browser on macOS (for example the Java-based API)? The public documentation we found lists Windows and Linux only.

2. **Legally binding signature.** We need the signature to be legally valid (the country and the applicable law will be confirmed by our legal advisor). Is signoAPI (the Java variant on a server) suitable for this scenario: browser captures the signature on the pad, our server embeds it into the PDF with a document hash, a certificate, and protection against changes after signing? What are the licence terms and price, and is there a test licence?

3. **Automatic signing from our system.** In signoSign/Universal, can a signature on the pad be started automatically from our own application by a button, and can signature fields be placed by coordinates through the REST API? Where is the REST API parameter documentation (Swagger UI)?

4. **Security of the local service.** Does the signoPAD-API/Web service restrict which web pages (origins) may connect to it? A malicious page in the same browser could otherwise talk to the pad. Is there a configuration option for allowed origins?

5. **JavaScript library.** Which file and version of the JavaScript library should we use with signoPAD-API/Web 3.5.0, and is it available from a CDN or only from the installer?

6. **Pad display.** What is the recommended way to show a short confirmation text (for example "Signing document No. 17 of 20 Nov 2026") on the 320×160 display of the Sigma in the standard mode of signoPAD-API/Web?

Thank you in advance.

Best regards,
<!-- имя, компания, телефон — подставить перед отправкой -->

---

## Краткий смысл вопросов (для Ali)

1. Работает ли служба и библиотека на Mac. Без ответа делаем только Windows.
2. Подходит ли signoAPI для юридически значимой подписи, сколько стоит, есть ли тест.
3. Запасной вариант signoSign/Universal: можно ли запускать подпись кнопкой и ставить поля координатами.
4. Защита локальной службы от чужих страниц в браузере.
5. Имя и версия JS-файла библиотеки (нужно для T-005).
6. Как показать короткий текст на экране планшета.

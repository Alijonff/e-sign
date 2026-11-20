# Выкладка e-sign на Railway

Выкладка выполняется только пушем в подключённую ветку GitHub.

1. Создайте проект Railway и сервис из существующего GitHub-репозитория. Выберите ветку `main` и корень репозитория. Railway подхватит `Dockerfile` из корня. [Сборка Dockerfile](https://docs.railway.com/builds/dockerfiles)
2. Подключите к сервису Volume с точкой монтирования `/data`. Добавьте переменную `RAILWAY_RUN_UID=0`, чтобы стартовый скрипт мог выдать пользователю `node` права на Volume перед запуском сервера. [Права на Volume](https://docs.railway.com/volumes#permissions)
3. В Variables задайте `APP_PASSWORD` (общий пароль), `SESSION_SECRET` (длинная случайная строка, например из `openssl rand -hex 32`), `RETENTION_DAYS=7` и `MAX_UPLOAD_MB=25`. Dockerfile задаёт `DATA_DIR=/data` и `NODE_ENV=production`, Railway передаёт `PORT`.
4. В настройках нового сервиса задайте Healthcheck Path `/health` и Restart Policy `On Failure`. `railway.json` содержит те же значения для сервисов с прежней поддержкой Config as Code. Railway объявил прекращение этой поддержки с 1 декабря 2026 года. [Config as Code](https://docs.railway.com/config-as-code)
5. В разделе Public Networking выберите Generate Domain. После пуша откройте `https://<домен>/health` и проверьте ответ `200` с `{"ok":true}`. На `https://<домен>/` должна открыться страница входа.

Загруженные и подписанные PDF клиентов хранятся на Volume. Сервер удаляет документы старше `RETENTION_DAYS` при запуске и при ежечасной очистке.

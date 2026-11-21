# Отдельный сервис проверочной страницы и готового модуля для CRM.
# Сборка из корня репозитория: docker build -f crm-module/Dockerfile .
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY crm-module/serve.mjs ./serve.mjs
COPY crm-module/site ./site
USER node
CMD ["node", "serve.mjs"]

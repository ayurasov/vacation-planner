# Многоступенчатая сборка API-сервера (docs/specs/07-environments-cicd.md).
FROM node:20-alpine AS build
WORKDIR /app
# Технологическая независимость: Prisma CLI не обращается к checkpoint.prisma.io, установка пакетов
# не отправляет статистику (@scarf/scarf из swagger-ui-dist), npm не проверяет свою новую версию
ENV CHECKPOINT_DISABLE=1 SCARF_ANALYTICS=false NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig*.json ./
COPY src ./src
# Seed компилируется в JS: в рабочем образе нет tsx и dev-зависимостей
RUN npm run build && npm run build:seed && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production CHECKPOINT_DISABLE=1 NPM_CONFIG_UPDATE_NOTIFIER=false
# openssl — для движка Prisma на alpine
RUN apk add --no-cache openssl
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-seed ./dist-seed
COPY --from=build /app/prisma ./prisma
EXPOSE 8080
# Миграции применяются при старте. prisma — рабочая зависимость и вызывается напрямую, без npx:
# стенд поднимается в закрытом контуре. Демо-данные: docker compose exec server npm run db:seed:prod
# exec: node заменяет оболочку и получает SIGTERM от docker compose stop — запросы и потоки событий
# завершаются штатно, а не обрываются через 10 секунд по SIGKILL (E51-07)
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]

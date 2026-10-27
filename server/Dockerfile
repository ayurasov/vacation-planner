# Многоступенчатая сборка API-сервера (docs/specs/07-environments-cicd.md).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
#better-sqlite3 не используется; openssl для Prisma на alpine
RUN apk add --no-cache openssl
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
EXPOSE 8080
# Миграции применяются при старте; сервер ждёт готовности БД
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]

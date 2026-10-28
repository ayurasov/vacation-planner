# Сборка SPA и отдача через Nginx (стенд: за этим контейнером — server)
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx-main.conf /etc/nginx/nginx.conf
# Шаблон конфигурации: образ nginx подставляет переменные окружения при старте (envsubst)
# и пишет результат в /etc/nginx/conf.d/default.conf. 127.0.0.11 — DNS Docker в сети compose.
ENV NGINX_RESOLVER=127.0.0.11 API_UPSTREAM=server:8080
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

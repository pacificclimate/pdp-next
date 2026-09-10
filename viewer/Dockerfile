FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.mjs ./
COPY viewer ./viewer
RUN npm run build

FROM nginx:alpine

COPY viewer/nginx.conf /etc/nginx/conf.d/default.conf
COPY viewer/runtime-config.js.template /etc/nginx/templates/runtime-config.js.template
ENV NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html
COPY --from=build /app/dist /usr/share/nginx/html

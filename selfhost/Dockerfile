# Contexto de build: raíz del repo (necesita src/main/webapp)
#   docker build -f selfhost/Dockerfile -t drawio-selfhost .
FROM node:22-alpine AS deps
WORKDIR /app
COPY selfhost/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DRAWIO_DIR=/app/drawio
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY selfhost/package.json ./
COPY selfhost/server ./server
COPY selfhost/public ./public
COPY selfhost/drawio-config ./drawio-config
# Webapp estática de drawio (sin WEB-INF, que contiene jars/credenciales de servlets que no se usan)
COPY src/main/webapp ./drawio
RUN rm -rf ./drawio/WEB-INF && chown -R node:node /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server/index.js"]

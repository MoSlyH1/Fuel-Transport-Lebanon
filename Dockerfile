# Fuel & Transport — Node 20, no build step.
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# dependencies first so rebuilds are fast
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]

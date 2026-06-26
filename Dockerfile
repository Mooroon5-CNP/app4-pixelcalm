FROM node:20-alpine AS deps
WORKDIR /app
# hadolint ignore=DL3018
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
# hadolint ignore=DL3018
RUN apk add --no-cache tini libgcc libstdc++
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
EXPOSE 8080
USER 1000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]

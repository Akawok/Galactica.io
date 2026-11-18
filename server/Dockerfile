FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
# Seeds the assets volume on first start; admin uploads land here afterwards
COPY --chown=node:node assets assets
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]

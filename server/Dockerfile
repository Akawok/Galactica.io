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
# The assets volume keeps admin uploads; at each start, images shipped in the repo that it lacks
# (a ship added to the seed) are copied in, without overwriting anything.
COPY --chown=node:node assets assets-default
RUN mkdir assets && chown node:node assets
USER node
EXPOSE 3000
CMD ["sh", "-c", "cp -rn assets-default/. assets/ && exec node dist/index.js"]

# Multi-stage build for the HOMI backend (api + worker in one image;
# the container command selects the process, per spec 5.5).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
RUN npm ci --no-fund --no-audit
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm run build -w @homi/domain -w @homi/db -w @homi/api -w @homi/worker \
  && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/domain/dist ./node_modules/@homi/domain/dist
COPY --from=build /app/packages/domain/package.json ./node_modules/@homi/domain/
COPY --from=build /app/packages/db/dist ./node_modules/@homi/db/dist
COPY --from=build /app/packages/db/package.json ./node_modules/@homi/db/
COPY --from=build /app/packages/db/migrations ./migrations
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]

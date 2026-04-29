FROM oven/bun:alpine AS builder

WORKDIR /app

COPY ./ /app

RUN --mount=type=cache,target=/root/.bun/install/cache bun run bootstrap

FROM oven/bun:alpine AS release

RUN apk update && apk upgrade

WORKDIR /app

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/bun.lockb /app/bun.lockb

ENV NODE_ENV=production

RUN bun install --production --ignore-scripts

ENTRYPOINT ["bun", "dist/index.js"]

# Multistage build keeps the runtime image free of package-manager content and compilers.
# 未经验证：本机未运行 Docker。容器内服务仍绑定 127.0.0.1，宿主机无法直接访问；镜像不含 codex CLI。
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/agent-adapters/package.json packages/agent-adapters/package.json
RUN pnpm install --frozen-lockfile
COPY apps/server apps/server
COPY apps/web apps/web
COPY packages/shared packages/shared
COPY packages/agent-adapters packages/agent-adapters
RUN pnpm build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/agent-adapters/package.json ./packages/agent-adapters/package.json
COPY --from=build /app/packages/agent-adapters/dist ./packages/agent-adapters/dist
EXPOSE 4317
CMD ["node", "apps/server/dist/index.js"]

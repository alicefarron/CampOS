FROM node:22-alpine
ARG SERVICE
ARG PORT=3001
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @campost/shared-events build
RUN pnpm --filter @campost/${SERVICE} build
WORKDIR /app/apps/${SERVICE}
EXPOSE ${PORT}
CMD ["node", "dist/index.js"]

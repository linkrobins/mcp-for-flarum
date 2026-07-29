FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# --ignore-scripts is required, not cosmetic: the `prepare` script (which lets
# `npx github:...` build itself on install) would run here, before tsconfig.json
# and src/ have been copied. The explicit `npm run build` below does the compile.
RUN npm install --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* LICENSE ./
# Likewise: `prepare` would run here and fail, since tsc is a devDependency and
# this stage installs production deps only. dist/ is copied from the build stage.
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
# Default to stdio (local clients). For hosting, set MCP_TRANSPORT=http (see
# docker-compose.yml) and publish the port.
EXPOSE 3000
ENTRYPOINT ["node", "dist/index.js"]

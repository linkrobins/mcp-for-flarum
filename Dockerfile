FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* LICENSE ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
# Default to stdio (local clients). For hosting, set MCP_TRANSPORT=http (see
# docker-compose.yml) and publish the port.
EXPOSE 3000
ENTRYPOINT ["node", "dist/index.js"]

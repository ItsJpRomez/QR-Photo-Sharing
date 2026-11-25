# One image for both processes. The worker runs TypeScript directly, and HEIC decoding
# and sign fonts are read from the project folder, so the whole project is included.
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
# Settings are read when the server starts, not while building.
RUN npx next build

FROM base
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
# Web:     npm start
# Worker:  npm run start:worker
# Migrate: npm run db:migrate
CMD ["npm", "start"]

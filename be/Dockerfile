FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate --schema prisma/schema

COPY . .
RUN npm run build

# Recorded at image build, reported by GET /health. A container started from a
# stale image shows an old stamp, which is the fastest way to spot that
# "docker compose up -d" ran without --build.
RUN date -u +%Y-%m-%dT%H:%M:%SZ > /app/BUILD_STAMP

EXPOSE 3000

CMD ["node", "dist/index.js"]

FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate --schema prisma/schema

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]

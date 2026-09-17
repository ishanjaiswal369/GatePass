# GatePass

Monorepo with Expo (React Native) frontend and Fastify + Prisma (PostgreSQL) backend.

## Structure

```
fe/   — Expo React Native app
be/   — Fastify API with Prisma ORM + PostgreSQL
```

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL running locally

### Install dependencies
```bash
npm install
```

### Backend
```bash
cd be
cp .env.example .env
# Edit .env with your PostgreSQL credentials
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

### Frontend
```bash
cd fe
npm start
# Press 'i' for iOS emulator, 'a' for Android emulator, or scan QR with Expo Go
```

## API Endpoints

| Method | Path     | Description        |
|--------|----------|--------------------|
| GET    | /health  | Health check       |
| GET    | /users   | List all users     |
| POST   | /users   | Create a new user  |

## Eloquent?

Eloquent is Laravel's PHP ORM — it cannot be used with Node.js. This project uses **Prisma**, which is the Node equivalent: type-safe queries, migrations, and great DX.

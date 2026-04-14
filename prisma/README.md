# Prisma Setup Notes

## Migrations

Run `pnpm dlx prisma migrate dev --name init` once Postgres is running (via Docker Compose).

## Configuration

Prisma 7 uses `prisma.config.ts` at the project root for database connection configuration.
The `DATABASE_URL` environment variable must be set before running migrations or the app.

## Generate client

```bash
pnpm dlx prisma generate
```

## Development workflow

1. Start Postgres: `docker compose up postgres -d`
2. Run migrations: `pnpm dlx prisma migrate dev --name init`
3. View data: `pnpm dlx prisma studio`

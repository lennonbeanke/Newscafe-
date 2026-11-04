# News Cafe

Marketing website for News Cafe (Next.js) with a planned reservation and owner dashboard backend (PostgreSQL).

**Status:** the website frontend is complete and approved. The backend is in a free, local development foundation (milestone A1). Nothing is deployed and there is no production database.

## Repository layout
| Folder | Contents |
|---|---|
| `frontend/` | Next.js 16 website (TypeScript, Tailwind, Framer Motion, GSAP, Lenis) |
| `database/` | PostgreSQL migrations, fake development seed data, tests, Docker Compose file |
| `scripts/` | Development, backup/restore and repository-safety scripts |
| `docs/` | Setup, database, API design, backup and recovery, security, ownership, go-live path |
| `.github/workflows/ci.yml` | Automated checks (no deployment) |

## Frontend
```
cd frontend
npm install
npm run dev      # http://localhost:3000
npm run lint
```

## Database (local, fake data only)
See [docs/SETUP.md](docs/SETUP.md). In short: `scripts/colima-up.sh`, `scripts/db-up.sh`, `scripts/db-reset.sh`, `scripts/db-test.sh`.

## Rules
* The repository is private and owned by the business.
* No secrets, passwords, `.env` files, keys, database dumps, backups or the original menu PDFs are ever committed (enforced by `.gitignore`, a pre-commit check and a secret scan).
* Development and staging use fake data only; real customer data exists only in production.
* No deployment, push or paid service without the owner's written approval.

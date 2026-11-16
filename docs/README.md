# News Cafe documentation

Project-level documents live here. Documents about the backend (database, API, setup, security, backups) live with the code in [`backend/docs/`](../backend/docs/).

| Document | Purpose |
|---|---|
| [OWNERSHIP.md](OWNERSHIP.md) | Business ownership, account register, offboarding |
| [FREE-TIER-LIMITS.md](FREE-TIER-LIMITS.md) | What free hosting can and cannot do; booking-failure fallback |
| [GO-LIVE-PATH.md](GO-LIVE-PATH.md) | From testing to real customers |
| [PLAN-B-GATES.md](PLAN-B-GATES.md) | Conditions before any real production use |
| [plans/](plans/) | The planning reports, copied unchanged (v1 and v2 are partly superseded: v2 priced paid hosting that was not approved; v3 is the current R0 plan) |

## Backend documents ([`backend/docs/`](../backend/docs/))
| Document | Purpose |
|---|---|
| [SETUP.md](../backend/docs/SETUP.md) | Local, free development setup (Colima or Docker Desktop, PostgreSQL in a container, fake data, Node 24) |
| [DATABASE.md](../backend/docs/DATABASE.md) | Tables, reservation rules, safeguards, error codes |
| [API.md](../backend/docs/API.md) | The public API and the owner (admin) API |
| [openapi.json](../backend/docs/openapi.json), [openapi-admin.json](../backend/docs/openapi-admin.json), [openapi.draft.yaml](../backend/docs/openapi.draft.yaml) | The contract the frontend relies on (generated and tested by the backend) |
| [BACKUP-RECOVERY.md](../backend/docs/BACKUP-RECOVERY.md) | Encrypted backups and the recovery drill |
| [SECURITY.md](../backend/docs/SECURITY.md) | Access, secrets and data-protection rules |

# From testing to real customers

Real customers, real reservations and real data are the goal. Development and staging use fake data only; production holds real data. Every step below needs the owner's explicit approval.

| Stage | What happens | Data | Cost |
|---|---|---|---|
| 0. Plan A (current) | Local development, fake data | Fake | R0 |
| 1. Gates (see PLAN-B-GATES.md) | Written commercial-use confirmation, backup drill, fallback test, no-charge confirmation | none | R0 |
| 2. Staging | Free business-owned accounts; fake data; measure limits, cold starts, email | Fake | R0 |
| 3. Owner setup | The owner enters real hours, tables, durations and rules in the **production** dashboard (never copied from the dev seed); readiness checklist must pass | Real configuration | R0 |
| 4. Soft launch | Customers send booking requests, the owner confirms in the dashboard; auto-confirm OFF; email fallback active | Real | R0 |
| 5. Monitoring (about 4 weeks) | Watch usage against caps, backups, outages; decide on auto-confirm | Real | R0 |
| 6. Optional upgrade | Only if the owner chooses; standard PostgreSQL makes the move a restore plus a connection-string change | Real | Owner decides |

## Keeping test and real data apart
* Separate databases, accounts and secrets for development, staging and production. Production credentials never exist on a laptop.
* `app_environment` label, the fake-email block, `is_test` flag and script guards (see DATABASE.md).
* Production changes (migrations, deployments) happen only after a fresh backup and the owner's approval. Development scripts cannot reach production.
* Real customer data is never copied to development or staging. Bugs are reproduced with fake or anonymised data.
* Launch-day check: the owner makes one real booking flagged `is_test`, then cancels it; it never appears in reports.

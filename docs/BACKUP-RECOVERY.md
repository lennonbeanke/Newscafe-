# Backup and recovery

## Layers
| Layer | What | Where | Used for |
|---|---|---|---|
| 1. Provider restore | Neon Free keeps only a **6-hour** restore window and 1 manual snapshot (verified in Neon's documentation, 2 Nov 2026) | Provider | Quick undo of a very recent mistake |
| 2. **Our encrypted nightly dump** | `pg_dump -Fc` streamed into `age` encryption; the plain dump is never written to disk | Second private repository / storage owned by the business | Everything else: wrong edits found later, lost account, provider problems |
| 3. Owner's monthly copy | One dump downloaded by the owner | Storage the owner controls | Independence from every provider and from any developer |

Targets (best-effort on R0): data loss up to ~24 hours (nightly dump) or ~6 hours (provider restore); service back in a few hours. Not guaranteed.

## Keys
* `age` public-key encryption. Anyone can *create* a backup; only the **private key** can *open* one.
* The production private key is generated **offline by the owner**, stored in two safe places, and never placed in GitHub, CI, a server or an email. The developer never holds it.
* The development drill key (`database/backups/keys/`, git-ignored) is for fake data only and is not displayed.

## Commands (development database)
```
scripts/backup.sh          # encrypted backup -> database/backups/*.dump.age (git-ignored, mode 600)
scripts/restore.sh FILE newscafe_test_x   # restore into a NEW throw-away database; refuses newscafe_dev
scripts/restore-drill.sh   # full drill (below)
```
## Recovery drill (run before launch, then every quarter)
1. Encrypted backup of the dev database. 2. Restore into `newscafe_test_restore` using only the key file and the backup. 3. Compare row counts of **every** table with the original. 4. On the restored copy: the overlap constraint exists, a deliberate double booking is **refused**, history is still append-only, the environment label is intact. 5. Record timings, delete the copy.
Production drill (Plan B, later): restore the latest production dump into a *staging* database (never over production), run the double-booking tests there, sign off with the owner.

## Restore playbooks
* **Mistaken edit/delete:** restore the most recent dump (or, within 6 hours, the provider restore) into a NEW database, check, then copy the rows back or repoint the app.
* **Database or account lost:** create a new database, decrypt the latest dump with the offline key, `pg_restore`, restore photos (they are stored in the database), repoint the connection string, smoke-test.
* A restore never overwrites the live database in place.

## Limits of the local drill
Point-in-time recovery and the provider's 6-hour window cannot be rehearsed locally; they must be tested on the real (free) staging project in Plan B.

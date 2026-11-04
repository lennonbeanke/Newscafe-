# Ownership and handover

The business owns every account, the source code, the database, customer data and the backups. Developers are guests who can be removed.

## Rules
* One business-controlled email address is the root login for every account. Never a developer's address.
* **Two owner-level people** on every platform, so one lost phone cannot lock the business out.
* 2FA on everything. Recovery codes are printed and kept by the owner (a safe), never emailed to a developer.
* GitHub: a business-owned **organization**; the repository stays **private**; developers are members or outside collaborators with the lowest role they need.
* Domain and DNS registered in the business's name; the registrar login is held by the owner.
* Developers never use personal accounts to host the business.

## Account register (the owner fills this in; keep a copy offline)
| Service | Plan | Owner email | Second owner | 2FA recovery codes kept at | Renewal / review date |
|---|---|---|---|---|---|
| GitHub organization | Free (private repo) | | | | |
| Cloudflare (Plan B, not created) | Free | | | | |
| Neon (Plan B, not created) | Free | | | | |
| E-mail sending provider (Plan B, not created) | Free | | | | |
| Domain registrar | | | | | |
| Backup storage owned by the business | | | | | |
| Backup private key (offline) | n/a | held by: | held by: | | |

## Offboarding a developer (do all of these the same day)
1. Remove them from GitHub, Cloudflare, Neon and the e-mail provider. 2. Rotate the database password, API keys and tokens they could see. 3. Revoke all admin sessions. 4. Confirm the nightly backup job still runs and the owner still holds the backup key. 5. Update the register above.

## Handover pack for a new developer
`README.md`, `docs/SETUP.md`, `docs/DATABASE.md`, `docs/BACKUP-RECOVERY.md`, this register, and the plan documents in `docs/plans/`. Everything needed to rebuild is in the repository plus the owner's offline key and register.

## Costs
No paid subscription, card, automatic billing or purchase exists or may be created without the owner's explicit written approval. If any provider asks for a card or payment, work stops and the owner decides.

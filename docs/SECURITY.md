# Security

* **Owner-only access.** No public registration exists (no table path, function or endpoint). Owner accounts are created by a developer-run script only after the owner approves.
* **Passwords:** Argon2id hashes only (implemented in A2). **Sessions:** random token in an HttpOnly, Secure, SameSite cookie; only a hash is stored; expiry and revocation. **2FA** (authenticator app) recommended. **Login rate limiting and lockout**; generic error messages.
* **Authorization on the server** for every admin action, never only in the UI.
* **Secrets:** never in GitHub. Local `.env` files are git-ignored; production secrets live only in the host's secret store and the owner's password manager. The repository is protected by an allow-list `.gitignore`, a pre-commit check and a gitleaks scan (also in CI).
* **Data separation:** development and staging hold fake data only. Production holds real data and is never reachable from development scripts (see [DATABASE.md](DATABASE.md)). Real data is never copied downwards.
* **Database:** least-privilege application role (A2), parameterised queries, append-only history and audit log, immutable environment label.
* **Uploads:** type and size allow-list (images ≤ 2 MB), resized in the browser, random names.
* **POPIA:** consent timestamp on customer forms, minimal personal data, retention and anonymisation policy, privacy notice (owner to supply). Free plans give no data-processing contract and no South African region; take legal advice before launch.
* **Reporting a problem:** tell the owner immediately; rotate affected secrets (see OWNERSHIP.md offboarding).

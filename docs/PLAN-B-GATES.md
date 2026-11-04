# Plan B gates (checklist before any real production use)

Plan B (free production hosting) is **not approved**. These conditions are the owner's; each must be met and signed off first.
- [ ] **Written commercial-use confirmation from Cloudflare** (saved in the Ownership register).
- [ ] **Written commercial-use confirmation from Neon** (saved in the Ownership register).
- [ ] **Safe backup and recovery design:** nightly encrypted dump to business-owned storage; offline key held by the owner; recovery drill passed (see BACKUP-RECOVERY.md).
- [ ] **Free-tier outages and limitations** read and accepted by the owner (FREE-TIER-LIMITS.md).
- [ ] **Working reservation failure fallback**: email/online booking request, never automatic confirmation when the database is unavailable; tested with the database stopped (milestone A2).
- [ ] **No charges possible without approval:** no card on any account, billing pages checked, no auto-upgrade; verified per provider before creating anything.
- [ ] Owner has read the POPIA/legal note in SECURITY.md and decided about the European database location.
- [ ] Two owners on every account; Ownership register completed.
Nothing is created, deployed or purchased until the owner signs off each box in writing.

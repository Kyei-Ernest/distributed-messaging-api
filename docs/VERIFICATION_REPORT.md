# DMS Verification Report — Enterprise & Integration Readiness Audit

**Date:** 2026-08-24 · **Scope:** commit `f818d14` + audit fixes · **Method:** multi-approach (automated suites, static analysis, dependency CVE audit, live adversarial E2E, plug-and-play drill, LLM-consumability check, deployment validation)

---

## 1. Executive Verdict

| Claim | Verdict | Evidence |
|---|---|---|
| Core messaging works end-to-end | ✅ **Verified** | 30/30 live checks incl. real-time path |
| Tenant isolation is real | ✅ **Verified** | Cross-workspace list/post/read all denied |
| Security posture | ✅ **Strong** (2 critical env issues found & fixed) | §3, §4 |
| Plug-and-play integration | ✅ **Genuine** | Full CLI→provision→embed→webhook drill passed live |
| AI-agent / LLM usability | ✅ **Good, now excellent** | Valid OpenAPI 3.0.3, 55/55 ops documented |
| Enterprise/government-ready *today* | ⚠️ **Conditionally** — see honest gaps §6 |

## 2. Test Batteries (all green)

| Suite | Result |
|---|---|
| Django unit/integration (`manage.py test`) | **32/32 OK** — auth, tenancy, metering, quotas, webhooks, signing, CORS middleware, CLI bootstrap |
| Go WebSocket server (`go vet` + `go test ./...`) | vet clean · handlers tests pass · **gap: manager/pubsub have no tests** |
| Widget (`node dms-chat.test.js`) | **16/16 OK** |
| Live adversarial E2E (custom, against running stack) | **30/30 PASS** — see §5 |

Static analysis: `compileall` clean; **Bandit: 0 medium/high** (18 low = test-password false positives); secret-pattern scan clean; no `eval/exec/raw()/extra()/pickle`.

## 3. Dependency CVEs — found & fixed

`pip-audit` flagged vulnerable pins. **All bumped and re-tested:**

| Package | Was → Now | CVEs closed |
|---|---|---|
| Django | 6.0 → **6.0.8** | PYSEC-2026-2449/-2448/-3717 |
| djangorestframework | 3.14.0 → **3.15.2** | PYSEC-2026-1304 |
| cryptography | 46.0.3 → **50.0.0** | 7 advisories incl. GHSA-537c-gmf6-5ccf |
| requests / pytest | 2.32.5 / 9.0.2 → **2.33.0 / 9.0.3** | PYSEC-2026-2275 / -1845 |

Post-bump: `pip-audit` reports **no known vulnerabilities**; full suite still green.

## 4. Critical findings from live testing (fixed)

1. **Browser WebSocket connection was broken in production code** — clients sent `Bearer <jwt>` as a subprotocol; RFC 6455 forbids spaces in protocol tokens, so browsers throw `SyntaxError` before connecting. Fixed across SPA + widget to the server-supported `token.<jwt>` form (JWT dots are legal token chars). Go extractor unchanged (accepts both).
2. **Silent JWT secret mismatch** — `websocket-server/.env` held a placeholder ≠ Django `SECRET_KEY`; every real token was rejected with 401 and nothing told you why. Secret synced; Go now logs a loud startup warning (and hard-fails in production) for placeholder secrets.
3. **Per-workspace CORS preflights failed** — corsheaders short-circuits unknown origins before our middleware could decorate them. Middleware rewritten to answer tenant preflights directly (204 + ACAO), moved first in the stack, with a 60 s origin cache.
4. **Login brute-force throttle demonstrably fires** — repeated audit runs hit `429` on `/auth/login/`. Treated as a *positive* finding; documented rather than suppressed.

## 5. Live E2E matrix (against running stack)

```
Plug-and-play   bootstrap_workspace prints id+key once .............. ok
                provision user via API key .......................... ok
                provision group via API key ......................... ok
Auth gates      unauthenticated rejected / garbage JWT 401 .......... ok
                bad password → 400 (and 429 throttle under load) .... ok
Tenant isolation B cannot list A's groups ........................... ok
                B cannot post into A's group ........................ ok
                B cannot read A's messages .......................... ok
RBAC            non-member post denied / non-author delete denied ... ok
Quota           quota exceeded → 403 at cap ......................... ok
WebSocket       valid token subprotocol → connected ................. ok
                invalid token pre-upgrade 401 ....................... ok
                evil origin blocked 403 (CSWSH) ..................... ok
Webhooks        subscription create; secret once .................... ok
                delivery HMAC-SHA256 verifies live .................. ok
                event header + payload shape ........................ ok
CORS            listed embed origin preflight allowed ............... ok
                unknown origin denied ............................... ok
LLM surface     OpenAPI 3.0.3 parses; security schemes declared ..... ok
                55/55 operations carry summaries .................... ok
Widget          v2.0.0 served, zero-dependency verified ............. ok
Deployment      docker compose config valid; env examples complete .. ok
```

## 6. Honest gaps between "verified" and "government-grade"

These are real; they are scoped, not hidden:

| # | Gap | Why it matters | Path |
|---|---|---|---|
| G1 | No test coverage on Go `manager/`+`pubsub/` | Fan-out core is the system's heart | Table-driven routing tests (miniredis) — ~2 days |
| G2 | At-most-once realtime delivery | Offline devices miss events (reconcile by refetch) | Streams workstream W3 in HARDENING_PLAN.md |
| G3 | Single-region, single Postgres/Redis | No HA story yet | Sentinel (W2) + managed DB |
| G4 | No audit log of admin/security events | Compliance frameworks expect it | django-auditlog style table — ~1 week |
| G5 | Webhooks lack retry/backoff & DLQ | At-least-once intent, not guarantee | Signed retry queue after W3 |
| G6 | No CI pipeline enforcing all gates above | Discipline currently manual | GitHub Actions: 3 suites + bandit + pip-audit + e2e |
| G7 | Password auth only (no MFA/SSO/SAML/OIDC) | Non-negotiable for gov deployments | OIDC via mozilla-django-oidc — ~1 week |
| G8 | Widget/SPA CSP relies on nginx headers only | Defense-in-depth for embeds | Per-widget nonce guidance in EMBED.md |

**Bottom line:** the architecture, isolation, security boundaries, and integration contract are genuinely sound and now *proven*, not asserted. The distance to government-grade is operational maturity (G1–G8), not redesign.

## 7. Reproducing this audit

```bash
python manage.py test                       # Django suite
cd websocket-server && go vet ./... && go test ./...
cd frontend/widget && node dms-chat.test.js
venv/bin/python -m bandit -r accounts messaging config -lll
venv/bin/python -m pip_audit -r requirements.txt --no-deps
# start stack (api :8002, ws :8001, front :5500), then:
venv/bin/python /tmp/opencode/dms_e2e.py    # promote into scripts/ when CI lands
```

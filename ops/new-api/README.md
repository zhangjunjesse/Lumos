# Lumos new-api production guardrails

This folder mirrors the production Nginx guard configuration for
`api.miki.zj.cn`.

It separates:

- `/v1/*`: OpenAI-compatible model traffic.
- `/api/user/login`: admin/user login attempts.
- `/api/*`: new-api panel/API calls.
- `/`: web/static/scanner traffic.

The `/v1/*` access log records Lumos attribution headers:

- `X-Lumos-Module`
- `X-Lumos-Operation`
- `X-Lumos-Session-Id`
- `X-Lumos-Run-Id`
- `X-Lumos-Stage-Id`

This lets production logs distinguish chat, workflow, knowledge indexing,
media planning, and memory intelligence traffic before new-api has native
prompt/header auditing.

The systemd timer runs a local health check every minute. It verifies Nginx,
the Docker container, `/healthz`, and `new-api`'s `/api/status`; it restarts
the container only after three consecutive failures.

The backup timer runs a SQLite online backup for `/opt/new-api/data/one-api.db`
once per day, verifies the backup with `PRAGMA integrity_check`, compresses it
with `zstd`, and keeps 30 days under `/opt/new-api/backups`.

The restore-check timer validates the newest compressed backup once per day by
decompressing it into a temporary file, opening it with SQLite, checking
`PRAGMA integrity_check`, and verifying that tables are present. It does not
modify the production database.

External alerts are optional. Create `/etc/lumos/new-api-alert.env` on the
server to enable them:

```sh
LUMOS_ALERT_WEBHOOK_TYPE=feishu
LUMOS_ALERT_WEBHOOK_URL=https://example.invalid/webhook
```

Supported webhook types are `feishu`, `wecom`, and `generic`.

See `STABILITY_AUDIT.md` for the current production stability checklist,
evidence, and remaining blockers.

`scripts/smoke-load-check.sh` provides a conservative repeatable health-load
check. Defaults are intentionally low: 20 `/healthz` requests with concurrency
5. Increase via `LUMOS_SMOKE_REQUESTS` and `LUMOS_SMOKE_CONCURRENCY` only for
planned load tests.

# Lumos new-api stability audit

Last updated: 2026-05-07

## Objective

Make the production `new-api` backend stable enough for more Lumos users.

## Success Criteria

| Requirement | Current evidence | Status |
| --- | --- | --- |
| `new-api` process is supervised | Docker container `new-api` has restart policy `always`; production check showed container up. | Covered |
| Public HTTPS endpoint works | `https://api.miki.zj.cn/healthz` returns `200 ok`; `/v1/models` returns expected unauthenticated `401`; `/api/status` returns `200`. | Covered |
| TLS renewal is scheduled | `acme.sh --list` includes `api.miki.zj.cn`; root crontab runs acme renewal daily at 04:46. | Covered |
| API, panel, login, and scanner traffic are isolated | `ops/new-api/nginx/new-api.conf` separates `/v1/*`, `/api/user/login`, `/api/*`, and web routes with separate Nginx limit zones. | Covered |
| Lumos request attribution reaches server logs | `ops/new-api/nginx/00-lumos-new-api-guards.conf` logs `X-Lumos-*` headers for `/v1/*`; smoke request was observed in `/var/log/nginx/new-api-v1.access.log`. | Covered |
| Client stops retry storms on terminal token/quota/auth errors | `llm-error-classifier`, `llm-circuit-breaker`, StageWorker handling, and knowledge ingest terminal-failure cancellation are implemented and covered by targeted Jest tests. | Covered |
| Local UI can identify LLM consumption source | `设置 > Usage` shows the `LLM 请求账本` backed by `/api/usage/llm-requests` and `llm_request_logs`. | Covered |
| Manual Anthropic fetch paths carry attribution | `/api/skills/search` now adds `X-Lumos-*` headers and writes `llm_request_logs`. | Covered |
| New installations default to HTTPS | Lumos Cloud preset and provisioner default to `https://api.miki.zj.cn`. | Covered |
| Health checks can recover simple failures | `lumos-new-api-healthcheck.timer` runs every minute, checks Nginx, Docker, `/healthz`, and `/api/status`; after 3 consecutive failures it restarts `new-api`. | Covered |
| Database is backed up | `lumos-new-api-backup.timer` runs daily, uses SQLite `.backup`, verifies `PRAGMA integrity_check`, compresses with `zstd`, and keeps 30 days. Two production backups were verified. | Covered |
| Local service logs rotate | `/etc/logrotate.d/lumos-new-api` covers healthcheck, backup, and alert logs; existing Nginx logrotate covers `/var/log/nginx/*log`. | Covered |
| External alerts are available | `lumos-new-api-alert.sh` supports `feishu`, `wecom`, and `generic` webhooks and is called by healthcheck/backup scripts. Dry run verified skip behavior when unconfigured. | Partially covered |
| External alerts are actually delivered | Requires `/etc/lumos/new-api-alert.env` with a real webhook. | Missing input |
| No fixed daily full-server interruption | Root crontab still contains `0 2 * * * /sbin/reboot`. | Needs decision |
| Off-host disaster recovery exists | Backups are local to the same server. | Missing |
| Restore procedure is rehearsed | Non-destructive restore check is deployed and verified: latest compressed backup was decompressed into a temp DB, `PRAGMA integrity_check` returned ok, and 25 tables were found. Full production restore drill is not yet done. | Partially covered |
| new-api app-native prompt/request audit exists | Nginx can log attribution headers; production container contains only the compiled `/new-api` binary and `/data`, with no Go source or `go.mod`; new-api itself does not yet persist prompt/request metadata or provide an admin audit page. | Missing source/deploy input |
| Production load testing is done | Conservative smoke load script exists and was run from the server: 20 `/healthz` requests at concurrency 5, all 20 succeeded. Realistic high-concurrency/stress test is not yet done. | Partially covered |

## Current Blockers

1. Decide whether to remove the root crontab daily reboot.
2. Provide or choose a real alert webhook target.
3. Choose an off-host backup target for disaster recovery.
4. Run a full restore drill in a disposable/staging environment.
5. Provide the `new-api` source repository or a custom image build/deploy path for native prompt/request auditing.

#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://api.miki.zj.cn}"
REQUESTS="${LUMOS_SMOKE_REQUESTS:-20}"
CONCURRENCY="${LUMOS_SMOKE_CONCURRENCY:-5}"
TIMEOUT_SECONDS="${LUMOS_SMOKE_TIMEOUT_SECONDS:-8}"
NO_PROXY_TARGETS="${LUMOS_SMOKE_NO_PROXY:-*}"

tmp_dir="$(mktemp -d /tmp/lumos-new-api-smoke.XXXXXX)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

run_one() {
  local index="$1"
  local target="$BASE_URL/healthz"
  local status
  status="$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT_SECONDS" --noproxy "$NO_PROXY_TARGETS" "$target" || true)"
  printf '%s\n' "$status" > "$tmp_dir/$index.status"
}

for i in $(seq 1 "$REQUESTS"); do
  run_one "$i" &
  if [ $((i % CONCURRENCY)) -eq 0 ]; then
    wait
  fi
done
wait

ok_count="$(awk '$1 == 200 { count++ } END { print count + 0 }' "$tmp_dir"/*.status)"
fail_count=$((REQUESTS - ok_count))

printf 'base_url=%s requests=%s concurrency=%s ok=%s failed=%s\n' \
  "$BASE_URL" "$REQUESTS" "$CONCURRENCY" "$ok_count" "$fail_count"

if [ "$fail_count" -ne 0 ]; then
  printf 'status breakdown:\n'
  sort "$tmp_dir"/*.status | uniq -c
  exit 1
fi

#!/usr/bin/env bash
# Build machines on Azure that exist only while a job runs on them.
#
# Every machine lives in the resource group `nib-ci`, which holds nothing between
# builds: a VM on an ephemeral OS disk (no managed disk to pay for) with its own
# network, all tagged with the run that made it and the time it must be gone by.
# Three things delete it, none relying on the others: the run's own teardown job
# (`down`), the sweeper workflow every half hour (`sweep`), and the machine itself when
# its one job ends or its lifetime is up (boot.ps1).
#
#     machines.sh start <row>=<os>/<arch> ...   a machine per row; prints {"row": "label"}
#     machines.sh watch <row>=<os>/<arch> ...   until each is online, once more elsewhere
#     machines.sh down                          every resource of this run
#     machines.sh sweep                         every resource past its time, or with none
#
# A row's job runs on the label `start` printed for it, and on GitHub's own runner when
# it printed none because no region had room. `start` returns as soon as Azure has
# accepted the machines, so the run's other jobs never wait for one to boot; `watch`
# makes sure each does. GH_TOKEN needs administration rights on the repository (the CI
# app's token, for just-in-time runners) and `az` must be signed in (OIDC).
set -euo pipefail

GROUP="${NIB_CI_GROUP:-nib-ci}"
PY="${PYTHON:-python3}"
REPO="${GITHUB_REPOSITORY:-lxorb/orden}"
RUN="${GITHUB_RUN_ID:-0}-${GITHUB_RUN_ATTEMPT:-0}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# The longest job is two hours; nothing outlives this.
LIFETIME_MIN="${NIB_CI_LIFETIME_MIN:-180}"
read -r -a REGIONS <<<"${NIB_CI_REGIONS:-swedencentral northeurope westeurope germanywestcentral}"
SIZE="${NIB_CI_SIZE:-Standard_D16ads_v7}"
IMAGE='{"publisher":"MicrosoftVisualStudio","offer":"visualstudiowsplustools","sku":"vs-latest-comm-ws2025-datacenter-azure-gen2","version":"latest"}'
ONLINE_WITHIN_S="${NIB_CI_ONLINE_WITHIN_S:-720}"

log() { echo "machines.sh: $*" >&2; }
# A path az and python can read, from Git Bash on Windows as well.
native() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }

# --- what is there -------------------------------------------------------------------

# "<type> <id>" of every resource whose tag $1 is $2 ("*": everything not kept).
tagged() {
  az resource list -g "$GROUP" -o json | "$PY" -c '
import json, sys
key, value = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None
for r in json.load(sys.stdin):
    tags = r.get("tags") or {}
    if tags.get("nib-ci-keep") == "1" or "/extensions/" in r["id"]:
        continue
    if key == "*" or tags.get(key) == value:
        print(r["type"], r["id"])
' "$@"
}

# Deletes what `tagged $@` lists: machines first (their NIC, address and disk go with
# them), then the rest, the networks last, until nothing is left.
delete_tagged() {
  local round all vms rest
  for round in 1 2 3 4 5 6; do
    all="$(tagged "$@")"
    [ -n "$all" ] || return 0
    vms="$(awk '$1 == "Microsoft.Compute/virtualMachines" { print $2 }' <<<"$all")"
    if [ -n "$vms" ]; then
      log "deleting $(wc -l <<<"$vms") machine(s)"
      # shellcheck disable=SC2086
      az vm delete --ids $vms --yes --force-deletion true -o none || true
      continue
    fi
    rest="$(awk '$1 !~ /virtualNetworks|networkSecurityGroups/ { print $2 }' <<<"$all")"
    [ -n "$rest" ] || rest="$(awk '{ print $2 }' <<<"$all")"
    log "deleting $(wc -l <<<"$rest") resource(s)"
    # shellcheck disable=SC2086
    az resource delete --ids $rest -o none || true
  done
  [ -z "$(tagged "$@")" ] || { log "still there after six rounds:"; tagged "$@" >&2; return 1; }
}

# Registered runners whose name starts with $1, as "<id> <status>".
runners() {
  gh api "repos/$REPO/actions/runners?per_page=100" \
    --jq ".runners[] | select(.name | startswith(\"$1\")) | \"\(.id) \(.status)\""
}

forget_runners() { # prefix [only this status]
  runners "$1" | while read -r id status; do
    [ -z "${2:-}" ] || [ "$status" = "$2" ] || continue
    gh api -X DELETE "repos/$REPO/actions/runners/$id" >/dev/null || true
  done
}

# --- making a machine ----------------------------------------------------------------

runner_url() {
  local tag
  tag="$(gh api repos/actions/runner/releases/latest --jq .tag_name)"
  echo "https://github.com/actions/runner/releases/download/$tag/actions-runner-win-x64-${tag#v}.zip"
}

abandon() { # name runner-prefix
  az deployment group cancel -g "$GROUP" -n "$1" -o none 2>/dev/null || true
  delete_tagged nib-ci-vm "$1" >&2 || true
  forget_runners "$2"
}

# Try $3 (a region, 1-based) of row $1, whose job waits on label $2. Fails, leaving
# nothing behind, when Azure does not take the machine.
launch() {
  local row="$1" label="$2" try="$3" os="$4" arch="$5"
  local region="${REGIONS[$((try - 1))]}" name="nibci-$RUN-$row-$try" runner="$label-$try" jit params
  [ "$os" = windows ] || { log "$row: no $os machine yet"; return 1; }
  jit="$(gh api -X POST "repos/$REPO/actions/runners/generate-jitconfig" \
    -f name="$runner" -F runner_group_id=1 -f "labels[]=$label" -f work_folder=_work \
    --jq .encoded_jit_config)"
  echo "::add-mask::$jit"
  params="$(mktemp)"
  NAME="$name" RUN="$RUN" SIZE="$SIZE" OS="$os" IMAGE="$IMAGE" \
    EXPIRES="$(date -u -d "+$LIFETIME_MIN minutes" +%Y-%m-%dT%H:%M:%SZ)" \
    REAPER="$(az identity show -g "$GROUP" -n nib-ci-reaper --query id -o tsv)" \
    PASSWORD="N1b-$(openssl rand -hex 16)" \
    BOOT="$("$PY" "$(native "$HERE/boot.py")" "$os" "$arch" "$jit" "${RUNNER_URL:?}" "${GITHUB_RUN_ID:?}" "$REPO" "$LIFETIME_MIN" "$row")" \
    "$PY" -c '
import json, os, sys
e, v = os.environ, lambda x: {"value": x}
json.dump({
  "name": v(e["NAME"]), "size": v(e["SIZE"]), "os": v(e["OS"]), "image": v(json.loads(e["IMAGE"])),
  "tags": v({"nib-ci": "1", "nib-ci-run": e["RUN"], "nib-ci-vm": e["NAME"], "nib-ci-expires": e["EXPIRES"]}),
  "reaper": v(e["REAPER"]), "password": v(e["PASSWORD"]), "boot": v(e["BOOT"]),
}, open(sys.argv[1], "w"))
' "$(native "$params")"
  log "$row: $SIZE in $region"
  local ok=1 waited
  az deployment group create -g "$GROUP" -n "$name" --template-file "$(native "$HERE/vm.json")" \
    --parameters "@$(native "$params")" location="$region" --no-wait -o none || ok=0
  rm -f "$params"
  # Quota, capacity and a size the region lacks all fail within seconds; once the VM
  # itself is being made, the region has taken it.
  for waited in 1 2 3 4 5 6 7 8 9 10 11 12; do
    [ "$ok" = 1 ] || break
    case "$(az deployment group show -g "$GROUP" -n "$name" --query properties.provisioningState -o tsv 2>/dev/null)" in
      Failed | Canceled) ok=0; break ;;
      Succeeded) break ;;
    esac
    [ -n "$(az vm show -g "$GROUP" -n "$name" --query id -o tsv 2>/dev/null)" ] && break
    sleep 5
  done
  [ "$ok" = 1 ] && return 0
  az deployment operation group list -g "$GROUP" -n "$name" \
    --query "[?properties.provisioningState=='Failed'].properties.statusMessage.error.message" -o tsv >&2 || true
  abandon "$name" "$runner"
  return 1
}

# Each region from try $3 on, until one takes the machine.
launch_from() {
  local try
  for ((try = $3; try <= ${#REGIONS[@]}; try++)); do
    launch "$1" "$2" "$try" "$4" "$5" && return 0
    log "$1: not in ${REGIONS[$((try - 1))]}"
  done
  return 1
}

label_of() { echo "nib-$RUN-$1"; }

# Runs "$1 <row> <os> <arch>" for every spec after it, side by side.
each_row() {
  local fn="$1" spec pids=() failed=0 pid
  shift
  for spec in "$@"; do
    local row="${spec%%=*}" os="${spec#*=}"
    "$fn" "$row" "${os%/*}" "${os#*/}" &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do wait "$pid" || failed=1; done
  return "$failed"
}

start_row() {
  local out="$OUT/$1"
  if launch_from "$1" "$(label_of "$1")" 1 "$2" "$3" 2>"$out.log"; then : >"$out"; fi
}

cmd_start() {
  RUNNER_URL="$(runner_url)"
  OUT="$(mktemp -d)"
  export RUNNER_URL OUT
  each_row start_row "$@" || true
  cat "$OUT"/*.log >&2 || true
  # {"row": "label"} for every row Azure took; the others run on GitHub's runners.
  local spec row sep=''
  printf '{'
  for spec in "$@"; do
    row="${spec%%=*}"
    if [ -e "$OUT/$row" ]; then
      printf '%s"%s":"%s"' "$sep" "$row" "$(label_of "$row")"
      sep=','
    else
      log "$row: no region took it, so it runs on GitHub's own runner"
    fi
  done
  printf '}\n'
  rm -rf "$OUT"
}

# Until the row's runner is online, or its job has started and the runner is gone.
online() {
  local row="$1" label started=$SECONDS
  label="$(label_of "$row")"
  while [ $((SECONDS - started)) -lt "$ONLINE_WITHIN_S" ]; do
    if runners "$label-" | grep -q ' online$'; then
      log "$row: online after $((SECONDS - started)) s"
      return 0
    fi
    if gh api "repos/$REPO/actions/runs/${GITHUB_RUN_ID:?}/jobs?per_page=100" \
      --jq ".jobs[].runner_name // empty" | grep -q "^$label-"; then
      log "$row: its job has started"
      return 0
    fi
    sleep 10
  done
  log "$row: no runner within $ONLINE_WITHIN_S s"
  return 1
}

# A machine that is made but never shows its runner gets one more try in the next
# region, for the same label, so the job waiting on it still gets its runner. When that
# fails too, this fails, and the workflow hands the run to GitHub's own runners.
watch_row() {
  local row="$1" name
  online "$row" && return 0
  for name in $(az vm list -g "$GROUP" --query "[?starts_with(name, 'nibci-$RUN-$row-')].name" -o tsv); do
    abandon "$name" "$(label_of "$row")-"
  done
  launch_from "$row" "$(label_of "$row")" 2 "$2" "$3" && online "$row"
}

cmd_watch() {
  RUNNER_URL="$(runner_url)"
  export RUNNER_URL
  each_row watch_row "$@"
}

cmd_down() {
  delete_tagged nib-ci-run "$RUN"
  # A runner whose machine went before it took its job stays registered, offline.
  [ -z "${GH_TOKEN:-}" ] || forget_runners "nib-$RUN-"
}

cmd_sweep() {
  local runs run
  runs="$(az resource list -g "$GROUP" -o json | "$PY" -c '
import json, sys
for r in json.load(sys.stdin):
    tags = r.get("tags") or {}
    if tags.get("nib-ci-keep") == "1" or "/extensions/" in r["id"]:
        continue
    if tags.get("nib-ci-expires", "") < sys.argv[1]:
        print(tags.get("nib-ci-run", "-"))
' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | sort -u)"
  for run in $runs; do
    log "past its time: $run"
    if [ "$run" = - ]; then
      # Without a run, which nothing of ours is: deleted all the same, machines first.
      local ids
      ids="$(az resource list -g "$GROUP" -o json | "$PY" -c '
import json, sys
for r in json.load(sys.stdin):
    tags = r.get("tags") or {}
    if tags.get("nib-ci-keep") != "1" and "nib-ci-run" not in tags and "/extensions/" not in r["id"]:
        print(r["type"], r["id"])
')"
      awk '$1 == "Microsoft.Compute/virtualMachines" { print $2 }' <<<"$ids" |
        xargs -r az vm delete --yes --force-deletion true -o none --ids || true
      awk '$1 != "Microsoft.Compute/virtualMachines" { print $2 }' <<<"$ids" |
        xargs -r az resource delete -o none --ids || true
    else
      delete_tagged nib-ci-run "$run" || true
    fi
  done
  [ -z "${GH_TOKEN:-}" ] || forget_runners "nib-" offline
  local left
  left="$(tagged '*')"
  if [ -n "$left" ]; then log "in $GROUP, still within their time:"; echo "$left" >&2; else log "$GROUP is empty"; fi
}

"cmd_${1:?start, watch, down or sweep}" "${@:2}"

#!/bin/bash
# coord-watch.sh: wait until a worker agent needs the coordinator, then print why and exit 0.
# usage: coord-watch.sh <name> (--file <transcript> | --read '<command>') [--plan <file>] [--interval <s>] [--max-polls <n>]
#   --file   a transcript file the worker's terminal writes to (for example a `script` log)
#   --read   a command that prints the worker's screen (your terminal's read command)
#   --plan   the file the worker must write its plan to; a change means "plan written"
# Reasons: plan file written | new PR URL <url> | limit | menu/question | error | turn ended | timeout (exit 2)
# Bash 3.2 compatible; needs only grep, tail, cksum and sleep.

name=${1:-}
[ -n "$name" ] || { echo "usage: coord-watch.sh <name> (--file <transcript> | --read '<command>') [--plan <file>] [--interval <s>] [--max-polls <n>]" >&2; exit 64; }
shift
file="" cmd="" plan="" interval=20 max=0
while [ $# -gt 0 ]; do
  case $1 in
    --file) file=$2 ;;
    --read) cmd=$2 ;;
    --plan) plan=$2 ;;
    --interval) interval=$2 ;;
    --max-polls) max=$2 ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
  shift 2 || { echo "missing value for the last option" >&2; exit 64; }
done
{ [ -n "$file" ] || [ -n "$cmd" ]; } || { echo "give --file or --read" >&2; exit 64; }

# The worker's screen; empty when the reader fails (a closed terminal looks like silence, not like an error).
screen() {
  if [ -n "$file" ]; then cat "$file" 2>/dev/null; else sh -c "$cmd" 2>/dev/null; fi
}
plan_sum() { if [ -n "$plan" ] && [ -f "$plan" ]; then cksum < "$plan"; else echo none; fi; }
prs() { grep -oE 'github\.com/[^ ]+/pull/[0-9]+' | sort -u; }

start=$(plan_sum)
seen=$(screen | prs)
last="" polls=0
while :; do
  sleep "$interval"
  polls=$((polls + 1))
  if [ -n "$plan" ] && [ "$(plan_sum)" != "$start" ]; then echo "$name: plan file written"; exit 0; fi
  out=$(screen | tail -n 25)
  pr=$(printf '%s\n' "$out" | prs | grep -vxF "$seen" | tail -n 1)
  [ -n "$pr" ] && { echo "$name: new PR URL https://$pr"; exit 0; }
  printf '%s\n' "$out" | grep -qiE 'usage limit|rate limit|limit reached|out of (credits|tokens)' && { echo "$name: limit"; exit 0; }
  printf '%s\n' "$out" | grep -qE '❯ [0-9]\.|Do you want|Would you like to proceed|\(y/n\)|Enter to confirm|Esc to cancel' && { echo "$name: menu/question"; exit 0; }
  printf '%s\n' "$out" | grep -qE '^ *(⎿ +)?API Error|^Resume this session with' && { echo "$name: error"; exit 0; }
  # The worker's footer ends each turn with a status block; the screen stops changing after it.
  printf '%s\n' "$out" | grep -qiE '✻ .* done|^[ -]*(blocked|next):' && [ "$out" = "$last" ] && { echo "$name: turn ended"; exit 0; }
  last=$out
  if [ "$max" -gt 0 ] && [ "$polls" -ge "$max" ]; then echo "$name: timeout"; exit 2; fi
done

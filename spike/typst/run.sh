#!/usr/bin/env bash
# Spike B — Typst. Install: https://github.com/typst/typst/releases
set -euo pipefail
cd "$(dirname "$0")"
typst compile --root .. po.typ out.pdf
echo "out.pdf written"
echo "bench (cold process per run — batch/watch mode will be faster):"
for i in $(seq 1 15); do
  s=$(date +%s%N); typst compile --root .. po.typ /tmp/bo-bench.pdf; e=$(date +%s%N)
  echo $(( (e - s) / 1000000 ))
done | sort -n | awk '{a[NR]=$1} END {print "p50=" a[int(NR/2)] "ms  min=" a[1] "ms  max=" a[NR] "ms"}'

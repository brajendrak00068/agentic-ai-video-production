#!/usr/bin/env bash
# scan-leaks.sh — block accidental exposure of internal architecture details in
# a PUBLIC distribution repo. Invoked from:
#   - .githooks/pre-commit             (pre-commit, scans staged files)
#   - .github/workflows/leak-check.yml (CI on push + PR, scans full tree)
#   - mcp-server/package.json prepublishOnly + plugin prepublishOnly (npm publish)
#
# Add a new sensitive phrase by appending to PATTERNS below — one PCRE per line,
# anchor with word boundaries (\b) when the phrase is short to avoid false hits.
# Allowlist with a trailing  # ALLOW: <reason>  comment on the offending line.
set -u

# ─── patterns ────────────────────────────────────────────────────────────────
# Pick names that have been deemed internal-only. These are NOT secrets in the
# crypto sense; they are architectural details the team decided not to disclose
# in public docs (see initial-release post-mortem on the v1.0.2 perception leak).
PATTERNS=(
  # Specific perception model identities (NEVER name them in public docs)
  '\bArcFace\b'
  '\bAdaFace\b'
  '\bLR-ASD\b'
  # Internal infra surface area
  '\bpgvector\b'
  '\bNVENC\b'
  '\bPerceptionState\b'
  '\bONNX\b'
  # Internal GCS buckets / model mirrors
  'gs://livecore-ml-models'
  'gs://adscene-'
  'gs://livecore-'
  # Internal architecture phrasing
  'four-tier intelligence'
  '4-tier intelligence'
  'six perception models'
  'Six ONNX models'
  '6 ONNX models'
  '6 perception models'
  'L0 — Perception'
  'L0  Perception'
  '## L0:'
  # Embedding-dimension leaks
  '512-d ArcFace'
  '1024-d multimodal'
)

# ─── target file selection ───────────────────────────────────────────────────
# Default: every file given on argv. Falls back to staged-files in pre-commit
# mode, or the whole tree in CI mode.
files=()
if [ $# -gt 0 ]; then
  for arg in "$@"; do files+=("$arg"); done
elif [ -n "${PRE_COMMIT:-}" ]; then
  while IFS= read -r line; do files+=("$line"); done < <(git diff --cached --name-only --diff-filter=ACMR)
else
  while IFS= read -r line; do files+=("$line"); done < <(git ls-files)
fi

# Skip binaries + dirs that hold legitimate references to these strings
# (the scanner itself, the workflow that runs it, and node_modules).
SKIP_RE='^(scripts/scan-leaks\.sh|\.github/workflows/leak-check\.yml|.*node_modules/.*|.*\.lock|.*\.png|.*\.jpg|.*\.jpeg|.*\.gif|.*\.mp4|.*\.mov|.*\.zip|.*\.tgz|package-lock\.json)$'

# ─── scan ────────────────────────────────────────────────────────────────────
hit_count=0
hits=()
file_count=0

if [ ${#files[@]} -eq 0 ]; then
  echo "✓ scan-leaks: nothing to scan."
  exit 0
fi

for f in "${files[@]}"; do
  [ -z "$f" ] && continue
  [ ! -f "$f" ] && continue
  echo "$f" | grep -qE "$SKIP_RE" && continue
  file_count=$((file_count + 1))
  for pat in "${PATTERNS[@]}"; do
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      # Allow opt-out via inline marker.
      echo "$line" | grep -q '# ALLOW:' && continue
      hits+=("$f: $line")
      hit_count=$((hit_count + 1))
    done < <(grep -nE -- "$pat" "$f" 2>/dev/null || true)
  done
done

if [ $hit_count -gt 0 ]; then
  echo "✖ scan-leaks: $hit_count sensitive marker(s) detected — blocking" >&2
  for h in "${hits[@]}"; do echo "  $h" >&2; done
  echo "" >&2
  echo "Allow a specific occurrence with a trailing  # ALLOW: <reason>  comment," >&2
  echo "or remove the marker from the file. Add new patterns in scripts/scan-leaks.sh." >&2
  exit 1
fi

echo "✓ scan-leaks: $file_count file(s) scanned, no internal markers found."
exit 0

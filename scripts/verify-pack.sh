#!/usr/bin/env bash
# Verify the npm distribution path.
#
# Two modes, because opencode resolves `plugin` array entries BY NPM NAME from the public
# registry into ~/.cache/opencode/packages/<name>/. Local specs -- a directory, a .tgz, a
# path to src/index.ts, even the package pre-installed into .opencode/node_modules -- are
# all ignored by the runtime loader. (`opencode plugin <dir>` accepts a directory, but it
# only writes config entries; it never vendors the package.) A registry 404 is silent: the
# cache dir is created, npm install fails, the plugin is skipped, nothing is logged.
#
# Consequence: the runtime load path CANNOT be exercised before publishing.
#
#   (default)     pre-publish. Packaging correctness only. Safe to run any time.
#   --published   post-publish smoke test. Installs BY NAME from the registry and
#                 asserts the server plugin actually initialises.
#
# Usage: [MODEL=...] [KEEP=1] scripts/verify-pack.sh [--published]
set -uo pipefail

MODE="${1:-pre}"
MODEL="${MODEL:-anthropic/claude-sonnet-5}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_NAME="$(bun -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).name)' "$REPO/package.json")"
WORK="$(mktemp -d)"
FAILED=0

cleanup() { [ -n "${KEEP:-}" ] && echo "kept: $WORK" || rm -rf "$WORK"; }
trap cleanup EXIT

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=1; }
note() { printf '  \033[33m····\033[0m %s\n' "$1"; }

echo "== pack =="
TARBALL="$(cd "$REPO" && npm pack --silent --pack-destination "$WORK")" || { echo "npm pack failed"; exit 1; }
TARBALL="$WORK/$TARBALL"
echo "  $TARBALL"

echo "== tarball contents =="
# Catches a bad `files` field -- the failure that ships a package with no entrypoints.
LISTING="$(tar tzf "$TARBALL")"
for f in package/src/index.ts package/src/tui.ts package/src/features/tasks.ts package/package.json; do
  grep -qx "$f" <<<"$LISTING" && pass "$f present" || fail "$f MISSING from tarball"
done

UNPACKED="$WORK/unpack/package"
mkdir -p "$WORK/unpack"
tar xzf "$TARBALL" -C "$WORK/unpack"

echo "== manifest =="
# The single highest-risk packaging fact: one package must expose BOTH surfaces.
# If exports["./tui"] ever breaks, the TUI half silently never loads for npm users
# while the dev loop (file plugins) keeps working -- the worst failure shape there is.
PROJ="$WORK/proj"
mkdir -p "$PROJ" && cd "$PROJ"
git init -q . && echo verify > README.md
git add -A && git -c user.email=v@v -c user.name=v commit -qm init

TLOG="$WORK/manifest.log"
timeout 90 opencode plugin "$UNPACKED" --force > "$TLOG" 2>&1 </dev/null
if grep -q "server + tui targets" "$TLOG"; then
  pass "exposes both targets: $(grep -o 'Detected.*targets' "$TLOG" | head -1)"
else
  fail "did not detect server + tui targets"
  sed 's/^/       /' "$TLOG" | head -20
fi

# The TUI half needs its OWN tui.json entry. An opencode.json entry alone loads only the
# server plugin -- which is why the README must tell users to run `opencode plugin`
# rather than hand-editing opencode.json.
[ -f "$PROJ/.opencode/tui.json" ] && grep -q "$UNPACKED" "$PROJ/.opencode/tui.json" \
  && pass "installer writes a tui.json entry (TUI surface registered separately)" \
  || fail "no tui.json entry -- TUI surface would silently not load"

echo "== metadata =="
bun -e '
const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
const bad = []
if (!p.engines?.opencode) bad.push("engines.opencode missing (loader semver-gate)")
if (!p.repository) bad.push("repository missing")
if (/^(latest|\*)$/.test(p.dependencies?.["@opencode-ai/plugin"] ?? "")) bad.push("@opencode-ai/plugin floats on latest")
if (!p.exports?.["./server"] || !p.exports?.["./tui"]) bad.push("exports./server or ./tui missing")
if (bad.length) { console.log(bad.join("\n")); process.exit(1) }
' "$UNPACKED/package.json" > "$WORK/meta.txt" 2>&1 \
  && pass "manifest metadata complete" \
  || { fail "manifest metadata problems:"; sed 's/^/       /' "$WORK/meta.txt"; }

if [ "$MODE" != "--published" ]; then
  echo
  note "pre-publish mode: runtime load NOT exercised (needs the package on the registry)"
  note "after \`npm publish\`, re-run: scripts/verify-pack.sh --published"
  echo
  [ "$FAILED" -eq 0 ] && echo "PACKAGING CHECKS PASSED" || echo "CHECKS FAILED (KEEP=1 to retain $WORK)"
  exit "$FAILED"
fi

echo "== registry =="
npm view "$PKG_NAME" version >/dev/null 2>&1 \
  && pass "$PKG_NAME published: $(npm view "$PKG_NAME" version 2>/dev/null)" \
  || { fail "$PKG_NAME is not on the registry -- publish first"; exit 1; }

# Install BY NAME: the only spec form the runtime loader honours.
# Carry over `provider` + auth plugins from the repo config, otherwise a temp dir cannot
# resolve anthropic/* and the run dies before any tool call. Merge into the file the
# installer wrote -- two files each declaring `plugin` do not union, one wins.
bun -e '
const [repoCfg, target, name] = process.argv.slice(1)   // bun -e: args start at 1
const fs = require("fs")
const read = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return {} } }
const base = read(repoCfg)
fs.mkdirSync(require("path").dirname(target), { recursive: true })
fs.writeFileSync(target, JSON.stringify({
  $schema: "https://opencode.ai/config.json",
  ...(base.provider ? { provider: base.provider } : {}),
  plugin: [...new Set([name, ...(base.plugin ?? [])])],
}, null, 2))
' "$REPO/.opencode/opencode.json" "$PROJ/.opencode/opencode.json" "$PKG_NAME"

echo "== runtime load =="
LOG="$WORK/server.log"
timeout 150 opencode run --print-logs -m "$MODEL" \
  "Call the usage_report tool once and print its output verbatim. Do nothing else." \
  > "$LOG" 2>&1 </dev/null

grep -qi "ProviderModelNotFoundError" "$LOG" \
  && fail "model '$MODEL' did not resolve -- set MODEL=<valid id>; checks below are meaningless"

# Model-INDEPENDENT proof of load: usage.init() calls ensureStateDir() unconditionally,
# so this directory exists iff the server plugin was constructed.
# Never grep the model's prose for the tool name -- it states the name while DENYING the
# tool exists ("no tool called `usage_report`"), which reads as a pass and is not one.
if [ -d "$PROJ/.opencode/overclock" ]; then
  pass "state dir created by usage.init: $(ls "$PROJ/.opencode/overclock" | tr '\n' ' ')"
else
  fail "no .opencode/overclock/ -- server plugin never initialised"
  note "check ~/.cache/opencode/packages/$PKG_NAME/node_modules (empty = install 404'd silently)"
fi

if grep -qi "no tool called\|not available in this environment\|none of which match" "$LOG"; then
  fail "model reports overclock tools absent from its toolset"
else
  pass "model did not report the tools missing"
fi

# Drift guard: modules self-disable when the SDK moves. Loud, not silent.
if grep -q "\[overclock\].*disabled: client lacks" "$LOG"; then
  fail "module(s) self-disabled against opencode $(opencode --version):"
  grep -o "\[overclock\].*disabled: client lacks.*" "$LOG" | sort -u | sed 's/^/       /'
else
  pass "no module self-disabled (SDK surfaces all present)"
fi

echo
[ "$FAILED" -eq 0 ] && echo "ALL CHECKS PASSED" || echo "CHECKS FAILED (KEEP=1 to retain $WORK)"
exit "$FAILED"

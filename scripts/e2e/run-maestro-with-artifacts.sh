#!/usr/bin/env bash
set -uo pipefail

PLATFORM="${1:-android}"
shift || true
ARTIFACT_ROOT="${E2E_ARTIFACT_DIR:-artifacts/maestro/${PLATFORM}}"
mkdir -p "$ARTIFACT_ROOT/test-output"

node scripts/check-e2e-environment.js "$PLATFORM"
MAESTRO_BIN="${MAESTRO_PATH:-$(node scripts/resolve-mobile-tool.js maestro)}"
ADB_BIN=""
XCRUN_BIN=""
if [[ "$PLATFORM" == "android" ]]; then
  ADB_BIN="${ADB_PATH:-$(node scripts/resolve-mobile-tool.js adb)}"
elif [[ "$PLATFORM" == "ios" ]]; then
  XCRUN_BIN="$(node scripts/resolve-mobile-tool.js xcrun)"
fi

FLOW_ARGS=("$@")
if [[ ${#FLOW_ARGS[@]} -eq 0 ]]; then
  FLOW_ARGS=(.maestro/flows)
fi

MAESTRO_HOST_ARGS=()
if [[ -n "${MAESTRO_HOST:-}" ]]; then
  MAESTRO_HOST_ARGS=(--host "$MAESTRO_HOST")
fi
MAESTRO_FILTER_ARGS=()
if [[ -n "${MAESTRO_INCLUDE_TAGS:-}" ]]; then
  MAESTRO_FILTER_ARGS+=(--include-tags="$MAESTRO_INCLUDE_TAGS")
fi
if [[ -n "${MAESTRO_EXCLUDE_TAGS:-}" ]]; then
  MAESTRO_FILTER_ARGS+=(--exclude-tags="$MAESTRO_EXCLUDE_TAGS")
fi

{
  echo "platform=$PLATFORM"
  echo "maestro=$MAESTRO_BIN"
  [[ -n "$ADB_BIN" ]] && echo "adb=$ADB_BIN"
  [[ -n "$XCRUN_BIN" ]] && echo "xcrun=$XCRUN_BIN"
  [[ -n "${MAESTRO_HOST:-}" ]] && echo "maestroHost=$MAESTRO_HOST"
  [[ -n "${MAESTRO_INCLUDE_TAGS:-}" ]] && echo "includeTags=$MAESTRO_INCLUDE_TAGS"
  [[ -n "${MAESTRO_EXCLUDE_TAGS:-}" ]] && echo "excludeTags=$MAESTRO_EXCLUDE_TAGS"
  [[ -n "${ADB_SERVER_SOCKET:-}" ]] && echo "adbServerSocket=$ADB_SERVER_SOCKET"
  printf 'flows=%s\n' "${FLOW_ARGS[*]}"
  echo "startedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$ARTIFACT_ROOT/environment.txt"

if [[ "$PLATFORM" == "android" ]]; then
  "$ADB_BIN" logcat -c >/dev/null 2>&1 || true
  "$ADB_BIN" devices -l > "$ARTIFACT_ROOT/devices.txt" 2>&1 || true
elif [[ "$PLATFORM" == "ios" ]]; then
  "$XCRUN_BIN" simctl list devices booted > "$ARTIFACT_ROOT/devices.txt" 2>&1 || true
fi

set +e
"$MAESTRO_BIN" "${MAESTRO_HOST_ARGS[@]}" --platform="$PLATFORM" --no-ansi test "${FLOW_ARGS[@]}" "${MAESTRO_FILTER_ARGS[@]}" \
  --format=JUNIT \
  --output="$ARTIFACT_ROOT/junit.xml" \
  --test-output-dir="$ARTIFACT_ROOT/test-output" \
  --flatten-debug-output \
  2>&1 | tee "$ARTIFACT_ROOT/maestro.log"
STATUS=${PIPESTATUS[0]}
set -e

if [[ "$PLATFORM" == "android" ]]; then
  "$ADB_BIN" logcat -d > "$ARTIFACT_ROOT/android-logcat.txt" 2>&1 || true
  "$ADB_BIN" exec-out screencap -p > "$ARTIFACT_ROOT/final-screen.png" 2>/dev/null || true
elif [[ "$PLATFORM" == "ios" ]]; then
  "$XCRUN_BIN" simctl spawn booted log show --last 15m > "$ARTIFACT_ROOT/ios-simulator.log" 2>&1 || true
  "$XCRUN_BIN" simctl io booted screenshot "$ARTIFACT_ROOT/final-screen.png" >/dev/null 2>&1 || true
fi

printf 'finishedAt=%s\nexitCode=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STATUS" >> "$ARTIFACT_ROOT/environment.txt"
exit "$STATUS"

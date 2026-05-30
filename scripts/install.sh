#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hammerspoon_dir="${HOME}/.hammerspoon"
init_path="${hammerspoon_dir}/init.lua"
launch_agents_dir="${HOME}/Library/LaunchAgents"
node_path="$(command -v node || true)"
proxy_url="${HTTPS_PROXY:-${https_proxy:-}}"

if [[ -z "${node_path}" ]]; then
  echo "Node.js is required for the optional AI spend wall."
  echo "Install Node.js, then rerun this script."
  exit 1
fi

mkdir -p "${hammerspoon_dir}" "${project_dir}/data/months"
if [[ ! -f "${project_dir}/config.json" ]]; then
  cp "${project_dir}/config.example.json" "${project_dir}/config.json"
  echo "Created ${project_dir}/config.json"
fi
if [[ ! -f "${project_dir}/.env" ]]; then
  cp "${project_dir}/.env.example" "${project_dir}/.env"
  echo "Created ${project_dir}/.env"
fi

touch "${init_path}"
if ! grep -q "xiaoer-ai-pay optional integration" "${init_path}"; then
  cat >> "${init_path}" <<'LUA'

-- xiaoer-ai-pay optional integration
local xiaoerPayOk, xiaoerPayErr = pcall(dofile, (os.getenv("HOME") or "") .. "/.hammerspoon/xiaoer-ai-pay/menubar.lua")
if not xiaoerPayOk then print("xiaoer-ai-pay load failed: " .. tostring(xiaoerPayErr)) end
LUA
fi

has_gemini_key="$(
  if grep -Eq '^[[:space:]]*GEMINI_API_KEY[[:space:]]*=[[:space:]]*[^[:space:]]+' "${project_dir}/.env"; then
    printf yes
  elif [[ -f "${HOME}/.shared-skills/api-registry/.env" ]] && grep -Eq '^[[:space:]]*GEMINI_API_KEY[[:space:]]*=[[:space:]]*[^[:space:]]+' "${HOME}/.shared-skills/api-registry/.env"; then
    printf yes
  else
    printf no
  fi
)"

if [[ "${has_gemini_key}" == "yes" ]]; then
  mkdir -p "${launch_agents_dir}"
  python3 - "${project_dir}" "${node_path}" "${proxy_url}" "${launch_agents_dir}" <<'PY'
import pathlib
import sys

project_dir, node_path, proxy_url, launch_agents_dir = sys.argv[1:]
source_dir = pathlib.Path(project_dir) / "gemini-meter"
target_dir = pathlib.Path(launch_agents_dir)
for name in ("com.xiaoer.gemini-meter.plist", "com.xiaoer.gemini-meter-watchdog.plist"):
    text = (source_dir / name).read_text(encoding="utf-8")
    text = text.replace("__PROJECT_DIR__", project_dir)
    text = text.replace("__NODE__", node_path)
    text = text.replace("__HTTPS_PROXY__", proxy_url)
    (target_dir / name).write_text(text, encoding="utf-8")
PY

  user_domain="gui/$(id -u)"
  for label in com.xiaoer.gemini-meter com.xiaoer.gemini-meter-watchdog; do
    plist="${launch_agents_dir}/${label}.plist"
    launchctl bootout "${user_domain}/${label}" >/dev/null 2>&1 || true
    launchctl bootstrap "${user_domain}" "${plist}" >/dev/null 2>&1 || true
  done
  echo "Installed Gemini metering launch agents."
else
  echo "Skipped Gemini metering proxy: add GEMINI_API_KEY to ${project_dir}/.env and rerun scripts/install.sh when needed."
fi

if [[ "${XIAOER_SKIP_RELOAD:-}" == "1" ]]; then
  echo "Skipped Hammerspoon reload."
elif command -v hs >/dev/null 2>&1; then
  hs -c 'hs.reload()' || true
else
  open -a Hammerspoon || true
fi

echo "Installed optional Xiaoer AI spend wall."

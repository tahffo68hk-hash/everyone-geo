# 统一 Node 24 会话环境（供 Git Bash 使用）。
# 用法: source scripts/node24-env.sh && pnpm <args>
export PATH="/d/tools/node24:$PATH"
export GEO_PNPM_CLI="D:/aconda/node_modules/pnpm/bin/pnpm.mjs"
function pnpm() {
  /d/tools/node24/node.exe "$GEO_PNPM_CLI" "$@"
}
if [ "$(node -v)" != "v24.20.0" ]; then echo "[node24-env] WARN: node -v = $(node -v), expected v24.20.0"; fi

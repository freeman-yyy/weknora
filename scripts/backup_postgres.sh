#!/usr/bin/env bash
# ============================================================================
# WeKnora PostgreSQL 备份脚本（pg_dump 逻辑备份，在线执行，无需停机）
#
# 部署位置（服务器）: /data/weknora/scripts/backup_postgres.sh
# 备份输出目录:       /data2/weknora/backups/postgres/（独立于部署盘，需确保 /data2 已挂载）
#
# 手动执行:
#   /data/weknora/scripts/backup_postgres.sh
#
# 可用环境变量覆盖默认配置:
#   WEKNORA_DIR=/data/weknora   部署目录（默认取脚本上级目录）
#   BACKUP_DIR=/data2/weknora/backups/postgres   备份输出目录
#   CONTAINER=WeKnora-postgres  数据库容器名
#   DUMP_DB_NAME=...            强制指定要备份的库名（默认取 .env 的 DB_NAME）
# ============================================================================

set -euo pipefail

# ---------------------------- 配置 ----------------------------
WEKNORA_DIR="${WEKNORA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/data2/weknora/backups/postgres}"
CONTAINER="${CONTAINER:-WeKnora-postgres}"
DUMP_DB_NAME="${DUMP_DB_NAME:-}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# ---------------------------- 前置检查 ----------------------------
command -v docker >/dev/null 2>&1 || die "docker 命令不可用"
[ -f "$WEKNORA_DIR/.env" ] || die "未找到 $WEKNORA_DIR/.env"
docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" \
  || die "容器 $CONTAINER 未在运行，请先 docker compose up -d"

# 从 .env 读取凭证（只取需要的键，不回显密码）
read_env_key() {
  grep -E "^$1=" "$WEKNORA_DIR/.env" | head -n1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}
DB_USER="$(read_env_key DB_USER)"
DB_NAME="$(read_env_key DB_NAME)"
DB_PASSWORD="$(read_env_key DB_PASSWORD)"
[ -n "$DB_USER" ] && [ -n "$DB_NAME" ] || die ".env 中缺少 DB_USER / DB_NAME"
[ -n "$DUMP_DB_NAME" ] && DB_NAME="$DUMP_DB_NAME"

mkdir -p "$BACKUP_DIR"

# 防止重复并发执行（Linux flock）
if command -v flock >/dev/null 2>&1; then
  exec 9>"$BACKUP_DIR/.backup.lock"
  flock -n 9 || die "已有备份任务在运行，本次跳过"
fi

# ---------------------------- 备份函数 ----------------------------
# 在容器内导出到 /tmp，再 docker cp 到宿主机，避免二进制流经管道时的潜在问题；
# 导出后立即用 pg_restore --list 校验归档完整性。
dump_one_db() {
  local db="$1"
  local in_container="/tmp/weknora-backup-${db}-${TIMESTAMP}.dump"
  local host_file="$BACKUP_DIR/${db}-${TIMESTAMP}.dump"

  log "开始备份数据库: ${db}"
  docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
    pg_dump -U "$DB_USER" -d "$db" --format=custom --file="$in_container" \
    || { log "ERROR: pg_dump ${db} 失败"; return 1; }

  docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
    pg_restore --list "$in_container" >/dev/null \
    || { log "ERROR: 备份归档校验失败 (${db})"; return 1; }

  docker cp "$CONTAINER:$in_container" "$host_file" || return 1
  docker exec "$CONTAINER" rm -f "$in_container"

  # sha256 校验文件
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$host_file" > "${host_file}.sha256"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$host_file" > "${host_file}.sha256"
  fi

  local size
  size="$(du -h "$host_file" | cut -f1)"
  [ -s "$host_file" ] || { log "ERROR: 备份文件为空: $host_file"; return 1; }
  log "完成: $host_file (${size})"
  return 0
}

# ---------------------------- 执行备份 ----------------------------
log "===== WeKnora PostgreSQL 备份开始 ====="
FAIL=0

dump_one_db "$DB_NAME" || FAIL=1

log "===== 备份结束 (结果: $([ "$FAIL" -eq 0 ] && echo 成功 || echo 失败)) ====="
log "恢复命令示例:"
log "  /data/weknora/scripts/restore_postgres.sh $BACKUP_DIR/${DB_NAME}-${TIMESTAMP}.dump"
exit "$FAIL"

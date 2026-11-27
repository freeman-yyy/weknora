#!/usr/bin/env bash
# ============================================================================
# WeKnora PostgreSQL 恢复脚本（pg_restore，恢复前自动停止 app 容器）
#
# 部署位置（服务器）: /data/weknora/scripts/restore_postgres.sh
#
# 用法:
#   /data/weknora/scripts/restore_postgres.sh /data2/weknora/backups/postgres/weknora-20260101-030000.dump  # 恢复主库
#   /data/weknora/scripts/restore_postgres.sh --yes /data2/weknora/backups/postgres/weknora-....dump        # 跳过交互确认
#
# 注意:
#   - 恢复使用 --clean --if-exists，会先删除目标库中的现有对象再导入，
#     即目标库数据会被覆盖。务必确认 dump 文件无误后再执行。
#   - 必须恢复到相同版本的 ParadeDB 镜像（paradedb/paradedb:v0.25.11-pg17），
#     否则 pg_search 扩展及 BM25 索引无法还原。
# ============================================================================

set -euo pipefail

WEKNORA_DIR="${WEKNORA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CONTAINER="${CONTAINER:-WeKnora-postgres}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# ---------------------------- 参数解析 ----------------------------
ASSUME_YES=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --yes|-y) ASSUME_YES=1 ;;
    *) ARGS+=("$a") ;;
  esac
done
[ ${#ARGS[@]} -ge 1 ] || die "用法: $0 [--yes] <dump文件路径> [目标库名]"

DUMP_FILE="${ARGS[0]}"
TARGET_DB="${ARGS[1]:-}"

[ -f "$DUMP_FILE" ] || die "备份文件不存在: $DUMP_FILE"
[ -f "$WEKNORA_DIR/.env" ] || die "未找到 $WEKNORA_DIR/.env"
command -v docker >/dev/null 2>&1 || die "docker 命令不可用"
docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" \
  || die "容器 $CONTAINER 未在运行，请先 docker compose up -d"

read_env_key() {
  grep -E "^$1=" "$WEKNORA_DIR/.env" | head -n1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}
DB_USER="$(read_env_key DB_USER)"
DB_NAME="$(read_env_key DB_NAME)"
DB_PASSWORD="$(read_env_key DB_PASSWORD)"
[ -n "$DB_USER" ] && [ -n "$DB_NAME" ] || die ".env 中缺少 DB_USER / DB_NAME"
[ -n "$TARGET_DB" ] || TARGET_DB="$DB_NAME"

# sha256 校验（若存在校验文件）
if [ -f "${DUMP_FILE}.sha256" ]; then
  log "校验 sha256 ..."
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$DUMP_FILE")" && sha256sum -c "$(basename "${DUMP_FILE}.sha256")") \
      || die "sha256 校验失败，备份文件可能损坏，已中止恢复"
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$(dirname "$DUMP_FILE")" && shasum -a 256 -c "$(basename "${DUMP_FILE}.sha256")") \
      || die "sha256 校验失败，备份文件可能损坏，已中止恢复"
  fi
fi

# ---------------------------- 预览备份内容 ----------------------------
docker cp "$DUMP_FILE" "$CONTAINER:/tmp/weknora-restore.dump"
log "备份归档内容预览（前 25 行）:"
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
  pg_restore --list /tmp/weknora-restore.dump 2>/dev/null | head -n 25 || true

# ---------------------------- 交互确认 ----------------------------
if [ "$ASSUME_YES" -ne 1 ]; then
  echo
  echo "⚠️  即将用以下备份覆盖数据库: ${TARGET_DB}"
  echo "    备份文件: $DUMP_FILE"
  echo "    现有数据将被清除后导入（--clean --if-exists）。"
  printf "    如确认请输入目标库名 [%s]: " "$TARGET_DB"
  read -r CONFIRM
  [ "$CONFIRM" = "$TARGET_DB" ] || die "输入不匹配，已中止恢复，未做任何改动"
fi

compose() { (cd "$WEKNORA_DIR" && docker compose "$@") 2>/dev/null || \
            (cd "$WEKNORA_DIR" && docker-compose "$@"); }

# ---------------------------- 停写 -> 恢复 -> 重启 ----------------------------
log "停止 app 容器以避免写入冲突..."
compose stop app || log "WARN: 停止 app 失败，请确认是否手动停止写入方"

log "开始恢复到 ${TARGET_DB} ..."
RC=0
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
  pg_restore -U "$DB_USER" -d "$TARGET_DB" --clean --if-exists \
  /tmp/weknora-restore.dump || RC=$?

docker exec "$CONTAINER" rm -f /tmp/weknora-restore.dump

log "重新启动 app 容器..."
compose start app || log "WARN: 启动 app 失败，请手动执行: docker compose start app"

if [ "$RC" -ne 0 ]; then
  die "pg_restore 返回码 $RC（导入过程中存在告警或错误，请核对上方输出；\
常见原因: 备份与恢复所用 ParadeDB 镜像版本不一致）"
fi

log "===== 恢复完成: $DUMP_FILE -> $TARGET_DB ====="

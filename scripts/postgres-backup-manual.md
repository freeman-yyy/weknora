# WeKnora PostgreSQL 数据库备份与恢复用户手册

> 适用环境：服务器容器化部署，部署目录 `/data/weknora`（内含 `.env` 与 `docker-compose.yml`）。
> 脚本清单：
>
> - `/data/weknora/scripts/backup_postgres.sh` — 手动备份脚本
> - `/data/weknora/scripts/restore_postgres.sh` — 恢复脚本
>
> 当前策略：**仅支持手工备份**；备份输出到独立数据盘 `/data2/weknora/backups/postgres/`；**旧备份不会自动清理**，磁盘空间需人工管理。

---

## 1. 备份机制概述

脚本采用 PostgreSQL 逻辑备份（`pg_dump` 自定义压缩格式 `-Fc`），**在线执行，无需停机、不中断业务**。

核心流程：

1. 从 `/data/weknora/.env` 读取数据库凭证（`DB_USER` / `DB_PASSWORD` / `DB_NAME`）；
2. 确认容器 `WeKnora-postgres` 正在运行；
3. 在容器内执行 `pg_dump`，先导出到容器 `/tmp`，再 `docker cp` 到宿主机，避免二进制流经管道被破坏；
4. 用 `pg_restore --list` 校验归档完整性，能成功列出目录才算有效备份；
5. 生成同名 `.sha256` 校验文件；
6. 全程 flock 互斥，防止两次手工执行重叠。

备份内容为 `.env` 中 `DB_NAME` 指定的 WeKnora 主库。**不含** langfuse 库（当前部署未启用该能力）。

---

## 2. 环境要求与首次部署检查

| 检查项 | 要求 | 验证命令 |
| --- | --- | --- |
| Docker | 已安装且 daemon 运行 | `docker info` |
| 数据库容器 | `WeKnora-postgres` 处于运行状态 | `docker ps \| grep WeKnora-postgres` |
| .env 文件 | `/data/weknora/.env` 存在，且含 `DB_USER`、`DB_PASSWORD`、`DB_NAME` | `grep -E '^DB_(USER\|NAME)' /data/weknora/.env` |
| 脚本就位 | 两个脚本位于 `/data/weknora/scripts/` 并有执行权限 | `ls -l /data/weknora/scripts/*.sh` |
| 备份盘 | `/data2` 已挂载且当前用户可写 | `touch /data2/weknora/backups/postgres/.wtest && rm -f /data2/weknora/backups/postgres/.wtest` |

> 若 `WeKnora-postgres` 容器名与实际部署不符（例如自行修改过 `docker-compose.yml`），执行时用 `CONTAINER=<实际容器名>` 覆盖，见第 5 节。

---

## 3. 执行备份

### 3.1 操作步骤

```bash
/data/weknora/scripts/backup_postgres.sh
```

### 3.2 正常输出示例

```
[2026-11-27 17:41:00] ===== WeKnora PostgreSQL 备份开始 =====
[2026-11-27 17:41:00] 开始备份数据库: weknora
[2026-11-27 17:41:12] 完成: /data2/weknora/backups/postgres/weknora-20261127-174100.dump (86M)
[2026-11-27 17:41:12] ===== 备份结束 (结果: 成功) =====
[2026-11-27 17:41:12] 恢复命令示例:
[2026-11-27 17:41:12]   /data/weknora/scripts/restore_postgres.sh /data2/weknora/backups/postgres/weknora-20261127-174100.dump
```

### 3.3 备份产物说明

每次备份在 `/data2/weknora/backups/postgres/` 生成两个文件：

| 文件 | 说明 |
| --- | --- |
| `weknora-YYYYMMDD-HHMMSS.dump` | PostgreSQL 自定义格式归档（压缩、二进制），用于恢复 |
| `weknora-YYYYMMDD-HHMMSS.dump.sha256` | sha256 校验文件，恢复脚本会自动校验，也可手工校验 |

手工校验完整性（在备份目录下执行）：

```bash
cd /data2/weknora/backups/postgres
sha256sum -c weknora-20261127-174100.dump.sha256
```

### 3.4 失败排查

脚本以非 0 退出码结束即表示备份失败，常见原因：

| 错误信息 | 原因 | 处理 |
| --- | --- | --- |
| `docker 命令不可用` | Docker 未安装或不在 PATH | 安装 Docker 或使用完整路径 |
| `容器 WeKnora-postgres 未在运行` | 数据库容器停止 | `cd /data/weknora && docker compose up -d` |
| `未找到 /data/weknora/.env` | 部署目录不对 | 确认脚本位置或用 `WEKNORA_DIR=` 指定 |
| `.env 中缺少 DB_USER / DB_NAME` | 环境文件不完整 | 补齐 `.env` 中对应键 |
| `ERROR: pg_dump xxx 失败` | 数据库连接/认证失败 | 检查 `.env` 凭证与数据库健康状态 |
| `ERROR: 备份归档校验失败` | 导出过程异常（磁盘满等） | 检查容器内 `/tmp` 空间与磁盘余量 |
| `已有备份任务在运行` | flock 检测到并发 | 等待上一次备份结束 |
| `ERROR: 备份文件为空` | 拷贝阶段异常 | 检查宿主机对 `/data2` 的写权限 |

---

## 4. 执行恢复

### 4.1 标准流程

```bash
/data/weknora/scripts/restore_postgres.sh /data2/weknora/backups/postgres/weknora-20261127-174100.dump
```

脚本执行过程：

1. 自动校验 `.sha256`（同目录存在校验文件时），失败则**立即中止**；
2. 将 dump 拷入容器，展示归档内容预览（前 25 行 TOC），供人工确认文件是否正确；
3. **交互确认**：屏幕会显示目标库名，要求手动输入该库名才会继续，输错即中止且不做任何改动；
4. 自动 `docker compose stop app` 停止写入方；
5. `pg_restore --clean --if-exists` 覆盖导入（先删目标库现有对象再导入，**目标库原数据被覆盖**）;
6. 自动重启 app 容器，并报告恢复结果。

### 4.2 免交互模式（仅建议在脚本化/演练场景使用）

```bash
/data/weknora/scripts/restore_postgres.sh --yes /data2/weknora/backups/postgres/weknora-20261127-174100.dump
```

### 4.3 pg_restore 返回码非 0

若脚本最后报 `pg_restore 返回码 N`，表示导入过程中存在错误。最常见原因是**备份与恢复两侧的 ParadeDB 镜像版本不一致**（`pg_search` 扩展缺失）。处理原则：

1. 核对当前镜像：`docker inspect WeKnora-postgres --format '{{.Config.Image}}'`，应为 `paradedb/paradedb:v0.25.11-pg17`（与备份时一致）；
2. 版本不一致时，先用备份时的版本恢复，再按官方升级文档做 ParadeDB 升级迁移，不要跨版本直接恢复。

---

## 5. 可配置项（环境变量覆盖）

两个脚本均支持同名环境变量覆盖默认值：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WEKNORA_DIR` | 脚本所在目录的上一级 | 部署目录（含 `.env`） |
| `BACKUP_DIR` | `/data2/weknora/backups/postgres` | 备份输出目录（仅备份脚本） |
| `CONTAINER` | `WeKnora-postgres` | 数据库容器名 |
| `DUMP_DB_NAME` | 取 `.env` 的 `DB_NAME` | 强制指定要备份的库名（仅备份脚本） |

示例：容器名不同时执行备份

```bash
CONTAINER=MyWeKnora-postgres /data/weknora/scripts/backup_postgres.sh
```

---

## 6. 备份文件管理

**脚本不做任何自动清理**，请遵循以下人工管理规范：

1. **磁盘监控**：备份文件随数据量增长，建议通过监控或定期巡检确认 `/data2` 剩余空间不低于"最近一次备份体积 × 保留份数 × 1.5"；
2. **保留策略**：建议至少保留最近 2 周的每日备份 + 1 份月度备份；删除旧备份时连同同名 `.sha256` 一起删除；
3. **异机存放**：备份盘与数据库在同一台机器上，无法抵御整机故障。建议定期（如每日）将最新备份 rsync 至另一台机器或对象存储：
   ```bash
   rsync -av --progress /data2/weknora/backups/postgres/ backup-server:/backup/weknora/postgres/
   ```
4. **恢复演练**：备份的可用性只有恢复成功才能证明。建议每季度至少在测试环境完成一次完整恢复演练（见第 8 节）。

---

## 7. 迁移到新服务器的完整步骤

1. 新服务器安装 Docker，并确保其 ParadeDB 镜像版本与备份时一致（`paradedb/paradedb:v0.25.11-pg17`）；
2. 迁移 `/data/weknora` 全目录（含 `.env`、`docker-compose.yml`、`scripts/`）；
3. 将最新的 `.dump` 文件复制到新机 `/data2/weknora/backups/postgres/`；
4. 仅启动数据库：`cd /data/weknora && docker compose up -d postgres`，等待健康检查通过（`docker ps` 显示 healthy）；
5. 执行恢复脚本（目标库名默认取 `.env` 的 `DB_NAME`，与全新初始化出的空库同名，直接覆盖导入即可）；
6. 启动全部服务：`docker compose up -d`，用前端登录验证数据完整性；
7. 验证通过后再恢复文档文件卷（见第 8 节第 1 条）。

---

## 8. 数据库之外：完整灾备清单

PostgreSQL 备份**不覆盖**以下内容，完整灾备需另行处理：

1. **文档原文件**：存于数据卷 `weknora_data-files`（若用 MinIO/S3 则在对应存储中）。卷名用 `docker volume ls | grep data-files` 确认，可用第 9 节的 tar 方式打包；
2. **`SYSTEM_AES_KEY`**：位于 `/data/weknora/.env`。库内加密存储的模型 API Key 等字段依赖该密钥解密——**丢失即永久无法解密**，`.env` 务必纳入安全备份（注意其含敏感凭证，控制存放权限）；
3. **Redis 队列**（`WeKnora-redis`）：仅存异步任务队列，不做持久化备份，丢失影响是未完成的解析任务需重试，一般可接受。

---

## 9. 附录：物理备份（可选，用于整机迁移）

日常备份使用本手册第 3 节的脚本即可；如需页级完整快照（含 WAL 位置），可停机后打包数据卷：

```bash
cd /data/weknora
docker compose stop app && docker compose stop postgres

# 实际卷名以 docker volume ls | grep postgres 输出为准（默认 weknora_postgres-data）
docker run --rm -v weknora_postgres-data:/data -v /data2/weknora/backups:/backup \
  busybox tar czf /backup/postgres-data-$(date +%Y%m%d).tar.gz -C /data .

docker compose start postgres && docker compose start app
```

恢复时反向操作：停栈 → 清空卷 → 解包回卷 → `docker compose up -d`。

---

## 10. 快速命令速查

```bash
# 备份
/data/weknora/scripts/backup_postgres.sh

# 恢复（交互确认）
/data/weknora/scripts/restore_postgres.sh /data2/weknora/backups/postgres/<dump文件>

# 恢复（免交互）
/data/weknora/scripts/restore_postgres.sh --yes /data2/weknora/backups/postgres/<dump文件>

# 校验备份文件
cd /data2/weknora/backups/postgres && sha256sum -c <dump文件>.sha256

# 查看备份目录占用
du -sh /data2/weknora/backups/postgres/
```

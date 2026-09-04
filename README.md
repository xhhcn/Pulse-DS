# Pulse-DS

Pulse 的独立服务器（Dedicated Server）发行版。  
保留 Pulse 后端与数据兼容，增加整机硬件采集与健康判定，界面按运维习惯克制呈现。

## 核心说明

- 独立仓库：`xhhcn/Pulse-DS`
- Docker 镜像：`xhh1128/pulse-ds`
- 数据兼容：可直接复用原有 `metrics.db`
- 客户端：使用本仓库的客户端（带硬件采集），支持 Linux / macOS / Windows；原 Pulse 客户端可接入，但没有硬件信息
- 与 Pulse 共存：默认端口 `8018`、目录 `/opt/pulse-ds`、服务 `pulse-ds-server` / `pulse-ds-client`，与 Pulse 的 `8008` / `/opt/pulse` / `pulse-server` 互不影响，可同机并存

## 采集内容

- 处理器、内存（每根 DIMM、ECC）、磁盘（SMART、温度、寿命、坏扇区）、文件系统、RAID、网卡链路、GPU、传感器、BMC/IPMI、主板与 BIOS
- 服务端按规则给出 正常 / 注意 / 严重 及具体问题：SMART 失败、RAID 降级、ECC 不可纠正错误、链路断开、风扇停转、电源故障、过温、待重启等
- 公开页面自动脱敏：序列号、内核、BIOS、主板、内存条型号仅管理员可见

## 快速安装（服务端）

### 方式 1：一键安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/xhhcn/Pulse-DS/main/install-pulse-ds-server.sh | sudo bash
```

安装完成后访问：

```text
http://YOUR_IP:8018
```

### 方式 2：Docker Compose

```bash
mkdir pulse && cd pulse
curl -sSL https://raw.githubusercontent.com/xhhcn/Pulse-DS/main/docker-compose.yaml -o docker-compose.yaml
docker compose up -d
```

## 从 Pulse 迁移到 Pulse-DS

Pulse-DS 安装在独立的目录与服务名下，不会触碰原有的 Pulse。先按上面安装 Pulse-DS，再把旧数据热迁移过来（旧端可以在同一台机器上）：

```bash
sudo pulse-ds-migrate --from http://127.0.0.1:8008
```

迁移完成后停掉旧的 Pulse，并用下面的命令重装客户端，硬件信息才会出现。

**更新 Pulse-DS**（`amd64` 换成 `arm64` 即为 ARM 版本）：

```bash
sudo systemctl stop pulse-ds-server
sudo wget https://github.com/xhhcn/Pulse-DS/releases/latest/download/pulse-server-standalone-linux-amd64 -O /opt/pulse-ds/pulse-ds-server
sudo chmod +x /opt/pulse-ds/pulse-ds-server
sudo systemctl start pulse-ds-server
```

## 客户端安装

先在 `/admin` 添加系统，得到 ID 与 Secret；管理页的复制按钮会直接给出完整命令。

Linux / macOS：

```bash
curl -sSL https://raw.githubusercontent.com/xhhcn/Pulse-DS/main/client/install.sh | sudo bash -s -- \
  --id <ID> --server <SERVER_URL> --secret <SECRET>
```

Windows（管理员 PowerShell）：

```powershell
powershell -ExecutionPolicy Bypass -Command "& { $env:AgentId='<ID>'; $env:ServerBase='<SERVER_URL>'; $env:Secret='<SECRET>'; irm https://raw.githubusercontent.com/xhhcn/Pulse-DS/main/client/install.ps1 | iex }"
```

客户端默认只推送、不监听端口。可选工具：`smartmontools`（SMART，Linux / macOS）、`ipmitool`（BMC 传感器，Linux）、`nvidia-smi`（NVIDIA GPU）；缺失时对应项留空。

## 升级

- Docker：拉取新镜像后重建容器
- 二进制：下载最新 `pulse-server-standalone-*` 覆盖 `/opt/pulse-ds/pulse-ds-server`
- 客户端：默认每日自动更新

## 卸载

### 服务端（仅删除程序，保留数据）

```bash
sudo systemctl stop pulse-ds-server && sudo systemctl disable pulse-ds-server && \
sudo rm -f /usr/local/bin/pulse-ds-migrate /usr/local/bin/pulse-ds-backup /usr/local/bin/pulse-ds-restore && \
sudo rm -f /opt/pulse-ds/pulse-ds-server /etc/systemd/system/pulse-ds-server.service && \
sudo rm -rf /opt/pulse-ds/scripts && \
sudo systemctl daemon-reload
```

### 完全卸载服务端（删除全部数据，不可恢复）

```bash
sudo systemctl stop pulse-ds-server && sudo systemctl disable pulse-ds-server && \
sudo rm -f /usr/local/bin/pulse-ds-migrate /usr/local/bin/pulse-ds-backup /usr/local/bin/pulse-ds-restore && \
sudo rm -f /etc/systemd/system/pulse-ds-server.service && \
sudo rm -rf /opt/pulse-ds && \
sudo systemctl daemon-reload
```

### 卸载客户端

客户端默认带每日自动更新，下面的命令会连同更新任务一起清理；未启用自动更新时也可安全执行。

Linux（systemd）：

```bash
sudo systemctl stop pulse-ds-client pulse-ds-client-update.timer 2>/dev/null; \
sudo systemctl disable pulse-ds-client pulse-ds-client-update.timer 2>/dev/null; \
sudo rm -f /opt/pulse-ds/probe-client /opt/pulse-ds/update.sh \
  /etc/systemd/system/pulse-ds-client.service \
  /etc/systemd/system/pulse-ds-client-update.service \
  /etc/systemd/system/pulse-ds-client-update.timer && \
sudo systemctl daemon-reload
```

macOS（launchd）：

```bash
sudo launchctl bootout system/com.pulse-ds.client 2>/dev/null; \
sudo launchctl bootout system/com.pulse-ds.client.update 2>/dev/null; \
sudo rm -rf /opt/pulse-ds /Library/LaunchDaemons/com.pulse-ds.client.plist \
  /Library/LaunchDaemons/com.pulse-ds.client.update.plist /var/log/pulse-ds-client*.log
```

Windows（管理员 PowerShell）：

```powershell
Stop-ScheduledTask -TaskName 'PulseDSClient' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'PulseDSClient' -Confirm:$false -ErrorAction SilentlyContinue; Remove-NetFirewallRule -DisplayName 'Pulse-DS Monitoring Client*' -ErrorAction SilentlyContinue; Remove-Item -Path "$env:ProgramFiles\Pulse-DS" -Recurse -Force -ErrorAction SilentlyContinue
```

> Linux 上只删除客户端相关文件，保留 `/opt/pulse-ds` 目录，因为同一台机器可能同时装了服务端。

## 生产部署建议

- **HTTPS**：客户端上报的硬件清单、Secret 与管理员登录都走这条链路。在 `pulse-ds-server.service` 中设置 `TLS_CERT` / `TLS_KEY` 直接提供 HTTPS，或在反向代理终止 TLS。
- **公开面板**：公开视图已脱敏；若面板对外可见，建议同时开启隐私模式隐藏 IP 与地理位置。
- **备份即密钥**：`metrics.db` 含管理员密码哈希与所有 Secret，按生产数据库对待；`pulse-ds-backup` / `pulse-ds-migrate` 可热备份与迁移。
- **反向代理 / CDN**：设置 `TRUSTED_PROXIES`（逗号分隔的 IP 或 CIDR），否则登录限流与 SSE 上限按代理 IP 计数。
- **Docker**：`docker-compose.yaml` 已设置 45 秒优雅停止，请勿缩短。

## 发布页

- Releases: [https://github.com/xhhcn/Pulse-DS/releases](https://github.com/xhhcn/Pulse-DS/releases)
- Docker Hub: [https://hub.docker.com/r/xhh1128/pulse-ds](https://hub.docker.com/r/xhh1128/pulse-ds)

---

Sponsored by [DokiDoki CDN](https://www.dooki.cloud)

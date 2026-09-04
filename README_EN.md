# Pulse-DS

The dedicated-server edition of Pulse.  
Keeps the Pulse backend and data format, adds full hardware collection with health evaluation, and presents it the way operators expect.

## In short

- Repository: `xhhcn/Pulse-DS`
- Docker image: `xhh1128/pulse-ds`
- Data: an existing `metrics.db` works unchanged
- Client: use the client from this repository (it collects hardware) on Linux / macOS / Windows; an upstream Pulse client still connects, but reports no hardware
- Coexists with Pulse: defaults are port `8018`, `/opt/pulse-ds` and the services `pulse-ds-server` / `pulse-ds-client`, so nothing overlaps with Pulse's `8008` / `/opt/pulse` / `pulse-server` on the same host

## What is collected

- Processor, memory (per DIMM, ECC), disks (SMART, temperature, life, bad sectors), filesystems, RAID, NIC links, GPUs, sensors, BMC/IPMI, board and BIOS
- The server classifies each host as OK / Warning / Critical with concrete issues: SMART failure, degraded RAID, uncorrectable ECC errors, link down, stopped fans, PSU failure, overheating, pending reboot and more
- The public view is masked automatically: serials, kernel, BIOS, board and DIMM part numbers are admin-only

## Quick install (server)

### Option 1: one-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/xhhcn/Pulse-DS/main/install-pulse-ds-server.sh | sudo bash
```

Then open:

```text
http://YOUR_IP:8018
```

### Option 2: Docker Compose

```bash
mkdir pulse && cd pulse
curl -sSL https://raw.githubusercontent.com/xhhcn/Pulse-DS/main/docker-compose.yaml -o docker-compose.yaml
docker compose up -d
```

## Migrating from Pulse

Pulse-DS installs under its own directory and service names and never touches an existing Pulse. Install Pulse-DS as above, then migrate the old data live (the old server may be on the same host):

```bash
sudo pulse-ds-migrate --from http://127.0.0.1:8008
```

Stop the old Pulse afterwards and reinstall the clients with the commands below to get hardware data.

**Updating Pulse-DS** (use `arm64` instead of `amd64` on ARM):

```bash
sudo systemctl stop pulse-ds-server
sudo wget https://github.com/xhhcn/Pulse-DS/releases/latest/download/pulse-server-standalone-linux-amd64 -O /opt/pulse-ds/pulse-ds-server
sudo chmod +x /opt/pulse-ds/pulse-ds-server
sudo systemctl start pulse-ds-server
```

## Client install

Add the system in `/admin` first to get its ID and secret; the copy button in the admin page gives the complete command.

Linux / macOS:

```bash
curl -sSL https://raw.githubusercontent.com/xhhcn/Pulse-DS/main/client/install.sh | sudo bash -s -- \
  --id <ID> --server <SERVER_URL> --secret <SECRET>
```

Windows (PowerShell as Administrator):

```powershell
powershell -ExecutionPolicy Bypass -Command "& { $env:AgentId='<ID>'; $env:ServerBase='<SERVER_URL>'; $env:Secret='<SECRET>'; irm https://raw.githubusercontent.com/xhhcn/Pulse-DS/main/client/install.ps1 | iex }"
```

The client is push-only and opens no port by default. Optional tools: `smartmontools` (SMART on Linux / macOS), `ipmitool` (BMC sensors on Linux), `nvidia-smi` (NVIDIA GPUs); missing tools leave their fields empty.

## Upgrading

- Docker: pull the new image and recreate the container
- Binary: download the latest `pulse-server-standalone-*` over `/opt/pulse-ds/pulse-ds-server`
- Clients: self-update daily by default

## Uninstall

### Server, program only (keeps the data)

```bash
sudo systemctl stop pulse-ds-server && sudo systemctl disable pulse-ds-server && \
sudo rm -f /usr/local/bin/pulse-ds-migrate /usr/local/bin/pulse-ds-backup /usr/local/bin/pulse-ds-restore && \
sudo rm -f /opt/pulse-ds/pulse-ds-server /etc/systemd/system/pulse-ds-server.service && \
sudo rm -rf /opt/pulse-ds/scripts && \
sudo systemctl daemon-reload
```

### Server, everything (deletes all data, irreversible)

```bash
sudo systemctl stop pulse-ds-server && sudo systemctl disable pulse-ds-server && \
sudo rm -f /usr/local/bin/pulse-ds-migrate /usr/local/bin/pulse-ds-backup /usr/local/bin/pulse-ds-restore && \
sudo rm -f /etc/systemd/system/pulse-ds-server.service && \
sudo rm -rf /opt/pulse-ds && \
sudo systemctl daemon-reload
```

### Client

Clients self-update daily by default; these commands remove the update job as well and are safe to run even if it was disabled.

Linux (systemd):

```bash
sudo systemctl stop pulse-ds-client pulse-ds-client-update.timer 2>/dev/null; \
sudo systemctl disable pulse-ds-client pulse-ds-client-update.timer 2>/dev/null; \
sudo rm -f /opt/pulse-ds/probe-client /opt/pulse-ds/update.sh \
  /etc/systemd/system/pulse-ds-client.service \
  /etc/systemd/system/pulse-ds-client-update.service \
  /etc/systemd/system/pulse-ds-client-update.timer && \
sudo systemctl daemon-reload
```

macOS (launchd):

```bash
sudo launchctl bootout system/com.pulse-ds.client 2>/dev/null; \
sudo launchctl bootout system/com.pulse-ds.client.update 2>/dev/null; \
sudo rm -rf /opt/pulse-ds /Library/LaunchDaemons/com.pulse-ds.client.plist \
  /Library/LaunchDaemons/com.pulse-ds.client.update.plist /var/log/pulse-ds-client*.log
```

Windows (PowerShell as Administrator):

```powershell
Stop-ScheduledTask -TaskName 'PulseDSClient' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'PulseDSClient' -Confirm:$false -ErrorAction SilentlyContinue; Remove-NetFirewallRule -DisplayName 'Pulse-DS Monitoring Client*' -ErrorAction SilentlyContinue; Remove-Item -Path "$env:ProgramFiles\Pulse-DS" -Recurse -Force -ErrorAction SilentlyContinue
```

> On Linux only the client files are removed and `/opt/pulse-ds` is kept, because the same machine may also run the server.

## Production notes

- **HTTPS**: hardware inventories, secrets and admin logins all travel over this link. Set `TLS_CERT` / `TLS_KEY` in `pulse-ds-server.service` to serve HTTPS directly, or terminate TLS at a reverse proxy.
- **Public dashboards**: the public view is masked; if the dashboard is reachable by anyone, also enable privacy mode to hide IPs and locations.
- **A backup is a key ring**: `metrics.db` holds the admin password hash and every secret. Treat it as the production database; `pulse-ds-backup` / `pulse-ds-migrate` take hot backups and migrate.
- **Reverse proxy / CDN**: set `TRUSTED_PROXIES` (comma-separated IPs or CIDRs), otherwise login rate limits and SSE caps count per proxy address.
- **Docker**: `docker-compose.yaml` sets a 45 s graceful stop; do not shorten it.

## Releases

- Releases: [https://github.com/xhhcn/Pulse-DS/releases](https://github.com/xhhcn/Pulse-DS/releases)
- Docker Hub: [https://hub.docker.com/r/xhh1128/pulse-ds](https://hub.docker.com/r/xhh1128/pulse-ds)

---

Sponsored by [DokiDoki CDN](https://www.dooki.cloud)

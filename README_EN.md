# Pulse-DS

The dedicated-server edition of Pulse.  
Keeps the Pulse backend and data format, adds full hardware collection with health evaluation, and presents it the way operators expect.

## In short

- Repository: `xhhcn/Pulse-DS`
- Docker image: `xhh1128/pulse-ds`
- Data: an existing `metrics.db` works unchanged
- Client: use the client from this repository (it collects hardware) on Linux / macOS / Windows; an upstream Pulse client still connects, but reports no hardware

## What is collected

- Processor, memory (per DIMM, ECC), disks (SMART, temperature, life, bad sectors), filesystems, RAID, NIC links, GPUs, sensors, BMC/IPMI, board and BIOS
- The server classifies each host as OK / Warning / Critical with concrete issues: SMART failure, degraded RAID, uncorrectable ECC errors, link down, stopped fans, PSU failure, overheating, pending reboot and more
- The public view is masked automatically: serials, kernel, BIOS, board and DIMM part numbers are admin-only

## Quick install (server)

### Option 1: one-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/xhhcn/Pulse-DS/main/install-pulse-server.sh | sudo bash
```

Then open:

```text
http://YOUR_IP:8008
```

### Option 2: Docker Compose

```bash
mkdir pulse && cd pulse
curl -sSL https://raw.githubusercontent.com/xhhcn/Pulse-DS/main/docker-compose.yaml -o docker-compose.yaml
docker compose up -d
```

## Switching from Pulse without losing data

Replace only the server binary and keep the data directory (use `arm64` instead of `amd64` on ARM):

```bash
sudo systemctl stop pulse-server
sudo wget https://github.com/xhhcn/Pulse-DS/releases/latest/download/pulse-server-standalone-linux-amd64 -O /opt/pulse/pulse-server
sudo chmod +x /opt/pulse/pulse-server
sudo systemctl start pulse-server
```

> This does not touch `/opt/pulse/data/metrics.db`. Reinstall the clients with the commands below to get hardware data.

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
- Binary: download the latest `pulse-server-standalone-*` over `/opt/pulse/pulse-server`
- Clients: self-update daily by default

## Uninstall

### Program only (keeps the data)

```bash
sudo systemctl stop pulse-server && sudo systemctl disable pulse-server && \
sudo rm -f /usr/local/bin/pulse-migrate /usr/local/bin/pulse-backup /usr/local/bin/pulse-restore && \
sudo rm -f /opt/pulse/pulse-server /etc/systemd/system/pulse-server.service && \
sudo rm -rf /opt/pulse/scripts && \
sudo systemctl daemon-reload
```

### Everything (deletes all data, irreversible)

```bash
sudo systemctl stop pulse-server && sudo systemctl disable pulse-server && \
sudo rm -f /usr/local/bin/pulse-migrate /usr/local/bin/pulse-backup /usr/local/bin/pulse-restore && \
sudo rm -f /etc/systemd/system/pulse-server.service && \
sudo rm -rf /opt/pulse && \
sudo systemctl daemon-reload
```

## Production notes

- **HTTPS**: hardware inventories, secrets and admin logins all travel over this link. Set `TLS_CERT` / `TLS_KEY` in `pulse-server.service` to serve HTTPS directly, or terminate TLS at a reverse proxy.
- **Public dashboards**: the public view is masked; if the dashboard is reachable by anyone, also enable privacy mode to hide IPs and locations.
- **A backup is a key ring**: `metrics.db` holds the admin password hash and every secret. Treat it as the production database; `pulse-backup` / `pulse-migrate` take hot backups and migrate.
- **Reverse proxy / CDN**: set `TRUSTED_PROXIES` (comma-separated IPs or CIDRs), otherwise login rate limits and SSE caps count per proxy address.
- **Docker**: `docker-compose.yaml` sets a 45 s graceful stop; do not shorten it.

## Releases

- Releases: [https://github.com/xhhcn/Pulse-DS/releases](https://github.com/xhhcn/Pulse-DS/releases)
- Docker Hub: [https://hub.docker.com/r/xhh1128/pulse-ds](https://hub.docker.com/r/xhh1128/pulse-ds)

---

Sponsored by [DokiDoki CDN](https://www.dooki.cloud)

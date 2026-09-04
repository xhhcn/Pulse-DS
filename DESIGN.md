# Pulse-DS 设计说明（面向独立服务器 / Dedicated Server 的 Pulse 衍生版）

> 目标：在完全兼容 Pulse 现有协议与数据库的前提下，为独立服务器补齐"硬件健康"这一层。
> VPS 只关心 CPU / 内存 / 磁盘占用与网络吞吐；独立服务器还要回答"这台机器的硬件是不是快坏了"。

## 1. 独立服务器需要哪些信息

按"出了问题会造成宕机或数据丢失"的优先级排序：

| 优先级 | 类别 | 具体指标 | 来源（Linux） |
|---|---|---|---|
| P0 | 磁盘健康 | 每块盘的 S.M.A.R.T. 整体判定、温度、通电小时、重映射/待映射扇区、NVMe 磨损百分比与可用备件、介质错误 | `smartctl -j`（需 root，可选安装） |
| P0 | 阵列状态 | mdadm 软阵列：级别、是否降级、成员数 / 活跃数、重建进度；ZFS 池：状态、错误计数 | `/proc/mdstat`，`zpool status` |
| P0 | 内存 ECC | 可纠正 / 不可纠正错误计数（不可纠正 >0 即为严重） | `/sys/devices/system/edac/mc/*/ce_count` `ue_count` |
| P1 | 内存条 | 每根内存的插槽、容量、类型（DDR4/5）、标称与实际频率、品牌、型号、是否 ECC | SMBIOS type 17：`/sys/firmware/dmi/entries/17-*/raw`（无需 dmidecode） |
| P1 | SSD 寿命 | SATA SSD 剩余寿命（各厂商 SMART 属性按名称识别）、NVMe 累计写入量 | `smartctl -j -A` |
| P2 | 整机标识 | 厂商、产品、主板型号、BIOS 版本与日期；CPU 最高频率与 L3 缓存 | `/sys/class/dmi/id/*`（无 SMBIOS 的设备树平台如树莓派改读 `/proc/device-tree/model`）；整机序列号 `product_serial` / `serial-number`（仅管理员可见），`/sys/devices/system/cpu/cpu0/{cpufreq,cache}` |
| P1 | 温度与风扇 | CPU 各插槽/核心温度、主板、NVMe 温度、风扇转速 | `/sys/class/hwmon`，`/sys/class/thermal`，NVMe 由 smartctl 给出 |
| P1 | BMC 传感器（可选） | 服务器的风扇、电源状态、主板电压、功率——这些只在 BMC 里 | 装有 `ipmitool` 且内核暴露 `/dev/ipmi0` 时每 5 分钟读一次 `ipmitool -c sdr elist`；没装就没有这一段；CSV 里模拟量四列（名称、数值、单位、状态）、离散量五列，`ns` 行跳过。已在 Supermicro X11SSL-F 上实测：8 路温度、4 路风扇、10 路电压 |
| P1 | 显示适配器 / GPU | 所有 PCI 显示控制器的名称（含主板 BMC 自带的 VGA，用来明确"这台没有 GPU"）；NVIDIA / AMD 计算卡的占用、显存、温度 | `/sys/bus/pci/devices/*/class` + `pci.ids`；`nvidia-smi`；amdgpu 的 sysfs 计数器 |
| P1 | 多盘容量与 IO | 每个挂载点的容量（独立服务器常有多块盘、多个分区），每块盘的读写吞吐、IOPS、繁忙度 | `/proc/mounts` + statfs，`/proc/diskstats` |
| P1 | 网卡链路 | 每个网卡的协商速率、双工、链路状态、错误与丢包计数、多网卡各自的实时速率 | `/sys/class/net/*/{speed,duplex,operstate,statistics}` |
| P1 | CPU 拓扑与负载 | 插槽 / 核心 / 线程数、当前频率、1/5/15 分钟负载与核心数的比值、降频 | `lscpu` 等价的 `/sys/devices/system/cpu`，`/proc/loadavg`，`/proc/cpuinfo` |
| P2 | BMC 事件 | SEL 事件日志（传感器读数已在 P1 的 BMC 行里） | `ipmitool sel`（未做） |
| P2 | GPU | 利用率、显存、温度（GPU 服务器） | `nvidia-smi --query-gpu`（可选） |
| P2 | 系统 | 内核版本、是否需要重启、最近一次启动原因 | `/proc/version`，`/var/run/reboot-required` |

原则：**没有权限或没有工具时静默降级**，每一项都是可选字段；探针永远不能因为某个采集失败而停止上报基础指标。

## 2. 后端设计

### 2.1 协议：向后兼容的扩展

- 推送载荷（`POST /api/clients/push`）新增一个可选对象 `hardware`。旧探针不发这个字段，服务端行为与 Pulse 完全一致。
- `hardware` 是"最新快照"：探针每 60 秒采集一次，只在**新快照尚未被服务端确认**时随 3 秒推送携带一次；推送省略该字段时服务端保留上一份（`applyHardware`）。这样 3 秒推送保持在 1 KB 左右，硬件对象（约 4 KB）每分钟只走一趟。
- 服务端在 `SystemMetric` 上新增：
  - `hardware *HardwareInfo`（持久化，随记录一起存储，几 KB 量级）
  - `health string`：`ok` / `warn` / `critical` / `unknown`，由服务端根据阈值统一判定，前端不各自计算
  - `health_issues []string`：人类可读的问题列表（"sda: SMART 判定 FAILED"、"md0 降级 (1/2)"、"ECC 不可纠正错误 3"）
- 判定规则集中在 `server/health.go`，阈值先用常量，后续再做管理页可配置：
  - critical：SMART 整体失败；阵列降级或故障；ECC 不可纠正 > 0；任一挂载点使用率 ≥ 95%；NVMe 可用备件低于阈值
  - warn：CPU/NVMe 温度 ≥ 85℃；重映射扇区 > 0；ECC 可纠正错误持续增长；挂载点 ≥ 90%；网卡错误/丢包持续增长；负载 > 核心数 × 2；链路速率低于网卡标称（如千兆网卡协商到 100M）；链路 down 只对**管理状态为 up**（IFF_UP，探针上报 `admin_state`）却没有载波的网口告警——这是 Zabbix / LibreNMS 的通行做法；未启用的空余网口（admin down）不算，硬件页显示为「未启用」。旧探针没有 `admin_state` 时退回"该网口是否曾收发过流量"的判断
- 快照与 SSE 广播沿用现有 `buildMetricsSnapshot`，公开视图不需要额外脱敏（序列号除外：`serial` 只在管理员视图返回）。

### 2.2 历史数据

第一版只保存最新硬件快照。温度 / IO 曲线是第二阶段：复用 TCPing 历史的键设计（时间前缀 + 客户端 + 指标名），保留 24 小时，按小时清理。

### 2.3 客户端（探针）

- 新文件 `client/hardware_linux.go`（`//go:build linux`），`client/hardware_other.go` 提供空实现，其它平台不受影响。
- 一个 `collectHardware()` 每 60 秒在后台跑一次，结果放在带锁的缓存里；`collectSystemMetrics()` 只读缓存，且只在快照未被服务端确认过时塞进 `Hardware` 字段（推送 200 后 `markHardwarePushed`）。
- 外部命令（smartctl、lsblk、zpool、nvidia-smi）一律带超时（8 秒），不存在就跳过；解析失败只丢弃该项。S.M.A.R.T. 结果按盘缓存 5 分钟（`smartInterval`），IO 速率仍每周期由 /proc/diskstats 计算——多盘机器上 smartctl 是探针唯一算得上"重"的操作。
- 需要 root 的项（S.M.A.R.T.）在安装脚本默认以 root 运行的前提下可用，非 root 时静默降级。

## 3. 前端设计（2026-09-04 重做）

前端整体重写为「列表 + 弹窗」结构，不再使用行内展开：

1. **顶栏**：站点名 / 图标（管理端可配）、实时连接指示（SSE 状态）、语言、主题、管理入口。
2. **概览卡片**：服务器总数（独服 / VPS）、在线、离线、硬件告警（严重 / 注意）；点击即筛选列表。可在设置中关闭（`hide_cards`）。
3. **服务器列表**：桌面为表格（服务器 / 健康 / 运行 / 位置 / CPU / 内存 / 磁盘 / 网络 / 系统），窄屏自动折成卡片，不再横向滚动。列表只放名称，标签（含 `traffic:*` / `speed:*` 实时值与 `spr:/spy:/spb:` 渐变标签）统一显示在详情弹窗头部。支持搜索、多字段排序、状态筛选；每 3 秒的 SSE 快照只做原地补丁，进度条平滑过渡。
4. **详情弹窗**（点击行打开，`#server/<id>` 可直达、可前后切换、Esc 关闭）：
   - 概览：问题列表；三张等高指标卡，每张两行短文本、不做省略号截断（CPU：型号 + 「4 核 · 8 线程 · 3.50 GHz」；内存：用量 + 「3 × DDR4-2133 · ECC」，频率取内存条实际运行值；磁盘：用量 + 「1 × SSD · 1.9 TB · S.M.A.R.T. 正常」）；下方网络卡（下行 / 上行 / 延迟 / 网卡，另有累计流量、IP 时追加）与系统卡（系统 / 位置 / 整机 / 主板）同为键值行、行数相当。最高频率、L3、当前频率、负载、ECC 错误、BIOS、内核、探针版本、内存品牌与标称频率都只在硬件页里出现，概览不重复。
   - 硬件页按清单顺序分区：处理器（型号 / 拓扑 / 基准、最高、当前频率 / 三级缓存 / 负载）、内存（总量与条数 / ECC / 错误计数，下接内存条表）、磁盘、文件系统、RAID / ZFS、网卡、GPU（只列有计数器的计算卡）、传感器、系统（整机 / 主板 / BIOS 或固件 / 图形 / 内核 / 探针 / 采集时间）。「图形」一行只列 PCI 显示控制器名称，服务器主板的 BMC 显卡标注「板载」，不写解释性文字；频率统一用 GHz、通电时间按语言用「年 / 天 / 小时」。时间一律 24 小时制、日期用 ISO 顺序（2026-09-04 13:55:42），列表里的运行时长按语言显示（212 天 / 212d）；三个键值区块共用固定的标签列宽以便对齐；未知的坏扇区显示「—」而不是 0；未启用的网口不显示速率与计数。没有任何一块盘上报 S.M.A.R.T. 明细（温度 / 通电 / 寿命 / 坏扇区）时，磁盘表整体去掉这四列并在表下提示需要 smartmontools；内存条表在没有频率或料号时去掉对应列；Apple 芯片的统一内存与其他主机用同一张内存条表，插槽列写「统一内存」；macOS 不暴露统一内存的频率，探针按芯片型号填入 Apple 公布的规格值（M1 4266、M1 Pro/Max 与 M2/M3 系列 6400、M4 7500、M4 Pro/Max 8533 MT/s）并以 `speed_nominal` 标记，页面显示为「4266 MT/s（规格值）」。磁盘表的「剩余寿命」列只放百分比，累计写入量和（低于 100% 时的）备用块放在第二行小字里，列宽不再被撑开。「读 / 写」列把 MB/s 与 IOPS 放在上下两行，繁忙条收窄到 56 px，整表在 1000 px 宽的弹窗里不再横向溢出（浏览器检查覆盖三台真实主机）。探针在 macOS 上会到 Homebrew 目录（/opt/homebrew、/usr/local）里找 smartctl 等可选工具，sudo 环境下也能用。
   - 硬件：概要、磁盘（S.M.A.R.T.、温度、通电、剩余寿命、坏扇区、IO）、内存条、文件系统、RAID / ZFS、温度与风扇、网卡、GPU；仅在快照签名变化时重绘。无硬件数据的探针不显示该页。
   - TCPing：历史存在服务端 bbolt（24 小时），浏览器打开标签页时从 `/api/tcping/history` 拉取，之后有新样本再拉。前端先把同一探测周期内各目标的样本（时间戳只差几十毫秒）合并成一个 x 值（容差为间隔的 1/3，2–10 秒），所有目标共用一条时间轴。图表是手写的 SVG（`scripts/dashboard/tcping.ts`，不再依赖 Chart.js）：折线为 1.5 px 的 `<path>`，丢包处断开、孤立样本画点；y 轴取 0–max 的整数刻度（≤ 5 个），x 轴按本地时间的整分/整点落刻度；颜色全部来自主题变量，切换主题无需重绘。SVG 由浏览器按屏幕原生分辩率光栅化，与页面文字同样清晰，不存在 canvas 位图缩放、像素比、合成层导致的发糊。悬停 / 触摸时按 x 找最近的周期，显示十字线、各目标的空心点和 DOM 提示框（每目标一行，超时标黄）。标题标注实际覆盖时长；每个目标一张小卡（当前 / 平均 / 丢包，点击聚焦该目标、其余变淡）。每台可在管理端单独关闭。
   - 问题列表：每条按自身级别着色（服务端另给出 `health_critical`，即列表前多少条是严重）；超过 4 条时只展示前 3 条，其余点击「展开其余 N 项」查看，同一台服务器打开期间展开状态不受 3 秒刷新影响。
   - 图标：系统 / 国旗图标来自 iconify，加载超时 5 秒后回退为通用图标或文字，未加载前不占位；宽幅文字商标自动改用方形变体。
5. **管理页**：列表（拖拽排序、IP 复制、安装命令复制、编辑 / 删除）、设置弹窗（通用 / 显示 / 隐私 / TCPing 四个标签页；「显示」页可关闭概览卡片、标签、流量统计与毛玻璃）、修改密码、下载备份、退出。
6. **登录页**：登录与首次设置密码共用一个卡片，支持显示密码、语言 / 主题切换。

代码结构：`server/web/src/layouts/Base.astro`（文档骨架 + 首屏引导脚本）、`components/`（NavBar / Dashboard / AdminPanel / LoginCard / Footer / Icon）、`scripts/core/`（i18n、主题、API 与 SSE、图标、弹窗、提示）、`scripts/dashboard/`（状态、行渲染、标签、硬件、TCPing、详情弹窗、主控制器）、`scripts/admin/`、`scripts/login/`、`styles/global.css`（设计令牌与组件样式，深浅色 / 毛玻璃均为变量切换）。

展示原则：列表只回答「哪台机器需要看」，一切细节进弹窗；弹窗内按"问题 → 核心指标 → 硬件明细"的顺序组织。

## 4. 实施顺序

1. 服务端类型与健康判定（含单元测试） → 2. 探针采集（本机可验证的项先做：负载、网卡、多挂载点、IO、温度；S.M.A.R.T. / mdadm / ZFS 用样例数据做解析测试） → 3. 首页展示 → 4. 温度 / IO 历史与告警。

## 5. 当前进度（2026-09-04）

已完成的第一版纵切（服务端 → 探针 → 前端全部打通，本机实测）：

- 服务端：`server/hardware.go` 定义硬件快照结构、阈值与 `evaluateHealth`；`SystemMetric` 新增 `hardware` / `health` / `health_issues`；推送、拉取、旧版上报三条路径都经过 `applyHardware`（探针未带硬件时保留上一份快照）；公开视图自动抹掉磁盘序列号。单元测试见 `server/hardware_test.go`。
- 探针：跨平台共用部分（采集循环、一次性推送握手、S.M.A.R.T. 解析）在 `client/hardware_common.go`；Linux 采集器在 `client/hardware_linux.go`（DMI 解析在 `hardware_dmi_linux.go`），Windows 在 `hardware_windows.go`（全部走 WMI：Win32_Processor / PhysicalMemory / DiskDrive、Storage 命名空间的 MSFT_PhysicalDisk 与可靠性计数器、PerfRawData 磁盘与网卡计数器、ACPI 温区、注册表的待重启标记；可选 nvidia-smi 与 smartmontools），macOS 在 `hardware_darwin.go`（sysctl、`system_profiler -json` 每 10 分钟一次的静态清单、ioreg 的磁盘累计计数、networksetup + ifconfig 的物理网口、gopsutil 的负载 / 文件系统 / 网卡计数；可选 Homebrew smartctl 与 powermetrics 的温度风扇）。三个平台产出同一份 `hardware` 结构，服务端判定与前端展示不区分平台。每 60 秒在后台采集（CPU 拓扑 / 频率、内存与 EDAC ECC、负载、lsblk + smartctl、/proc/diskstats IO 速率、挂载点容量、/proc/mdstat、zpool、hwmon/thermal 温度风扇、物理网卡链路与错误计数、nvidia-smi、内核与 reboot-required），所有外部命令 8 秒超时、缺失即跳过；非 Linux 平台为空实现。3 秒推送只读缓存，且硬件快照每次采集只随推送发送一次。解析器测试见 `client/hardware_linux_test.go`。
- 前端：已整体重写（见第 3 节）。列表中的「健康」列显示问题数，详情弹窗的概览页置顶问题列表，硬件页展示磁盘 / 文件系统 / RAID / 传感器 / 网卡 / GPU 明细，中英文可切换。

待办（按优先级）：

1. 健康问题文案由服务端同时生成中英文（`health_issues` / `health_issues_en`，下标对齐），前端按当前语言选用；旧服务端只有中文时前端自动回退。
2. 温度 / 磁盘 IO 历史曲线（复用 tcping 的 bbolt 历史桶模式）。
3. 管理端可配置阈值、异常通知（Telegram / Webhook）。
4. 首页「仅看有问题的机器」筛选。
5. IPMI（ipmitool sdr）电源 / 风扇采集作为可选项。

## 安全边界

- **公开视图只给健康结论，不给可利用的版本号。** 未登录访客拿到的快照会在服务端剥离序列号、内核版本、BIOS 版本、主板型号与内存条料号（`maskHardwareForPublic`）；IP、共享密钥只在管理员会话中出现。开启「隐私模式」后，所有数据接口（`/api/metrics`、`/api/events`、TCPing 历史与配置）对匿名请求一律 401，只接受分享令牌或管理员令牌。
- **管理员令牌只走 Authorization 头**（EventSource 例外，用 `admin_token` 查询参数并单独校验），24 小时过期；修改密码时吊销其他所有会话。登录按来源 IP 限速（5 次失败锁 15 分钟，仅信任配置的反向代理转发头）。密码 bcrypt，令牌 32 字节 `crypto/rand`。
- **响应头**：`Content-Security-Policy`（脚本只允许本站 + 构建产物中唯一一段引导脚本的哈希；连接只允许本站与图标 CDN），`X-Frame-Options: SAMEORIGIN`、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`；自带 TLS 时加 HSTS。管理员的自定义 JS 由本站 `/api/custom/script.js` 提供，不再内联注入，跨站脚本无法执行。
- **TLS**：设置 `TLS_CERT` / `TLS_KEY` 后服务端直接监听 HTTPS；否则请放在终止 TLS 的反向代理后面——管理密码、令牌和探针共享密钥都在请求里传输，明文 HTTP 只适合内网。探针的 `SERVER_BASE` 同样应使用 https。
- **探针**：推送模式下设 `CLIENT_PORT=0`，探针不再监听任何端口（独服上不多开一个口）；需要拉取模式时可用 `CLIENT_BIND` 收窄绑定地址。探针只读 /sys、/proc 与四个外部命令的输出，不接受任何来自服务端的指令，只响应 TCPing 目标列表。
- **前端**：所有动态文本经 `esc()`/`attr()` 转义；远程图标名只允许 `set:name` 形式，CDN 返回的 SVG 与管理员上传的 SVG logo 都先经 `sanitizeSvg` 去掉脚本、事件属性与外链后再插入。
- **仍需注意**：共享密钥对整个机群是同一把——任何一台探针主机被攻破都能伪造其他机器的数据，怀疑泄露时在设置里「重新生成」并更新各探针；管理员自定义 CSS/JS 会对所有访客生效，本质上是管理员信任边界的一部分；TCPing 目标地址会出现在公开视图中，不要把内网地址配置成目标。

不采集的项（有意为之）：IPMI 的 SEL 事件日志、SMART 自检日志、SATA 盘的累计写入（241 属性各厂商单位不一，无法可靠换算）、每进程信息。探针只读 /sys 与 /proc，外部命令仅 smartctl / lsblk / zpool / nvidia-smi / ipmitool：lsblk / zpool / nvidia-smi 每 60 秒一次，smartctl 与 ipmitool 每 5 分钟一次；实测独服上常驻内存约 13 MB、CPU 0.2–0.3%。


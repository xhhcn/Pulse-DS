package main

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// Hardware health model for dedicated servers.
//
// Agents attach an optional "hardware" object to every push. It is a latest
// snapshot (collected every ~60 s on the agent), stored verbatim on the
// SystemMetric, and evaluated server-side into a single Health verdict plus a
// human-readable issue list so every viewer sees the same judgement. All
// fields are optional: an agent that cannot read a source simply omits it.

type HardwareInfo struct {
	CollectedAt time.Time        `json:"collected_at"`
	CPU         *CPUHardware     `json:"cpu,omitempty"`
	Memory      *MemoryHardware  `json:"memory,omitempty"`
	Load        []float64        `json:"load,omitempty"` // 1, 5, 15 minute averages
	Disks       []DiskHardware   `json:"disks,omitempty"`
	Filesystems []FilesystemInfo `json:"filesystems,omitempty"`
	RAID        []RAIDArray      `json:"raid,omitempty"`
	ZFS         []ZFSPool        `json:"zfs,omitempty"`
	Sensors     []Sensor         `json:"sensors,omitempty"`
	Network     []NetInterface   `json:"network,omitempty"`
	GPUs        []GPUInfo        `json:"gpus,omitempty"`
	System      *SystemHardware  `json:"system,omitempty"`
}

type CPUHardware struct {
	Sockets int     `json:"sockets,omitempty"`
	Cores   int     `json:"cores,omitempty"`   // physical cores (all sockets)
	Threads int     `json:"threads,omitempty"` // logical CPUs
	Model   string  `json:"model,omitempty"`
	MHz     float64 `json:"mhz,omitempty"`     // current average frequency
	MaxMHz  float64 `json:"max_mhz,omitempty"` // cpufreq maximum
	L3Cache string  `json:"l3_cache,omitempty"`
}

type MemoryHardware struct {
	TotalBytes       uint64     `json:"total_bytes,omitempty"`
	ECCSupported     bool       `json:"ecc_supported"`
	ECCCorrectable   int64      `json:"ecc_correctable"`   // -1 = unknown
	ECCUncorrectable int64      `json:"ecc_uncorrectable"` // -1 = unknown
	DIMMs            []DIMMInfo `json:"dimms,omitempty"`   // populated slots (SMBIOS type 17)
}

// DIMMInfo describes one populated memory slot.
type DIMMInfo struct {
	Locator       string `json:"locator,omitempty"`
	SizeBytes     uint64 `json:"size_bytes"`
	Type          string `json:"type,omitempty"` // DDR4, DDR5, ...
	SpeedMTs      int    `json:"speed_mts,omitempty"`
	ConfiguredMTs int    `json:"configured_mts,omitempty"`
	// SpeedNominal marks a speed taken from the published specification
	// rather than read from the module (Apple silicon exposes none).
	SpeedNominal bool   `json:"speed_nominal,omitempty"`
	Manufacturer string `json:"manufacturer,omitempty"`
	PartNumber   string `json:"part_number,omitempty"`
	ECC          bool   `json:"ecc"`
	Rank         int    `json:"rank,omitempty"`
}

// DiskHardware describes one physical block device. SMART fields are pointers
// so "not available" (no smartctl, virtual disk, no permission) is
// distinguishable from a real zero.
type DiskHardware struct {
	Device        string   `json:"device"` // sda, nvme0n1
	Model         string   `json:"model,omitempty"`
	Serial        string   `json:"serial,omitempty"` // admin view only
	Type          string   `json:"type,omitempty"`   // hdd, ssd, nvme
	SizeBytes     uint64   `json:"size_bytes,omitempty"`
	SMARTStatus   string   `json:"smart_status,omitempty"` // passed, failed, unknown
	TempC         *float64 `json:"temp_c,omitempty"`
	PowerOnHours  *int64   `json:"power_on_hours,omitempty"`
	Reallocated   *int64   `json:"reallocated,omitempty"`     // ATA attribute 5
	Pending       *int64   `json:"pending,omitempty"`         // ATA attribute 197
	WearPct       *float64 `json:"wear_pct,omitempty"`        // NVMe percentage used
	SpareAvailPct *float64 `json:"spare_avail_pct,omitempty"` // NVMe available spare
	MediaErrors   *int64   `json:"media_errors,omitempty"`    // NVMe media and data integrity errors
	WrittenBytes  uint64   `json:"written_bytes,omitempty"`   // lifetime host writes (NVMe data units)
	ReadMBps      float64  `json:"read_mb_s"`
	WriteMBps     float64  `json:"write_mb_s"`
	ReadIOPS      float64  `json:"read_iops"`
	WriteIOPS     float64  `json:"write_iops"`
	UtilPct       float64  `json:"util_pct"`
}

type FilesystemInfo struct {
	Mount      string  `json:"mount"`
	Device     string  `json:"device,omitempty"`
	FSType     string  `json:"fstype,omitempty"`
	TotalBytes uint64  `json:"total_bytes"`
	UsedBytes  uint64  `json:"used_bytes"`
	UsedPct    float64 `json:"used_pct"`
}

type RAIDArray struct {
	Name        string   `json:"name"` // md0
	Level       string   `json:"level,omitempty"`
	State       string   `json:"state,omitempty"` // active, inactive
	DisksTotal  int      `json:"disks_total"`
	DisksActive int      `json:"disks_active"`
	Degraded    bool     `json:"degraded"`
	RebuildPct  *float64 `json:"rebuild_pct,omitempty"`
}

type ZFSPool struct {
	Name   string `json:"name"`
	State  string `json:"state"` // ONLINE, DEGRADED, FAULTED, ...
	Errors int64  `json:"errors"`
}

type Sensor struct {
	Chip  string   `json:"chip,omitempty"`
	Label string   `json:"label"`
	Kind  string   `json:"kind"` // temp, fan, volt, power, current, psu
	Value float64  `json:"value"`
	Unit  string   `json:"unit,omitempty"` // C, RPM, V, W, A
	Max   *float64 `json:"max,omitempty"`
	Crit  *float64 `json:"crit,omitempty"`
	// IPMI sensors carry the BMC's own verdict (ok / nc / cr / nr) and, for
	// discrete readings such as a PSU state, the text instead of a number.
	Status string `json:"status,omitempty"`
	Text   string `json:"text,omitempty"`
}

type NetInterface struct {
	Name       string  `json:"name"`
	SpeedMbps  int     `json:"speed_mbps"` // -1 = unknown (virtual)
	Duplex     string  `json:"duplex,omitempty"`
	OperState  string  `json:"oper_state,omitempty"`
	AdminState string  `json:"admin_state,omitempty"`
	RxBytes    uint64  `json:"rx_bytes"`
	TxBytes    uint64  `json:"tx_bytes"`
	RxErrors   uint64  `json:"rx_errors"`
	TxErrors   uint64  `json:"tx_errors"`
	RxDropped  uint64  `json:"rx_dropped"`
	TxDropped  uint64  `json:"tx_dropped"`
	RxMBps     float64 `json:"rx_mb_s"`
	TxMBps     float64 `json:"tx_mb_s"`
}

type GPUInfo struct {
	Name       string  `json:"name"`
	UtilPct    float64 `json:"util_pct"`
	MemUsedMB  float64 `json:"mem_used_mb"`
	MemTotalMB float64 `json:"mem_total_mb"`
	TempC      float64 `json:"temp_c"`
}

type SystemHardware struct {
	Kernel         string `json:"kernel,omitempty"`
	RebootRequired bool   `json:"reboot_required"`
	Vendor         string `json:"vendor,omitempty"`  // DMI system vendor
	Product        string `json:"product,omitempty"` // DMI product name
	Board          string `json:"board,omitempty"`   // DMI board name
	BIOS           string `json:"bios,omitempty"`    // BIOS version (date)
	// Every PCI display controller by name ("ASPEED Graphics Family" on a
	// server board with only the BMC's VGA), so the page can say whether the
	// machine has a GPU at all.
	DisplayAdapters []string `json:"display_adapters,omitempty"`
}

// Health verdicts.
const (
	HealthUnknown  = "unknown"
	HealthOK       = "ok"
	HealthWarn     = "warn"
	HealthCritical = "critical"
)

// Thresholds. Constants for now; an admin-configurable version is planned.
const (
	healthTempWarnC          = 85.0
	healthFSWarnPct          = 90.0
	healthFSCritPct          = 95.0
	healthNVMeSpareCritPct   = 10.0
	healthNVMeWearWarnPct    = 90.0 // also used for SATA SSD life (wear = 100 - life left)
	healthLoadPerCoreWarn    = 2.0
	healthLinkExpectedMbps   = 1000 // a dedicated server is expected to negotiate at least gigabit
	healthHardwareStaleAfter = 10 * time.Minute
)

// maskHardwareForPublic strips what an attacker could act on from a snapshot
// before it is handed to unauthenticated viewers: serial numbers, the exact
// kernel and BIOS versions (both map straight to CVE lists), the board model
// and memory part numbers. Capacities, models, temperatures and the health
// verdict stay, so the public page remains useful. The metric is a value
// copy, but Hardware is a pointer with shared slices, so everything touched
// is cloned first.
func maskHardwareForPublic(hw *HardwareInfo) *HardwareInfo {
	if hw == nil {
		return nil
	}
	clone := *hw
	if len(hw.Disks) > 0 {
		clone.Disks = make([]DiskHardware, len(hw.Disks))
		copy(clone.Disks, hw.Disks)
		for i := range clone.Disks {
			clone.Disks[i].Serial = ""
		}
	}
	if hw.Memory != nil && len(hw.Memory.DIMMs) > 0 {
		mem := *hw.Memory
		mem.DIMMs = make([]DIMMInfo, len(hw.Memory.DIMMs))
		copy(mem.DIMMs, hw.Memory.DIMMs)
		for i := range mem.DIMMs {
			mem.DIMMs[i].PartNumber = ""
		}
		clone.Memory = &mem
	}
	if hw.System != nil {
		sys := *hw.System
		sys.Kernel = ""
		sys.BIOS = ""
		sys.Board = ""
		clone.System = &sys
	}
	return &clone
}

// evaluateHealth turns a hardware snapshot into a verdict and an ordered list
// of issues (critical first). now is injected for testability.
// issueList collects health issues in both UI languages. The two slices stay
// index-aligned so one sort order applies to both.
type issueList struct{ zh, en []string }

func (l *issueList) add(zh, en string) {
	l.zh = append(l.zh, zh)
	l.en = append(l.en, en)
}

func (l *issueList) sorted() (zh, en []string) {
	idx := make([]int, len(l.zh))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return l.zh[idx[a]] < l.zh[idx[b]] })
	for _, i := range idx {
		zh = append(zh, l.zh[i])
		en = append(en, l.en[i])
	}
	return zh, en
}

// healthResult is what evaluateHealth derives from a snapshot.
type healthResult struct {
	Level    string
	Issues   []string // Chinese, critical entries first
	IssuesEN []string // English, index-aligned with Issues
	Critical int      // how many leading entries of Issues are critical
}

// evaluateHealth derives the health level and the issue list (Chinese and
// English, index-aligned) from a hardware snapshot. Critical issues are listed
// before warnings; each group is sorted so the list is stable between pushes.
func evaluateHealth(hw *HardwareInfo, now time.Time) healthResult {
	if hw == nil {
		return healthResult{Level: HealthUnknown}
	}
	var crit, warn issueList

	if !hw.CollectedAt.IsZero() && now.Sub(hw.CollectedAt) > healthHardwareStaleAfter {
		mins := int(now.Sub(hw.CollectedAt).Minutes())
		warn.add(fmt.Sprintf("硬件数据已 %d 分钟未更新", mins), fmt.Sprintf("Hardware data is %d min old", mins))
	}

	for _, d := range hw.Disks {
		name := d.Device
		if d.Model != "" {
			name = d.Device + " (" + d.Model + ")"
		}
		switch strings.ToLower(d.SMARTStatus) {
		case "failed":
			crit.add(name+": S.M.A.R.T. 整体判定为 FAILED", name+": S.M.A.R.T. overall health FAILED")
		}
		if d.MediaErrors != nil && *d.MediaErrors > 0 {
			crit.add(fmt.Sprintf("%s: NVMe 介质错误 %d", name, *d.MediaErrors), fmt.Sprintf("%s: %d NVMe media errors", name, *d.MediaErrors))
		}
		if d.SpareAvailPct != nil && *d.SpareAvailPct < healthNVMeSpareCritPct {
			crit.add(fmt.Sprintf("%s: NVMe 可用备件仅 %.0f%%", name, *d.SpareAvailPct), fmt.Sprintf("%s: NVMe spare capacity only %.0f%%", name, *d.SpareAvailPct))
		}
		if d.Reallocated != nil && *d.Reallocated > 0 {
			warn.add(fmt.Sprintf("%s: 重映射扇区 %d", name, *d.Reallocated), fmt.Sprintf("%s: %d reallocated sectors", name, *d.Reallocated))
		}
		if d.Pending != nil && *d.Pending > 0 {
			warn.add(fmt.Sprintf("%s: 待映射扇区 %d", name, *d.Pending), fmt.Sprintf("%s: %d pending sectors", name, *d.Pending))
		}
		if d.WearPct != nil && *d.WearPct >= healthNVMeWearWarnPct {
			warn.add(fmt.Sprintf("%s: SSD 剩余寿命仅 %.0f%%", name, 100-*d.WearPct), fmt.Sprintf("%s: SSD life remaining only %.0f%%", name, 100-*d.WearPct))
		}
		if d.TempC != nil && *d.TempC >= healthTempWarnC {
			warn.add(fmt.Sprintf("%s: 温度 %.0f℃", name, *d.TempC), fmt.Sprintf("%s: temperature %.0f°C", name, *d.TempC))
		}
	}

	for _, r := range hw.RAID {
		if r.Degraded || (r.DisksTotal > 0 && r.DisksActive < r.DisksTotal) {
			zh := fmt.Sprintf("%s (%s) 降级 %d/%d", r.Name, r.Level, r.DisksActive, r.DisksTotal)
			en := fmt.Sprintf("%s (%s) degraded %d/%d", r.Name, r.Level, r.DisksActive, r.DisksTotal)
			if r.RebuildPct != nil {
				zh += fmt.Sprintf("，重建 %.1f%%", *r.RebuildPct)
				en += fmt.Sprintf(", rebuilding %.1f%%", *r.RebuildPct)
			}
			crit.add(zh, en)
		} else if r.RebuildPct != nil {
			warn.add(fmt.Sprintf("%s 正在重建 %.1f%%", r.Name, *r.RebuildPct), fmt.Sprintf("%s rebuilding %.1f%%", r.Name, *r.RebuildPct))
		}
	}
	for _, z := range hw.ZFS {
		switch strings.ToUpper(z.State) {
		case "ONLINE", "":
		case "DEGRADED":
			crit.add(fmt.Sprintf("ZFS 池 %s 降级", z.Name), fmt.Sprintf("ZFS pool %s degraded", z.Name))
		default:
			crit.add(fmt.Sprintf("ZFS 池 %s 状态 %s", z.Name, z.State), fmt.Sprintf("ZFS pool %s state %s", z.Name, z.State))
		}
		if z.Errors > 0 {
			warn.add(fmt.Sprintf("ZFS 池 %s 累计错误 %d", z.Name, z.Errors), fmt.Sprintf("ZFS pool %s has %d errors", z.Name, z.Errors))
		}
	}

	if hw.Memory != nil {
		if hw.Memory.ECCUncorrectable > 0 {
			crit.add(fmt.Sprintf("内存 ECC 不可纠正错误 %d", hw.Memory.ECCUncorrectable), fmt.Sprintf("%d uncorrectable ECC memory errors", hw.Memory.ECCUncorrectable))
		}
		if hw.Memory.ECCCorrectable > 0 {
			warn.add(fmt.Sprintf("内存 ECC 可纠正错误 %d", hw.Memory.ECCCorrectable), fmt.Sprintf("%d correctable ECC memory errors", hw.Memory.ECCCorrectable))
		}
	}

	for _, fs := range hw.Filesystems {
		if fs.UsedPct >= healthFSCritPct {
			crit.add(fmt.Sprintf("%s 已用 %.0f%%", fs.Mount, fs.UsedPct), fmt.Sprintf("%s is %.0f%% full", fs.Mount, fs.UsedPct))
		} else if fs.UsedPct >= healthFSWarnPct {
			warn.add(fmt.Sprintf("%s 已用 %.0f%%", fs.Mount, fs.UsedPct), fmt.Sprintf("%s is %.0f%% full", fs.Mount, fs.UsedPct))
		}
	}

	for _, s := range hw.Sensors {
		// BMC verdicts (IPMI): critical / non-recoverable states are incidents
		// whatever the reading is; non-critical is a warning.
		switch s.Status {
		case "cr", "nr":
			crit.add(fmt.Sprintf("%s %s: %s", ipmiKindZh(s.Kind), sensorName(s), sensorReading(s)), fmt.Sprintf("%s %s: %s", ipmiKindEn(s.Kind), sensorName(s), sensorReading(s)))
			continue
		case "nc":
			warn.add(fmt.Sprintf("%s %s: %s", ipmiKindZh(s.Kind), sensorName(s), sensorReading(s)), fmt.Sprintf("%s %s: %s", ipmiKindEn(s.Kind), sensorName(s), sensorReading(s)))
			continue
		}
		switch s.Kind {
		case "fan":
			if s.Value == 0 {
				warn.add(fmt.Sprintf("风扇 %s 停转", sensorName(s)), fmt.Sprintf("Fan %s stopped", sensorName(s)))
			}
		case "psu":
			if t := strings.ToLower(s.Text); strings.Contains(t, "failure") || strings.Contains(t, "lost") || strings.Contains(t, "fail") {
				crit.add(fmt.Sprintf("电源 %s: %s", sensorName(s), s.Text), fmt.Sprintf("PSU %s: %s", sensorName(s), s.Text))
			}
		case "temp":
			limit := healthTempWarnC
			if s.Crit != nil && *s.Crit > 0 && *s.Crit < limit {
				limit = *s.Crit
			}
			if s.Value >= limit {
				warn.add(fmt.Sprintf("%s 温度 %.0f℃", sensorName(s), s.Value), fmt.Sprintf("%s temperature %.0f°C", sensorName(s), s.Value))
			}
		}
	}

	if hw.CPU != nil && hw.CPU.Threads > 0 && len(hw.Load) > 0 {
		if hw.Load[0] > float64(hw.CPU.Threads)*healthLoadPerCoreWarn {
			warn.add(fmt.Sprintf("负载 %.1f 超过 %d 线程的 %.0f 倍", hw.Load[0], hw.CPU.Threads, healthLoadPerCoreWarn),
				fmt.Sprintf("Load %.1f exceeds %.0f× the %d threads", hw.Load[0], healthLoadPerCoreWarn, hw.CPU.Threads))
		}
	}

	for _, n := range hw.Network {
		if n.OperState != "" && n.OperState != "up" && n.OperState != "unknown" {
			// Standard practice (Zabbix / LibreNMS): a port that is
			// administratively up but has no link is an incident; an
			// unconfigured spare port (admin down) is not. Probes that do not
			// report the admin state fall back to "has this port ever carried
			// traffic", which separates the two cases almost as well.
			adminUp := n.AdminState == "up" || (n.AdminState == "" && (n.RxBytes > 0 || n.TxBytes > 0))
			if adminUp {
				warn.add(fmt.Sprintf("网卡 %s 链路 %s", n.Name, n.OperState), fmt.Sprintf("NIC %s link %s", n.Name, n.OperState))
			}
			continue
		}
		if n.SpeedMbps > 0 && n.SpeedMbps < healthLinkExpectedMbps {
			warn.add(fmt.Sprintf("网卡 %s 协商速率仅 %d Mbps", n.Name, n.SpeedMbps), fmt.Sprintf("NIC %s negotiated only %d Mbps", n.Name, n.SpeedMbps))
		}
		if n.Duplex == "half" {
			warn.add(fmt.Sprintf("网卡 %s 半双工", n.Name), fmt.Sprintf("NIC %s is half duplex", n.Name))
		}
		if n.RxErrors+n.TxErrors > 0 {
			warn.add(fmt.Sprintf("网卡 %s 错误计数 %d", n.Name, n.RxErrors+n.TxErrors), fmt.Sprintf("NIC %s error count %d", n.Name, n.RxErrors+n.TxErrors))
		}
	}

	for _, g := range hw.GPUs {
		if g.TempC >= healthTempWarnC {
			warn.add(fmt.Sprintf("GPU %s 温度 %.0f℃", g.Name, g.TempC), fmt.Sprintf("GPU %s temperature %.0f°C", g.Name, g.TempC))
		}
	}

	if hw.System != nil && hw.System.RebootRequired {
		warn.add("系统等待重启以完成更新", "Reboot required to finish updates")
	}

	critZh, critEn := crit.sorted()
	warnZh, warnEn := warn.sorted()
	res := healthResult{Issues: append(critZh, warnZh...), IssuesEN: append(critEn, warnEn...), Critical: len(critZh)}
	switch {
	case len(critZh) > 0:
		res.Level = HealthCritical
	case len(warnZh) > 0:
		res.Level = HealthWarn
	default:
		res = healthResult{Level: HealthOK}
	}
	return res
}

func sensorReading(s Sensor) string {
	if s.Text != "" {
		return s.Text
	}
	return fmt.Sprintf("%.4g %s", s.Value, s.Unit)
}

func ipmiKindZh(kind string) string {
	switch kind {
	case "fan":
		return "风扇"
	case "temp":
		return "温度"
	case "volt":
		return "电压"
	case "power":
		return "功率"
	case "current":
		return "电流"
	case "psu":
		return "电源"
	}
	return "传感器"
}

func ipmiKindEn(kind string) string {
	switch kind {
	case "fan":
		return "Fan"
	case "temp":
		return "Temperature"
	case "volt":
		return "Voltage"
	case "power":
		return "Power"
	case "current":
		return "Current"
	case "psu":
		return "PSU"
	}
	return "Sensor"
}

func sensorName(s Sensor) string {
	if s.Chip == "ipmi" && s.Label != "" {
		return s.Label
	}
	if s.Chip != "" && s.Label != "" {
		return s.Chip + " " + s.Label
	}
	if s.Label != "" {
		return s.Label
	}
	return s.Chip
}

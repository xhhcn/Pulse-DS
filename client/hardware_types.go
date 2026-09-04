package main

import "time"

// Hardware snapshot sent to the server as the optional "hardware" object of
// every push. The JSON shape mirrors server/hardware.go exactly; both sides
// treat every field as optional.

type HardwareInfo struct {
	CollectedAt time.Time        `json:"collected_at"`
	CPU         *CPUHardware     `json:"cpu,omitempty"`
	Memory      *MemoryHardware  `json:"memory,omitempty"`
	Load        []float64        `json:"load,omitempty"`
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
	Cores   int     `json:"cores,omitempty"`
	Threads int     `json:"threads,omitempty"`
	Model   string  `json:"model,omitempty"`
	MHz     float64 `json:"mhz,omitempty"`
	MaxMHz  float64 `json:"max_mhz,omitempty"`
	L3Cache string  `json:"l3_cache,omitempty"`
}

type MemoryHardware struct {
	TotalBytes       uint64     `json:"total_bytes,omitempty"`
	ECCSupported     bool       `json:"ecc_supported"`
	ECCCorrectable   int64      `json:"ecc_correctable"`
	ECCUncorrectable int64      `json:"ecc_uncorrectable"`
	DIMMs            []DIMMInfo `json:"dimms,omitempty"`
}

// DIMMInfo is one populated memory slot (SMBIOS type 17).
type DIMMInfo struct {
	Locator       string `json:"locator,omitempty"`
	SizeBytes     uint64 `json:"size_bytes"`
	Type          string `json:"type,omitempty"`
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

type DiskHardware struct {
	Device        string   `json:"device"`
	Model         string   `json:"model,omitempty"`
	Serial        string   `json:"serial,omitempty"`
	Type          string   `json:"type,omitempty"`
	SizeBytes     uint64   `json:"size_bytes,omitempty"`
	SMARTStatus   string   `json:"smart_status,omitempty"`
	TempC         *float64 `json:"temp_c,omitempty"`
	PowerOnHours  *int64   `json:"power_on_hours,omitempty"`
	Reallocated   *int64   `json:"reallocated,omitempty"`
	Pending       *int64   `json:"pending,omitempty"`
	WearPct       *float64 `json:"wear_pct,omitempty"`
	SpareAvailPct *float64 `json:"spare_avail_pct,omitempty"`
	MediaErrors   *int64   `json:"media_errors,omitempty"`
	WrittenBytes  uint64   `json:"written_bytes,omitempty"`
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
	Name        string   `json:"name"`
	Level       string   `json:"level,omitempty"`
	State       string   `json:"state,omitempty"`
	DisksTotal  int      `json:"disks_total"`
	DisksActive int      `json:"disks_active"`
	Degraded    bool     `json:"degraded"`
	RebuildPct  *float64 `json:"rebuild_pct,omitempty"`
}

type ZFSPool struct {
	Name   string `json:"name"`
	State  string `json:"state"`
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
	Name      string `json:"name"`
	SpeedMbps int    `json:"speed_mbps"`
	Duplex    string `json:"duplex,omitempty"`
	OperState string `json:"oper_state,omitempty"`
	// AdminState is "up" when the interface is administratively enabled
	// (IFF_UP), "down" for an unconfigured spare port.
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
	Vendor         string `json:"vendor,omitempty"`
	Product        string `json:"product,omitempty"`
	Board          string `json:"board,omitempty"`
	BIOS           string `json:"bios,omitempty"`
	// Every PCI display controller by name ("ASPEED Graphics Family" on a
	// server board with only the BMC's VGA), so the page can say whether the
	// machine has a GPU at all.
	DisplayAdapters []string `json:"display_adapters,omitempty"`
}

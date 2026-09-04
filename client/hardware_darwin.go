//go:build darwin
// +build darwin

package main

// Dedicated-server hardware collection, macOS collectors.
//
// Sources, all part of the OS: sysctl for the CPU and memory size,
// system_profiler (JSON) for the slow-moving inventory — DIMMs, disks,
// graphics, firmware — refreshed every ten minutes, ioreg for cumulative
// disk I/O counters, networksetup + ifconfig for the physical ports, and
// gopsutil for load, filesystems and interface counters. Optional:
// smartctl (Homebrew smartmontools) adds S.M.A.R.T. attributes, and
// powermetrics (root) adds CPU temperature and fan speed on Intel Macs.

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/load"
	netutil "github.com/shirou/gopsutil/v3/net"
	"golang.org/x/sys/unix"
)

const (
	macInventoryInterval = 10 * time.Minute
	macSensorInterval    = 5 * time.Minute
)

type macInventory struct {
	cpu      *CPUHardware
	memory   *MemoryHardware
	disks    []DiskHardware // static part: model, size, type, SMART verdict
	system   *SystemHardware
	gpus     []GPUInfo
	ports    map[string]string // en0 -> "Ethernet"
	appleCPU bool
}

var (
	macInvAt    time.Time
	macInv      macInventory
	macSensAt   time.Time
	macSensors_ []Sensor
	macGPUUtil  float64
)

func collectHardware() *HardwareInfo {
	now := time.Now()
	if macInvAt.IsZero() || now.Sub(macInvAt) >= macInventoryInterval {
		macInv = macCollectInventory()
		macInvAt = now
	}
	hw := &HardwareInfo{CollectedAt: now.UTC()}
	hw.CPU = macInv.cpu
	hw.Memory = macInv.memory
	if avg, err := load.Avg(); err == nil {
		hw.Load = []float64{avg.Load1, avg.Load5, avg.Load15}
	}
	hw.Disks = macDisks(now)
	hw.Filesystems = macFilesystems()
	hw.Sensors = macSensorsCached(now)
	hw.Network = macNetwork(now)
	hw.GPUs = append(macGPUs(), collectNvidiaGPUs()...) // nvidia-smi only exists on old Intel Macs
	hw.System = macInv.system
	hwPrevSample = now
	return hw
}

// ---------------------------------------------------------------- inventory (slow, cached)

func macCollectInventory() macInventory {
	inv := macInventory{ports: map[string]string{}}
	brand, _ := unix.Sysctl("machdep.cpu.brand_string")
	inv.appleCPU = strings.Contains(brand, "Apple")

	// CPU
	c := &CPUHardware{Model: strings.Join(strings.Fields(brand), " ")}
	if v, err := unix.SysctlUint32("hw.packages"); err == nil {
		c.Sockets = int(v)
	}
	if v, err := unix.SysctlUint32("hw.physicalcpu"); err == nil {
		c.Cores = int(v)
	}
	if v, err := unix.SysctlUint32("hw.logicalcpu"); err == nil {
		c.Threads = int(v)
	}
	if v, err := unix.SysctlUint64("hw.cpufrequency_max"); err == nil && v > 0 { // Intel only
		c.MaxMHz = float64(v) / 1e6
	}
	if v, err := unix.SysctlUint64("hw.l3cachesize"); err == nil && v > 0 {
		c.L3Cache = fmt.Sprintf("%dK", v/1024)
	}
	inv.cpu = c

	// system_profiler: one call for every slow-moving section.
	out, ok := runCmd("system_profiler", "-json", "SPHardwareDataType", "SPMemoryDataType", "SPNVMeDataType", "SPSerialATADataType", "SPSASDataType", "SPDisplaysDataType")
	var prof map[string][]map[string]interface{}
	if ok {
		_ = json.Unmarshal(out, &prof)
	}
	inv.memory = macMemory(prof["SPMemoryDataType"])
	inv.disks = macDiskInventory(prof)
	inv.system, inv.gpus = macSystemAndGraphics(prof, brand)

	// Physical ports: "Hardware Port: Ethernet / Device: en0" blocks.
	if out, ok := runCmd("networksetup", "-listallhardwareports"); ok {
		inv.ports = parseHardwarePorts(string(out))
	}
	return inv
}

func macMemory(section []map[string]interface{}) *MemoryHardware {
	m := &MemoryHardware{}
	if v, err := unix.SysctlUint64("hw.memsize"); err == nil {
		m.TotalBytes = v
	}
	if len(section) == 0 {
		return m
	}
	top := section[0]
	if strings.EqualFold(str(top, "global_ecc_state"), "enabled") {
		m.ECCSupported = true
	}
	dimms := items(top)
	if len(dimms) == 0 {
		// Apple silicon: unified memory, one entry without a slot.
		if t := str(top, "dimm_type"); t != "" {
			d := DIMMInfo{Locator: "Unified", SizeBytes: m.TotalBytes, Type: t, Manufacturer: str(top, "dimm_manufacturer")}
			if brand, err := unix.Sysctl("machdep.cpu.brand_string"); err == nil {
				if mts := appleSiliconMemoryMTs(brand); mts > 0 {
					d.SpeedMTs, d.SpeedNominal = mts, true
				}
			}
			m.DIMMs = []DIMMInfo{d}
		}
		return m
	}
	for _, d := range dimms {
		size := parseSize(str(d, "dimm_size"))
		if size == 0 {
			continue // empty slot
		}
		m.DIMMs = append(m.DIMMs, DIMMInfo{
			Locator:      str(d, "_name"),
			SizeBytes:    size,
			Type:         str(d, "dimm_type"),
			SpeedMTs:     parseMTs(str(d, "dimm_speed")),
			Manufacturer: str(d, "dimm_manufacturer"),
			PartNumber:   str(d, "dimm_part_number"),
			ECC:          m.ECCSupported,
		})
	}
	return m
}

func macSystemAndGraphics(prof map[string][]map[string]interface{}, brand string) (*SystemHardware, []GPUInfo) {
	s := &SystemHardware{Vendor: "Apple"}
	if rel, err := unix.Sysctl("kern.osrelease"); err == nil {
		s.Kernel = "Darwin " + rel
	}
	model, _ := unix.Sysctl("hw.model")
	if hwSec := prof["SPHardwareDataType"]; len(hwSec) > 0 {
		h := hwSec[0]
		if name := str(h, "machine_name"); name != "" {
			s.Product = name
		}
		if m := str(h, "machine_model"); m != "" {
			model = m
		}
		if fw := str(h, "boot_rom_version"); fw != "" {
			s.BIOS = fw
		} else if fw := str(h, "os_loader_version"); fw != "" {
			s.BIOS = fw
		}
	}
	if model != "" {
		if s.Product == "" {
			s.Product = model
		} else {
			s.Product += " (" + model + ")"
		}
	}
	var gpus []GPUInfo
	if disp := prof["SPDisplaysDataType"]; len(disp) > 0 {
		for _, g := range disp {
			name := str(g, "sppci_model")
			if name == "" {
				name = str(g, "_name")
			}
			if name == "" {
				continue
			}
			s.DisplayAdapters = append(s.DisplayAdapters, name)
			// Discrete cards get a GPU entry (memory known, no counters);
			// the Apple GPU gets one when powermetrics reports its load.
			if vram := parseSize(str(g, "spdisplays_vram")); vram > 0 && !strings.HasPrefix(name, "Apple") {
				gpus = append(gpus, GPUInfo{Name: name, MemTotalMB: float64(vram) / 1048576})
			}
		}
	}
	return s, gpus
}

// ---------------------------------------------------------------- disks (per cycle)

func macDisks(now time.Time) []DiskHardware {
	if len(macInv.disks) == 0 {
		return nil
	}
	stats := map[string]diskSample{}
	if out, ok := runCmd("ioreg", "-r", "-c", "IOBlockStorageDriver", "-l", "-w0"); ok {
		stats = parseIoregStats(string(out))
	}
	elapsed := 0.0
	if !hwPrevSample.IsZero() {
		elapsed = now.Sub(hwPrevSample).Seconds()
	}
	refreshSMART := hwSmartAt.IsZero() || now.Sub(hwSmartAt) >= smartInterval
	if refreshSMART {
		hwSmartAt = now
	}
	out := make([]DiskHardware, 0, len(macInv.disks))
	for _, d := range macInv.disks {
		if cur, ok := stats[d.Device]; ok {
			if prev, ok := hwPrevDisk[d.Device]; ok && elapsed > 0 {
				d.ReadIOPS = float64(cur.readIOs-prev.readIOs) / elapsed
				d.WriteIOPS = float64(cur.writeIOs-prev.writeIOs) / elapsed
				d.ReadMBps = float64(cur.readSectors-prev.readSectors) * 512 / 1e6 / elapsed
				d.WriteMBps = float64(cur.writeSectors-prev.writeSectors) * 512 / 1e6 / elapsed
				d.UtilPct = float64(cur.ioMs-prev.ioMs) / 10 / elapsed
				if d.UtilPct > 100 {
					d.UtilPct = 100
				}
			}
			hwPrevDisk[d.Device] = cur
		}
		if cached, ok := hwSmartCache[d.Device]; ok && !refreshSMART {
			copySMART(&d, cached)
		} else {
			applySMART(&d, "/dev/"+d.Device)
			hwSmartCache[d.Device] = d
		}
		out = append(out, d)
	}
	return out
}

func macFilesystems() []FilesystemInfo {
	parts, err := disk.Partitions(false)
	if err != nil {
		return nil
	}
	var out []FilesystemInfo
	var root, data *FilesystemInfo
	for _, p := range parts {
		mp := p.Mountpoint
		switch {
		case mp == "/", mp == "/System/Volumes/Data", strings.HasPrefix(mp, "/Volumes/"):
		default:
			continue
		}
		if strings.HasPrefix(mp, "/Volumes/Recovery") {
			continue
		}
		u, err := disk.Usage(mp)
		if err != nil || u.Total == 0 {
			continue
		}
		fs := FilesystemInfo{Mount: mp, Device: p.Device, FSType: p.Fstype, TotalBytes: u.Total, UsedBytes: u.Used, UsedPct: u.UsedPercent}
		switch mp {
		case "/":
			root = &fs
		case "/System/Volumes/Data":
			data = &fs
		default:
			out = append(out, fs)
		}
	}
	// The sealed system volume and the Data volume share one APFS container
	// and report the same numbers: show the container once, as "/".
	if data != nil {
		data.Mount = "/"
		out = append([]FilesystemInfo{*data}, out...)
	} else if root != nil {
		out = append([]FilesystemInfo{*root}, out...)
	}
	return out
}

// ---------------------------------------------------------------- sensors / GPU (powermetrics, optional)

func macSensorsCached(now time.Time) []Sensor {
	if !macSensAt.IsZero() && now.Sub(macSensAt) < macSensorInterval {
		return macSensors_
	}
	macSensAt = now
	sampler := "smc"
	if macInv.appleCPU {
		sampler = "gpu_power" // Apple silicon exposes no SMC readings; GPU load is what we can get
	}
	if out, ok := runCmd("powermetrics", "--samplers", sampler, "-i", "500", "-n", "1"); ok {
		macSensors_, macGPUUtil = parsePowermetrics(string(out))
	} else {
		macSensors_, macGPUUtil = nil, 0
	}
	return macSensors_
}

func macGPUs() []GPUInfo {
	gpus := append([]GPUInfo(nil), macInv.gpus...)
	if macInv.appleCPU && macGPUUtil > 0 {
		name := macInv.cpu.Model
		if s := macInv.system; s != nil && len(s.DisplayAdapters) > 0 {
			name = s.DisplayAdapters[0]
		}
		gpus = append(gpus, GPUInfo{Name: name, UtilPct: macGPUUtil})
	}
	return gpus
}

// ---------------------------------------------------------------- network

func macNetwork(now time.Time) []NetInterface {
	if len(macInv.ports) == 0 {
		return nil
	}
	counters := map[string]netutil.IOCountersStat{}
	if list, err := netutil.IOCounters(true); err == nil {
		for _, c := range list {
			counters[c.Name] = c
		}
	}
	elapsed := 0.0
	if !hwPrevSample.IsZero() {
		elapsed = now.Sub(hwPrevSample).Seconds()
	}
	var out []NetInterface
	for dev, port := range macInv.ports {
		if !strings.HasPrefix(dev, "en") || !physicalPort(port) {
			continue // bridges, thunderbolt buses, USB tethering, VPN tunnels
		}
		n := NetInterface{Name: dev + " (" + port + ")", SpeedMbps: -1, OperState: "unknown"}
		if out, ok := runCmd("ifconfig", dev); ok {
			n.SpeedMbps, n.Duplex, n.OperState, n.AdminState = parseIfconfig(string(out))
		}
		wifi := strings.Contains(strings.ToLower(port), "wi-fi") || strings.EqualFold(port, "airport")
		if wifi && n.OperState != "up" {
			continue // a switched-off radio on a server is not a fault
		}
		if c, ok := counters[dev]; ok {
			n.RxBytes, n.TxBytes = c.BytesRecv, c.BytesSent
			n.RxErrors, n.TxErrors = c.Errin, c.Errout
			n.RxDropped, n.TxDropped = c.Dropin, c.Dropout
			if prev, ok := hwPrevNet[dev]; ok && elapsed > 0 && n.RxBytes >= prev.rx && n.TxBytes >= prev.tx {
				n.RxMBps = float64(n.RxBytes-prev.rx) / 1e6 / elapsed
				n.TxMBps = float64(n.TxBytes-prev.tx) / 1e6 / elapsed
			}
			hwPrevNet[dev] = netSample{rx: n.RxBytes, tx: n.TxBytes}
		}
		out = append(out, n)
	}
	sortNetInterfaces(out)
	return out
}

func sortNetInterfaces(list []NetInterface) {
	for i := 1; i < len(list); i++ {
		for j := i; j > 0 && list[j].Name < list[j-1].Name; j-- {
			list[j], list[j-1] = list[j-1], list[j]
		}
	}
}

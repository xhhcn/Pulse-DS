//go:build windows
// +build windows

package main

// Dedicated-server hardware collection, Windows collectors.
//
// Everything comes from WMI — the same source Task Manager, Get-PhysicalDisk
// and Get-NetAdapter read — so nothing has to be installed. Two optional
// tools add detail exactly as on Linux: nvidia-smi (ships with the driver)
// for GPU counters and smartctl (smartmontools for Windows) for the full
// S.M.A.R.T. attribute set; without smartctl the Storage namespace's
// reliability counters still give temperature, power-on hours and wear.
// Every query is best-effort: a class that this Windows edition does not
// expose (thermal zones, reliability counters on older releases) is skipped.

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/StackExchange/wmi"
	"golang.org/x/sys/windows/registry"
)

const (
	storageNS = `root\Microsoft\Windows\Storage`
	wmiNS     = `root\WMI`
)

func collectHardware() *HardwareInfo {
	now := time.Now()
	hw := &HardwareInfo{CollectedAt: now.UTC()}
	hw.CPU = winCPU()
	hw.Memory = winMemory()
	hw.Disks = winDisks(now)
	hw.Filesystems = winFilesystems()
	hw.Sensors = winSensors()
	hw.Network = winNetwork(now)
	hw.GPUs = collectNvidiaGPUs()
	hw.System = winSystem()
	hwPrevSample = now
	return hw
}

// query runs a WQL statement in the default namespace; ok is false when the
// class is missing or WMI is unavailable.
func query(dst interface{}, wql string) bool {
	return wmi.Query(wql, dst) == nil
}

func queryNS(dst interface{}, wql, namespace string) bool {
	return wmi.QueryNamespace(wql, dst, namespace) == nil
}

// ---------------------------------------------------------------- CPU / memory

func winCPU() *CPUHardware {
	var rows []struct {
		Name                      string
		NumberOfCores             uint32
		NumberOfLogicalProcessors uint32
		MaxClockSpeed             uint32
		CurrentClockSpeed         uint32
		L3CacheSize               uint32
	}
	if !query(&rows, "SELECT Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed, CurrentClockSpeed, L3CacheSize FROM Win32_Processor") || len(rows) == 0 {
		return nil
	}
	c := &CPUHardware{Sockets: len(rows), Model: strings.Join(strings.Fields(rows[0].Name), " ")}
	for _, r := range rows {
		c.Cores += int(r.NumberOfCores)
		c.Threads += int(r.NumberOfLogicalProcessors)
	}
	c.MaxMHz = float64(rows[0].MaxClockSpeed)
	// Win32_Processor.CurrentClockSpeed is the nominal clock, not a live
	// reading; only report it when it actually differs from the maximum.
	if rows[0].CurrentClockSpeed != rows[0].MaxClockSpeed {
		c.MHz = float64(rows[0].CurrentClockSpeed)
	}
	if rows[0].L3CacheSize > 0 {
		c.L3Cache = fmt.Sprintf("%dK", rows[0].L3CacheSize)
	}
	return c
}

// smbiosMemoryType maps SMBIOS type 17 memory-type codes (the same table the
// Linux DMI parser uses) to names.
var smbiosMemoryType = map[uint16]string{
	0x0F: "SDRAM", 0x12: "DDR", 0x13: "DDR2", 0x18: "DDR3", 0x1A: "DDR4", 0x1E: "LPDDR4", 0x22: "DDR5", 0x23: "LPDDR5",
	0x1B: "LPDDR", 0x1C: "LPDDR2", 0x1D: "LPDDR3",
}

func winMemory() *MemoryHardware {
	m := &MemoryHardware{}
	var arrays []struct{ MemoryErrorCorrection uint16 }
	if query(&arrays, "SELECT MemoryErrorCorrection FROM Win32_PhysicalMemoryArray") {
		for _, a := range arrays {
			if a.MemoryErrorCorrection == 5 || a.MemoryErrorCorrection == 6 { // single-bit / multi-bit ECC
				m.ECCSupported = true
			}
		}
	}
	var dimms []struct {
		Capacity             uint64
		Speed                uint32
		ConfiguredClockSpeed uint32
		Manufacturer         string
		PartNumber           string
		DeviceLocator        string
		SMBIOSMemoryType     uint16
		DataWidth            uint16
		TotalWidth           uint16
	}
	if query(&dimms, "SELECT Capacity, Speed, ConfiguredClockSpeed, Manufacturer, PartNumber, DeviceLocator, SMBIOSMemoryType, DataWidth, TotalWidth FROM Win32_PhysicalMemory") {
		for _, d := range dimms {
			if d.Capacity == 0 {
				continue
			}
			m.TotalBytes += d.Capacity
			m.DIMMs = append(m.DIMMs, DIMMInfo{
				Locator:       strings.TrimSpace(d.DeviceLocator),
				SizeBytes:     d.Capacity,
				Type:          smbiosMemoryType[d.SMBIOSMemoryType],
				SpeedMTs:      int(d.Speed),
				ConfiguredMTs: int(d.ConfiguredClockSpeed),
				Manufacturer:  strings.TrimSpace(d.Manufacturer),
				PartNumber:    strings.TrimSpace(d.PartNumber),
				ECC:           d.DataWidth > 0 && d.TotalWidth > d.DataWidth,
			})
		}
	}
	if len(m.DIMMs) == 0 && !m.ECCSupported {
		return nil // virtual machine: the plain memory_info string is enough
	}
	return m
}

// ---------------------------------------------------------------- disks

func winDisks(now time.Time) []DiskHardware {
	var drives []struct {
		Index         uint32
		Model         string
		SerialNumber  string
		InterfaceType string
		MediaType     string
		Status        string
		PNPDeviceID   string
		Size          uint64
	}
	if !query(&drives, "SELECT Index, Model, SerialNumber, InterfaceType, MediaType, Status, PNPDeviceID, Size FROM Win32_DiskDrive") {
		return nil
	}
	var phys []struct {
		DeviceId     string
		MediaType    uint16
		HealthStatus uint16
		BusType      uint16
	}
	queryNS(&phys, "SELECT DeviceId, MediaType, HealthStatus, BusType FROM MSFT_PhysicalDisk", storageNS)
	rel := winReliabilityCounters(phys)
	ata := winATASmart()
	var perf []struct {
		Name                 string
		DiskReadBytesPersec  uint64
		DiskWriteBytesPersec uint64
		DiskReadsPersec      uint64
		DiskWritesPersec     uint64
		PercentDiskTime      uint64
	}
	query(&perf, "SELECT Name, DiskReadBytesPersec, DiskWriteBytesPersec, DiskReadsPersec, DiskWritesPersec, PercentDiskTime FROM Win32_PerfRawData_PerfDisk_PhysicalDisk")

	elapsed := 0.0
	if !hwPrevSample.IsZero() {
		elapsed = now.Sub(hwPrevSample).Seconds()
	}
	refreshSMART := hwSmartAt.IsZero() || now.Sub(hwSmartAt) >= smartInterval
	if refreshSMART {
		hwSmartAt = now
	}
	var disks []DiskHardware
	for _, dr := range drives {
		if strings.EqualFold(dr.InterfaceType, "USB") {
			continue // removable media is not part of the server's storage
		}
		idx := fmt.Sprint(dr.Index)
		d := DiskHardware{Device: "disk" + idx, Model: strings.TrimSpace(dr.Model), Serial: strings.TrimSpace(dr.SerialNumber), SizeBytes: dr.Size, Type: "hdd"}
		for _, p := range phys {
			if p.DeviceId != idx {
				continue
			}
			switch p.MediaType {
			case 4:
				d.Type = "ssd"
			case 3:
				d.Type = "hdd"
			}
			if p.BusType == 17 { // NVMe
				d.Type = "nvme"
			}
			switch p.HealthStatus {
			case 0:
				d.SMARTStatus = "passed"
			case 1, 2:
				d.SMARTStatus = "failed"
			}
		}
		if d.SMARTStatus == "" {
			switch {
			case strings.Contains(strings.ToLower(dr.Status), "fail"):
				d.SMARTStatus = "failed"
			case strings.EqualFold(dr.Status, "OK"):
				d.SMARTStatus = "passed"
			}
		}
		for _, r := range rel {
			if r.DeviceId != idx {
				continue
			}
			if r.Temperature > 0 {
				t := float64(r.Temperature)
				d.TempC = &t
			}
			if r.PowerOnHours > 0 {
				h := int64(r.PowerOnHours)
				d.PowerOnHours = &h
			}
			if r.Wear > 0 {
				w := float64(r.Wear)
				d.WearPct = &w
			}
			if errs := r.ReadErrorsUncorrected + r.WriteErrorsUncorrected; errs > 0 {
				e := int64(errs)
				d.MediaErrors = &e
			}
		}
		// Older drivers expose nothing in the Storage namespace but still
		// answer the classic ATA SMART query keyed by the PnP device id.
		if key := strings.ToUpper(dr.PNPDeviceID); key != "" {
			if attrs, ok := ata[key]; ok {
				applyATASmartAttributes(&d, attrs)
			}
		}
		// Perf instances are named "<index> <drive letters>" ("0 C:").
		for _, p := range perf {
			if p.Name != idx && !strings.HasPrefix(p.Name, idx+" ") {
				continue
			}
			cur := diskSample{readIOs: p.DiskReadsPersec, readSectors: p.DiskReadBytesPersec / 512, writeIOs: p.DiskWritesPersec, writeSectors: p.DiskWriteBytesPersec / 512, ioMs: p.PercentDiskTime / 10000}
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
			break
		}
		// smartmontools, when installed, refines the picture (/dev/pdN = PhysicalDriveN).
		if cached, ok := hwSmartCache[d.Device]; ok && !refreshSMART {
			copySMART(&d, cached)
		} else {
			applySMART(&d, "/dev/pd"+idx)
			hwSmartCache[d.Device] = d
		}
		disks = append(disks, d)
	}
	return disks
}

type winReliability struct {
	DeviceId               string
	Temperature            uint8
	PowerOnHours           uint32
	Wear                   uint8
	ReadErrorsUncorrected  uint64
	WriteErrorsUncorrected uint64
}

// winReliabilityCounters reads MSFT_StorageReliabilityCounter — first as a
// plain enumeration, then (some Windows builds only materialise the class
// through its association) per physical disk via ASSOCIATORS OF.
func winReliabilityCounters(phys []struct {
	DeviceId     string
	MediaType    uint16
	HealthStatus uint16
	BusType      uint16
}) []winReliability {
	var rel []winReliability
	if queryNS(&rel, "SELECT DeviceId, Temperature, PowerOnHours, Wear, ReadErrorsUncorrected, WriteErrorsUncorrected FROM MSFT_StorageReliabilityCounter", storageNS) && len(rel) > 0 {
		return rel
	}
	var ids []struct{ ObjectId, DeviceId string }
	if !queryNS(&ids, "SELECT ObjectId, DeviceId FROM MSFT_PhysicalDisk", storageNS) {
		return nil
	}
	for _, p := range ids {
		if p.ObjectId == "" {
			continue
		}
		esc := strings.ReplaceAll(strings.ReplaceAll(p.ObjectId, `\`, `\\`), `"`, `\"`)
		var one []winReliability
		if queryNS(&one, `ASSOCIATORS OF {MSFT_PhysicalDisk.ObjectId="`+esc+`"} WHERE ResultClass = MSFT_StorageReliabilityCounter`, storageNS) {
			for i := range one {
				if one[i].DeviceId == "" {
					one[i].DeviceId = p.DeviceId
				}
			}
			rel = append(rel, one...)
		}
	}
	return rel
}

// winATASmart reads the raw ATA attribute tables (root\WMI), keyed by the
// upper-cased PnP device id (the instance name is that id plus "_0").
func winATASmart() map[string][]ataAttribute {
	var rows []struct {
		InstanceName   string
		VendorSpecific []uint8
	}
	if !queryNS(&rows, "SELECT InstanceName, VendorSpecific FROM MSStorageDriver_ATAPISmartData", wmiNS) {
		return nil
	}
	out := map[string][]ataAttribute{}
	for _, r := range rows {
		key := strings.ToUpper(strings.TrimSuffix(r.InstanceName, "_0"))
		if attrs := parseATASmartAttributes(r.VendorSpecific); len(attrs) > 0 {
			out[key] = attrs
		}
	}
	return out
}

func winFilesystems() []FilesystemInfo {
	var vols []struct {
		DeviceID   string
		FileSystem string
		Size       uint64
		FreeSpace  uint64
	}
	if !query(&vols, "SELECT DeviceID, FileSystem, Size, FreeSpace FROM Win32_LogicalDisk WHERE DriveType = 3") {
		return nil
	}
	var out []FilesystemInfo
	for _, v := range vols {
		if v.Size == 0 {
			continue
		}
		used := v.Size - v.FreeSpace
		out = append(out, FilesystemInfo{Mount: v.DeviceID, FSType: v.FileSystem, TotalBytes: v.Size, UsedBytes: used, UsedPct: float64(used) / float64(v.Size) * 100})
	}
	return out
}

// ---------------------------------------------------------------- sensors

func winSensors() []Sensor {
	var zones []struct {
		InstanceName       string
		CurrentTemperature uint32 // tenths of a kelvin
	}
	if !queryNS(&zones, "SELECT InstanceName, CurrentTemperature FROM MSAcpi_ThermalZoneTemperature", wmiNS) {
		return nil
	}
	var out []Sensor
	for _, z := range zones {
		c := float64(z.CurrentTemperature)/10 - 273.15
		if c <= 0 || c > 150 {
			continue
		}
		label := z.InstanceName
		if i := strings.LastIndex(label, `\`); i >= 0 {
			label = label[i+1:]
		}
		label = strings.TrimSuffix(label, "_0")
		out = append(out, Sensor{Chip: "acpi", Label: label, Kind: "temp", Value: c, Unit: "C"})
	}
	return out
}

// ---------------------------------------------------------------- network

var perfInstanceReplacer = strings.NewReplacer("(", "[", ")", "]", "#", "_", "/", "_", `\`, "_")

var virtualAdapter = regexp.MustCompile(`(?i)virtual|vmware|hyper-v|loopback|bluetooth|wan miniport|tap-|npcap|wi-fi direct|teredo|isatap`)

func winNetwork(now time.Time) []NetInterface {
	var adapters []struct {
		Name                string
		NetConnectionID     string
		Speed               uint64
		NetConnectionStatus uint16
		NetEnabled          bool
	}
	if !query(&adapters, "SELECT Name, NetConnectionID, Speed, NetConnectionStatus, NetEnabled FROM Win32_NetworkAdapter WHERE PhysicalAdapter = TRUE") {
		return nil
	}
	var perf []struct {
		Name                     string
		BytesReceivedPersec      uint64
		BytesSentPersec          uint64
		PacketsReceivedErrors    uint64
		PacketsOutboundErrors    uint64
		PacketsReceivedDiscarded uint64
		PacketsOutboundDiscarded uint64
	}
	query(&perf, "SELECT Name, BytesReceivedPersec, BytesSentPersec, PacketsReceivedErrors, PacketsOutboundErrors, PacketsReceivedDiscarded, PacketsOutboundDiscarded FROM Win32_PerfRawData_Tcpip_NetworkInterface")
	elapsed := 0.0
	if !hwPrevSample.IsZero() {
		elapsed = now.Sub(hwPrevSample).Seconds()
	}
	var out []NetInterface
	for _, a := range adapters {
		if virtualAdapter.MatchString(a.Name) {
			continue
		}
		name := strings.TrimSpace(a.NetConnectionID)
		if name == "" {
			name = strings.TrimSpace(a.Name)
		}
		n := NetInterface{Name: name, SpeedMbps: -1, AdminState: "down", OperState: "unknown"}
		if a.NetEnabled {
			n.AdminState = "up"
		}
		switch a.NetConnectionStatus {
		case 2:
			n.OperState = "up"
		case 7:
			n.OperState = "down" // media disconnected
		case 0, 1, 3, 4, 5, 6:
			n.OperState = "down"
		}
		if a.Speed > 0 && a.Speed < 1<<62 {
			n.SpeedMbps = int(a.Speed / 1000000)
		}
		want := perfInstanceReplacer.Replace(a.Name)
		for _, p := range perf {
			if p.Name != want {
				continue
			}
			n.RxBytes, n.TxBytes = p.BytesReceivedPersec, p.BytesSentPersec
			n.RxErrors, n.TxErrors = p.PacketsReceivedErrors, p.PacketsOutboundErrors
			n.RxDropped, n.TxDropped = p.PacketsReceivedDiscarded, p.PacketsOutboundDiscarded
			if prev, ok := hwPrevNet[name]; ok && elapsed > 0 && n.RxBytes >= prev.rx && n.TxBytes >= prev.tx {
				n.RxMBps = float64(n.RxBytes-prev.rx) / 1e6 / elapsed
				n.TxMBps = float64(n.TxBytes-prev.tx) / 1e6 / elapsed
			}
			hwPrevNet[name] = netSample{rx: n.RxBytes, tx: n.TxBytes}
			break
		}
		out = append(out, n)
	}
	return out
}

// ---------------------------------------------------------------- system

func winSystem() *SystemHardware {
	s := &SystemHardware{}
	var cs []struct{ Manufacturer, Model string }
	if query(&cs, "SELECT Manufacturer, Model FROM Win32_ComputerSystem") && len(cs) > 0 {
		s.Vendor, s.Product = strings.TrimSpace(cs[0].Manufacturer), strings.TrimSpace(cs[0].Model)
	}
	var bb []struct{ Manufacturer, Product string }
	if query(&bb, "SELECT Manufacturer, Product FROM Win32_BaseBoard") && len(bb) > 0 {
		s.Board = strings.TrimSpace(bb[0].Product)
		if bv := strings.TrimSpace(bb[0].Manufacturer); bv != "" && bv != s.Vendor && !strings.HasPrefix(strings.ToLower(s.Board), strings.ToLower(bv)) {
			s.Board = bv + " " + s.Board
		}
	}
	var bios []struct{ SMBIOSBIOSVersion, ReleaseDate string }
	if query(&bios, "SELECT SMBIOSBIOSVersion, ReleaseDate FROM Win32_BIOS") && len(bios) > 0 {
		s.BIOS = strings.TrimSpace(bios[0].SMBIOSBIOSVersion)
		if d := bios[0].ReleaseDate; len(d) >= 8 { // CIM datetime: yyyymmddHHMMSS.ffffff+UUU
			s.BIOS += " (" + d[:4] + "-" + d[4:6] + "-" + d[6:8] + ")"
		}
	}
	var os []struct{ Version, Caption string }
	if query(&os, "SELECT Version, Caption FROM Win32_OperatingSystem") && len(os) > 0 {
		s.Kernel = "NT " + strings.TrimSpace(os[0].Version)
	}
	var video []struct{ Name string }
	if query(&video, "SELECT Name FROM Win32_VideoController") {
		for _, v := range video {
			n := strings.TrimSpace(v.Name)
			// Remote Desktop / Basic Display / Hyper-V adapters are software.
			if n == "" || strings.HasPrefix(n, "Microsoft ") {
				continue
			}
			s.DisplayAdapters = append(s.DisplayAdapters, n)
		}
	}
	s.RebootRequired = rebootPending()
	return s
}

// rebootPending mirrors what Windows Update and servicing leave behind when
// a restart is still outstanding.
func rebootPending() bool {
	for _, path := range []string{
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending`,
		`SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired`,
	} {
		if k, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE); err == nil {
			k.Close()
			return true
		}
	}
	return false
}

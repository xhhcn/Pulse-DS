//go:build linux
// +build linux

package main

import (
	"bufio"
	"encoding/json"
	"io/ioutil"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Dedicated-server hardware collection, Linux collectors. The collector
// loop, the S.M.A.R.T. parser and the other OS-independent pieces live in
// hardware_common.go; Windows and macOS have their own collectors.
//
// Everything here is best-effort: a source that is missing, unreadable or
// slow is skipped and the rest of the snapshot is still reported. Expensive
// sources (smartctl, lsblk, zpool, nvidia-smi) run at most once per
// hardwareInterval on a background goroutine; the 3 s push loop only reads
// the cached snapshot.

func collectHardware() *HardwareInfo {
	now := time.Now()
	hw := &HardwareInfo{CollectedAt: now.UTC()}
	hw.CPU = collectCPUHardware()
	hw.Memory = collectMemoryHardware()
	hw.Load = collectLoad()
	hw.Disks = collectDisks(now)
	hw.Filesystems = collectFilesystems()
	hw.RAID = parseMdstat(readFile("/proc/mdstat"))
	hw.ZFS = collectZFS()
	hw.Sensors = append(collectSensors(), collectIPMI(now)...)
	hw.Network = collectNetInterfaces(now)
	hw.GPUs = collectGPUs()
	hw.System = collectSystemHardware()
	hwPrevSample = now
	return hw
}

// ---------------------------------------------------------------- sysfs helpers

func readFile(path string) string {
	b, err := ioutil.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func readInt(path string) (int64, bool) {
	v := readFile(path)
	if v == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(v, 10, 64)
	return n, err == nil
}

// ---------------------------------------------------------------- CPU / memory / load

func collectCPUHardware() *CPUHardware {
	cpu := &CPUHardware{Model: getCPUModel()}
	dirs, _ := filepath.Glob("/sys/devices/system/cpu/cpu[0-9]*/topology")
	packages := map[string]struct{}{}
	cores := map[string]struct{}{}
	for _, d := range dirs {
		pkg := readFile(filepath.Join(d, "physical_package_id"))
		core := readFile(filepath.Join(d, "core_id"))
		if pkg == "" {
			continue
		}
		packages[pkg] = struct{}{}
		cores[pkg+":"+core] = struct{}{}
		cpu.Threads++
	}
	cpu.Sockets = len(packages)
	cpu.Cores = len(cores)
	// Average current frequency across logical CPUs.
	if info := readFile("/proc/cpuinfo"); info != "" {
		var sum float64
		var n int
		for _, line := range strings.Split(info, "\n") {
			if strings.HasPrefix(line, "cpu MHz") {
				if i := strings.Index(line, ":"); i >= 0 {
					if v, err := strconv.ParseFloat(strings.TrimSpace(line[i+1:]), 64); err == nil {
						sum += v
						n++
					}
				}
			}
		}
		if n > 0 {
			cpu.MHz = sum / float64(n)
		}
	}
	if khz, ok := readInt("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq"); ok && khz > 0 {
		cpu.MaxMHz = float64(khz) / 1000
	}
	// Largest cache level exposed by cpu0 (L3 on anything modern).
	for _, idx := range []string{"index3", "index2"} {
		if sz := readFile("/sys/devices/system/cpu/cpu0/cache/" + idx + "/size"); sz != "" {
			cpu.L3Cache = sz
			break
		}
	}
	if cpu.Threads == 0 && cpu.Model == "" {
		return nil
	}
	return cpu
}

func collectMemoryHardware() *MemoryHardware {
	m := &MemoryHardware{ECCCorrectable: -1, ECCUncorrectable: -1}
	for _, line := range strings.Split(readFile("/proc/meminfo"), "\n") {
		if strings.HasPrefix(line, "MemTotal:") {
			f := strings.Fields(line)
			if len(f) >= 2 {
				if kb, err := strconv.ParseUint(f[1], 10, 64); err == nil {
					m.TotalBytes = kb * 1024
				}
			}
		}
	}
	// EDAC exposes one directory per memory controller; sum their counters.
	if mcs, _ := filepath.Glob("/sys/devices/system/edac/mc/mc[0-9]*"); len(mcs) > 0 {
		m.ECCSupported = true
		m.ECCCorrectable, m.ECCUncorrectable = 0, 0
		for _, mc := range mcs {
			if v, ok := readInt(filepath.Join(mc, "ce_count")); ok {
				m.ECCCorrectable += v
			}
			if v, ok := readInt(filepath.Join(mc, "ue_count")); ok {
				m.ECCUncorrectable += v
			}
		}
	}
	m.DIMMs = collectDIMMs()
	if !m.ECCSupported {
		for _, d := range m.DIMMs {
			if d.ECC {
				m.ECCSupported = true // modules are ECC even if EDAC has no driver for this chipset
				break
			}
		}
	}
	return m
}

func collectLoad() []float64 {
	f := strings.Fields(readFile("/proc/loadavg"))
	if len(f) < 3 {
		return nil
	}
	out := make([]float64, 0, 3)
	for _, s := range f[:3] {
		v, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil
		}
		out = append(out, v)
	}
	return out
}

// ---------------------------------------------------------------- disks

type lsblkDevice struct {
	Name     string        `json:"name"`
	Type     string        `json:"type"`
	Size     interface{}   `json:"size"` // number with -b, string otherwise
	Model    *string       `json:"model"`
	Serial   *string       `json:"serial"`
	Rota     interface{}   `json:"rota"` // bool or "1"/"0"
	Tran     *string       `json:"tran"`
	Children []lsblkDevice `json:"children"`
}

func lsblkSize(v interface{}) uint64 {
	switch t := v.(type) {
	case float64:
		return uint64(t)
	case string:
		n, _ := strconv.ParseUint(t, 10, 64)
		return n
	}
	return 0
}

func lsblkRota(v interface{}) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return t == "1" || strings.EqualFold(t, "true")
	case float64:
		return t != 0
	}
	return false
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return strings.TrimSpace(*p)
}

func collectDisks(now time.Time) []DiskHardware {
	out, ok := runCmd("lsblk", "-J", "-b", "-o", "NAME,TYPE,SIZE,MODEL,SERIAL,ROTA,TRAN")
	if !ok {
		return nil
	}
	var parsed struct {
		Blockdevices []lsblkDevice `json:"blockdevices"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return nil
	}
	stats := parseDiskstats(readFile("/proc/diskstats"))
	elapsed := 0.0
	if !hwPrevSample.IsZero() {
		elapsed = now.Sub(hwPrevSample).Seconds()
	}
	refreshSMART := hwSmartAt.IsZero() || now.Sub(hwSmartAt) >= smartInterval
	if refreshSMART {
		hwSmartAt = now
	}
	var disks []DiskHardware
	for _, dev := range parsed.Blockdevices {
		if dev.Type != "disk" {
			continue
		}
		name := dev.Name
		if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") || strings.HasPrefix(name, "zram") || strings.HasPrefix(name, "sr") {
			continue
		}
		d := DiskHardware{Device: name, Model: derefStr(dev.Model), Serial: derefStr(dev.Serial), SizeBytes: lsblkSize(dev.Size)}
		switch {
		case strings.HasPrefix(name, "nvme") || strings.EqualFold(derefStr(dev.Tran), "nvme"):
			d.Type = "nvme"
		case lsblkRota(dev.Rota):
			d.Type = "hdd"
		default:
			d.Type = "ssd"
		}
		if strings.EqualFold(derefStr(dev.Tran), "mmc") || strings.HasPrefix(name, "mmcblk") {
			fillMMC(&d)
		}
		// IO rates from the previous sample of /proc/diskstats.
		if cur, ok := stats[name]; ok {
			if prev, ok := hwPrevDisk[name]; ok && elapsed > 0 {
				d.ReadIOPS = float64(cur.readIOs-prev.readIOs) / elapsed
				d.WriteIOPS = float64(cur.writeIOs-prev.writeIOs) / elapsed
				d.ReadMBps = float64(cur.readSectors-prev.readSectors) * 512 / 1e6 / elapsed
				d.WriteMBps = float64(cur.writeSectors-prev.writeSectors) * 512 / 1e6 / elapsed
				d.UtilPct = float64(cur.ioMs-prev.ioMs) / 10 / elapsed // ms busy per second -> %
				if d.UtilPct > 100 {
					d.UtilPct = 100
				}
			}
			hwPrevDisk[name] = cur
		}
		if cached, ok := hwSmartCache[name]; ok && !refreshSMART {
			copySMART(&d, cached)
		} else {
			applySMART(&d, "/dev/"+d.Device)
			hwSmartCache[name] = d
		}
		disks = append(disks, d)
	}
	return disks
}

func parseDiskstats(text string) map[string]diskSample {
	out := map[string]diskSample{}
	for _, line := range strings.Split(text, "\n") {
		f := strings.Fields(line)
		if len(f) < 14 {
			continue
		}
		u := func(i int) uint64 { n, _ := strconv.ParseUint(f[i], 10, 64); return n }
		out[f[2]] = diskSample{readIOs: u(3), readSectors: u(5), writeIOs: u(7), writeSectors: u(9), ioMs: u(12)}
	}
	return out
}

// ---------------------------------------------------------------- filesystems

var realFSTypes = map[string]bool{
	"ext2": true, "ext3": true, "ext4": true, "xfs": true, "btrfs": true, "zfs": true,
	"f2fs": true, "jfs": true, "reiserfs": true, "vfat": true, "exfat": true, "ntfs": true, "fuseblk": true,
}

func collectFilesystems() []FilesystemInfo {
	var out []FilesystemInfo
	seenDevice := map[string]bool{}
	for _, line := range strings.Split(readFile("/proc/mounts"), "\n") {
		f := strings.Fields(line)
		if len(f) < 3 || !realFSTypes[f[2]] {
			continue
		}
		device, mount, fstype := f[0], f[1], f[2]
		if strings.HasPrefix(mount, "/snap/") || strings.HasPrefix(mount, "/var/lib/docker/") {
			continue
		}
		// A device mounted several times (bind mounts) is reported once; ZFS
		// datasets are distinct even though they share a pool.
		if fstype != "zfs" {
			if seenDevice[device] {
				continue
			}
			seenDevice[device] = true
		}
		var st syscall.Statfs_t
		if err := syscall.Statfs(mount, &st); err != nil || st.Blocks == 0 {
			continue
		}
		bsize := uint64(st.Bsize)
		total := st.Blocks * bsize
		used := (st.Blocks - st.Bfree) * bsize
		avail := st.Bavail * bsize
		pct := 0.0
		if used+avail > 0 {
			pct = float64(used) / float64(used+avail) * 100 // same basis as df
		}
		out = append(out, FilesystemInfo{Mount: mount, Device: device, FSType: fstype, TotalBytes: total, UsedBytes: used, UsedPct: pct})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Mount < out[j].Mount })
	return out
}

// ---------------------------------------------------------------- RAID / ZFS

var (
	mdHeaderRe   = regexp.MustCompile(`^(md\d+)\s*:\s*(\w+)\s+(?:\(auto-read-only\)\s+)?(?:(raid\d+|linear|multipath|faulty)\s+)?`)
	mdStatusRe   = regexp.MustCompile(`\[(\d+)/(\d+)\]\s+\[([U_]+)\]`)
	mdProgressRe = regexp.MustCompile(`(?:recovery|resync|reshape|check)\s*=\s*([\d.]+)%`)
)

// parseMdstat reads /proc/mdstat, e.g.
//
//	md0 : active raid1 sdb1[1] sda1[0]
//	      1953382464 blocks super 1.2 [2/2] [UU]
//	      [====>................]  recovery = 24.6% (480/1953) finish=12.3min
func parseMdstat(text string) []RAIDArray {
	if text == "" {
		return nil
	}
	var out []RAIDArray
	lines := strings.Split(text, "\n")
	for i := 0; i < len(lines); i++ {
		m := mdHeaderRe.FindStringSubmatch(lines[i])
		if m == nil {
			continue
		}
		arr := RAIDArray{Name: m[1], State: m[2], Level: m[3]}
		// Status and progress live on the following lines until a blank one.
		for j := i + 1; j < len(lines) && strings.TrimSpace(lines[j]) != ""; j++ {
			if s := mdStatusRe.FindStringSubmatch(lines[j]); s != nil {
				arr.DisksTotal, _ = strconv.Atoi(s[1])
				arr.DisksActive, _ = strconv.Atoi(s[2])
				arr.Degraded = strings.Contains(s[3], "_") || arr.DisksActive < arr.DisksTotal
			}
			if p := mdProgressRe.FindStringSubmatch(lines[j]); p != nil {
				if v, err := strconv.ParseFloat(p[1], 64); err == nil {
					arr.RebuildPct = &v
				}
			}
		}
		if arr.State == "inactive" {
			arr.Degraded = true
		}
		out = append(out, arr)
	}
	return out
}

func collectZFS() []ZFSPool {
	out, ok := runCmd("zpool", "list", "-H", "-o", "name,health")
	if !ok {
		return nil
	}
	var pools []ZFSPool
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Fields(line)
		if len(f) >= 2 {
			pools = append(pools, ZFSPool{Name: f[0], State: strings.ToUpper(f[1])})
		}
	}
	return pools
}

// ---------------------------------------------------------------- sensors

func collectSensors() []Sensor {
	var out []Sensor
	hwmons, _ := filepath.Glob("/sys/class/hwmon/hwmon*")
	for _, dir := range hwmons {
		chip := readFile(filepath.Join(dir, "name"))
		entries, err := ioutil.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			n := e.Name()
			var kind, unit string
			var scale float64
			switch {
			case strings.HasPrefix(n, "temp") && strings.HasSuffix(n, "_input"):
				kind, unit, scale = "temp", "C", 1000
			case strings.HasPrefix(n, "fan") && strings.HasSuffix(n, "_input"):
				kind, unit, scale = "fan", "RPM", 1
			default:
				continue
			}
			raw, ok := readInt(filepath.Join(dir, n))
			if !ok {
				continue
			}
			base := strings.TrimSuffix(n, "_input")
			label := readFile(filepath.Join(dir, base+"_label"))
			if label == "" {
				label = base
			}
			s := Sensor{Chip: chip, Label: label, Kind: kind, Value: float64(raw) / scale, Unit: unit}
			if kind == "temp" {
				if v, ok := readInt(filepath.Join(dir, base+"_max")); ok && v > 0 {
					f := float64(v) / scale
					s.Max = &f
				}
				if v, ok := readInt(filepath.Join(dir, base+"_crit")); ok && v > 0 {
					f := float64(v) / scale
					s.Crit = &f
				}
			}
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		// Fall back to the generic thermal zones (ACPI / SoC) when no hwmon
		// chip exposed temperatures.
		zones, _ := filepath.Glob("/sys/class/thermal/thermal_zone*")
		for _, z := range zones {
			if v, ok := readInt(filepath.Join(z, "temp")); ok && v > 0 {
				label := readFile(filepath.Join(z, "type"))
				if label == "" {
					label = filepath.Base(z)
				}
				out = append(out, Sensor{Chip: "thermal", Label: label, Kind: "temp", Value: float64(v) / 1000, Unit: "C"})
			}
		}
	}
	return out
}

// ---------------------------------------------------------------- network

func collectNetInterfaces(now time.Time) []NetInterface {
	entries, err := ioutil.ReadDir("/sys/class/net")
	if err != nil {
		return nil
	}
	elapsed := 0.0
	if !hwPrevSample.IsZero() {
		elapsed = now.Sub(hwPrevSample).Seconds()
	}
	var out []NetInterface
	for _, e := range entries {
		name := e.Name()
		if name == "lo" {
			continue
		}
		base := filepath.Join("/sys/class/net", name)
		_, physical := os.Stat(filepath.Join(base, "device"))
		isBond := strings.HasPrefix(name, "bond")
		if physical != nil && !isBond {
			continue // veth, docker bridges, tunnels
		}
		n := NetInterface{Name: name, SpeedMbps: -1, Duplex: readFile(filepath.Join(base, "duplex")), OperState: readFile(filepath.Join(base, "operstate"))}
		n.AdminState = adminState(readFile(filepath.Join(base, "flags")))
		if v, ok := readInt(filepath.Join(base, "speed")); ok && v > 0 {
			n.SpeedMbps = int(v)
		}
		stat := func(f string) uint64 { v, _ := readInt(filepath.Join(base, "statistics", f)); return uint64(v) }
		n.RxBytes, n.TxBytes = stat("rx_bytes"), stat("tx_bytes")
		n.RxErrors, n.TxErrors = stat("rx_errors"), stat("tx_errors")
		n.RxDropped, n.TxDropped = stat("rx_dropped"), stat("tx_dropped")
		if prev, ok := hwPrevNet[name]; ok && elapsed > 0 && n.RxBytes >= prev.rx && n.TxBytes >= prev.tx {
			n.RxMBps = float64(n.RxBytes-prev.rx) / 1e6 / elapsed
			n.TxMBps = float64(n.TxBytes-prev.tx) / 1e6 / elapsed
		}
		hwPrevNet[name] = netSample{rx: n.RxBytes, tx: n.TxBytes}
		out = append(out, n)
	}
	return out
}

// ---------------------------------------------------------------- GPU / system

// adminState maps /sys/class/net/<if>/flags ("0x1003") to "up" / "down"
// by testing IFF_UP; an unparsable value yields "".
func adminState(flags string) string {
	v, err := strconv.ParseUint(strings.TrimPrefix(strings.TrimSpace(flags), "0x"), 16, 64)
	if err != nil {
		return ""
	}
	if v&1 == 1 {
		return "up"
	}
	return "down"
}

// collectGPUs: NVIDIA through nvidia-smi (shared), AMD through amdgpu sysfs.
func collectGPUs() []GPUInfo {
	return append(collectNvidiaGPUs(), collectAMDGPUs()...)
}

func collectAMDGPUs() []GPUInfo {
	cards, _ := filepath.Glob("/sys/class/drm/card[0-9]*/device")
	var out []GPUInfo
	for _, dev := range cards {
		if readFile(filepath.Join(dev, "vendor")) != "0x1002" {
			continue
		}
		busy, ok := readInt(filepath.Join(dev, "gpu_busy_percent"))
		if !ok {
			continue // legacy radeon driver: no counters
		}
		g := GPUInfo{Name: pciName("0x1002", readFile(filepath.Join(dev, "device"))), UtilPct: float64(busy)}
		if v, ok := readInt(filepath.Join(dev, "mem_info_vram_total")); ok {
			g.MemTotalMB = float64(v) / 1048576
		}
		if v, ok := readInt(filepath.Join(dev, "mem_info_vram_used")); ok {
			g.MemUsedMB = float64(v) / 1048576
		}
		if temps, _ := filepath.Glob(filepath.Join(dev, "hwmon/hwmon*/temp1_input")); len(temps) > 0 {
			if v, ok := readInt(temps[0]); ok {
				g.TempC = float64(v) / 1000
			}
		}
		out = append(out, g)
	}
	return out
}

// collectDisplayAdapters lists every PCI display controller (class 03xx),
// including the BMC's onboard VGA that every server board has, so "no GPU"
// is a positive statement rather than an absence of data.
func collectDisplayAdapters() []string {
	devs, _ := filepath.Glob("/sys/bus/pci/devices/*")
	var out []string
	for _, d := range devs {
		if !strings.HasPrefix(readFile(filepath.Join(d, "class")), "0x03") {
			continue
		}
		out = append(out, pciName(readFile(filepath.Join(d, "vendor")), readFile(filepath.Join(d, "device"))))
	}
	sort.Strings(out)
	return out
}

var (
	pciIDsOnce sync.Once
	pciVendors = map[string]string{} // "1a03" -> "ASPEED Technology, Inc."
	pciDevices = map[string]string{} // "1a03:2000" -> "ASPEED Graphics Family"
)

// loadPCIIDs parses the pci.ids database shipped by pciutils (vendor lines,
// tab-indented device lines; double-tab subsystem lines and the trailing
// class table are skipped).
func loadPCIIDs() {
	for _, p := range []string{"/usr/share/misc/pci.ids", "/usr/share/hwdata/pci.ids", "/usr/share/pci.ids"} {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		parsePCIIDs(f)
		f.Close()
		return
	}
}

func parsePCIIDs(r interface{ Read([]byte) (int, error) }) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	vendor := ""
	for sc.Scan() {
		line := sc.Text()
		switch {
		case line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "\t\t"):
			continue
		case strings.HasPrefix(line, "C "):
			vendor = "" // class table: nothing below is a vendor
		case strings.HasPrefix(line, "\t"):
			if vendor == "" {
				continue
			}
			if parts := strings.SplitN(strings.TrimSpace(line), "  ", 2); len(parts) == 2 {
				pciDevices[vendor+":"+strings.ToLower(parts[0])] = strings.TrimSpace(parts[1])
			}
		default:
			parts := strings.SplitN(line, "  ", 2)
			if len(parts) == 2 && len(parts[0]) == 4 {
				vendor = strings.ToLower(parts[0])
				pciVendors[vendor] = strings.TrimSpace(parts[1])
			} else {
				vendor = ""
			}
		}
	}
}

// pciName renders "0x1a03"/"0x2000" as "ASPEED Technology ASPEED Graphics Family".
func pciName(vendor, device string) string {
	pciIDsOnce.Do(loadPCIIDs)
	v := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(vendor)), "0x")
	d := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(device)), "0x")
	vendorName, haveVendor := pciVendors[v]
	if name, ok := pciDevices[v+":"+d]; ok {
		// "ASPEED Graphics Family" already names its maker; only prefix the
		// vendor when the device string does not start with it.
		if sv := shortVendor(vendorName); haveVendor && !strings.HasPrefix(strings.ToLower(name), strings.ToLower(strings.Fields(sv)[0])) {
			return sv + " " + name
		}
		return name
	}
	if haveVendor {
		return shortVendor(vendorName) + " " + d
	}
	return v + ":" + d
}

// shortVendor trims the legal boilerplate pci.ids carries:
// "Advanced Micro Devices, Inc. [AMD/ATI]" -> "AMD/ATI", "NVIDIA Corporation" -> "NVIDIA".
func shortVendor(v string) string {
	if i := strings.Index(v, "["); i >= 0 {
		if j := strings.Index(v[i:], "]"); j > 0 {
			return v[i+1 : i+j]
		}
	}
	for _, suffix := range []string{", Inc.", " Inc.", ", Ltd.", " Corporation", " Corp.", " Co., Ltd."} {
		v = strings.TrimSuffix(v, suffix)
	}
	return strings.TrimSpace(v)
}

// ---------------------------------------------------------------- IPMI (optional)
//
// Fans, power supplies and mainboard voltages of a server sit behind the BMC
// and are only reachable through ipmitool. When it is installed and the
// kernel exposes /dev/ipmi0, the sensor data record is read every
// ipmiInterval and folded into the sensor list; otherwise nothing happens.

const ipmiInterval = 5 * time.Minute

var (
	ipmiAt    time.Time
	ipmiCache []Sensor
)

func collectIPMI(now time.Time) []Sensor {
	if !ipmiAt.IsZero() && now.Sub(ipmiAt) < ipmiInterval {
		return ipmiCache
	}
	ipmiAt = now
	ipmiCache = nil
	present := false
	for _, dev := range []string{"/dev/ipmi0", "/dev/ipmi/0", "/dev/ipmidev/0"} {
		if _, err := os.Stat(dev); err == nil {
			present = true
			break
		}
	}
	if !present {
		return nil
	}
	if out, ok := runCmd("ipmitool", "-c", "sdr", "elist"); ok {
		ipmiCache = parseIPMISDR(string(out))
	}
	return ipmiCache
}

// parseIPMISDR reads `ipmitool -c sdr elist` CSV. Analog sensors come as
// four fields, discrete ones as five:
//
//	CPU Temp,29,degrees C,ok
//	FAN1,4800,RPM,ok
//	12V,12.448,Volts,ok
//	FAN4,,,ns
//	PS1 Status,c8h,ok,10.1,Presence detected
//	Chassis Intru,AAh,ok,23.1,
func parseIPMISDR(text string) []Sensor {
	var out []Sensor
	kindOf := func(unit string) (string, string) {
		switch u := strings.ToLower(strings.TrimSpace(unit)); {
		case strings.Contains(u, "degrees c"):
			return "temp", "C"
		case u == "rpm":
			return "fan", "RPM"
		case u == "volts":
			return "volt", "V"
		case u == "watts":
			return "power", "W"
		case u == "amps":
			return "current", "A"
		}
		return "", ""
	}
	for _, line := range strings.Split(text, "\n") {
		f := strings.Split(strings.TrimSpace(line), ",")
		if len(f) < 4 {
			continue
		}
		name := strings.TrimSpace(f[0])
		if len(f) == 4 { // analog: name, value, unit, status
			status := strings.ToLower(strings.TrimSpace(f[3]))
			if status == "ns" || strings.TrimSpace(f[1]) == "" {
				continue
			}
			kind, unit := kindOf(f[2])
			if kind == "" {
				continue
			}
			v, err := strconv.ParseFloat(strings.TrimSpace(f[1]), 64)
			if err != nil {
				continue
			}
			out = append(out, Sensor{Chip: "ipmi", Label: name, Kind: kind, Value: v, Unit: unit, Status: status})
			continue
		}
		// discrete: name, sensor id, status, entity, reading text
		status := strings.ToLower(strings.TrimSpace(f[2]))
		reading := strings.TrimSpace(strings.Join(f[4:], ","))
		lower := strings.ToLower(reading)
		if status == "ns" || reading == "" || lower == "no reading" || lower == "disabled" {
			continue
		}
		if strings.Contains(strings.ToLower(name), "ps") || strings.Contains(lower, "power supply") || strings.Contains(lower, "presence") {
			out = append(out, Sensor{Chip: "ipmi", Label: name, Kind: "psu", Text: reading, Status: status})
			continue
		}
		// Older ipmitool builds put "3500 RPM" style readings here too.
		if fields := strings.Fields(reading); len(fields) >= 2 {
			if kind, unit := kindOf(strings.Join(fields[1:], " ")); kind != "" {
				if v, err := strconv.ParseFloat(fields[0], 64); err == nil {
					out = append(out, Sensor{Chip: "ipmi", Label: name, Kind: kind, Value: v, Unit: unit, Status: status})
				}
			}
		}
	}
	return out
}

func collectSystemHardware() *SystemHardware {
	s := &SystemHardware{Kernel: readFile("/proc/sys/kernel/osrelease"), DisplayAdapters: collectDisplayAdapters()}
	if _, err := os.Stat("/var/run/reboot-required"); err == nil {
		s.RebootRequired = true
	}
	s.Vendor = dmiID("sys_vendor")
	s.Product = dmiID("product_name")
	if s.Vendor == "" && s.Product == "" {
		// Device-tree platforms (Raspberry Pi and other ARM boards) have no
		// SMBIOS at all, so /sys/class/dmi/id does not exist and the machine
		// names itself in the device tree instead. The model string already
		// carries the brand ("Raspberry Pi 4 Model B Rev 1.1"), so it becomes
		// the product on its own rather than being split into vendor + model.
		s.Product = deviceTreeModel()
	}
	if bv, bn := dmiID("board_vendor"), dmiID("board_name"); bn != "" {
		if bv != "" && !strings.HasPrefix(strings.ToLower(bn), strings.ToLower(bv)) && bv != s.Vendor {
			s.Board = bv + " " + bn
		} else {
			s.Board = bn
		}
	}
	if bios := dmiID("bios_version"); bios != "" {
		if date := dmiID("bios_date"); date != "" {
			bios += " (" + date + ")"
		}
		s.BIOS = bios
	}
	return s
}

// deviceTreeModel returns the board name a device-tree platform publishes,
// e.g. "Raspberry Pi 4 Model B Rev 1.1". The kernel NUL-terminates these
// properties, which TrimSpace does not strip.
func deviceTreeModel() string {
	return strings.Trim(readFile("/proc/device-tree/model"), "\x00 ")
}

// fillMMC adds what lsblk cannot report for an SD card or eMMC chip. Their
// identity lives in the card's CID register (exposed as "name" and "serial",
// not the "model" attribute lsblk reads), and calling an SD card an SSD is
// wrong in an inventory: it is the part most likely to wear out.
func fillMMC(d *DiskHardware) {
	base := "/sys/block/" + d.Device + "/device/"
	if d.Model == "" {
		d.Model = readFile(base + "name")
	}
	if d.Serial == "" {
		d.Serial = readFile(base + "serial")
	}
	switch strings.ToUpper(readFile(base + "type")) {
	case "SD":
		d.Type = "sd"
	case "MMC":
		d.Type = "emmc"
	}
	if w, ok := parseMMCLifeTime(readFile(base + "life_time")); ok {
		d.WearPct = &w
	}
}

// parseMMCLifeTime reads the eMMC 5.0 health registers ("0x02 0x01"): each
// area reports its wear in tenths, 0x01 meaning 0-10% consumed and 0x0B
// meaning the reserve is exhausted. The worst area's lower bound is returned
// as a used-percentage, the same quantity the SSD wear rules expect. SD cards
// do not implement this and return no value.
func parseMMCLifeTime(raw string) (float64, bool) {
	var worst uint64
	for _, f := range strings.Fields(raw) {
		v, err := strconv.ParseUint(strings.TrimPrefix(strings.ToLower(f), "0x"), 16, 8)
		if err != nil || v < 1 || v > 0x0B {
			continue
		}
		if v > worst {
			worst = v
		}
	}
	if worst == 0 {
		return 0, false
	}
	return float64(worst-1) * 10, true
}

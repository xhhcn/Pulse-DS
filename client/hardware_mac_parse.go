package main

// Pure parsers for the macOS collectors, kept free of build tags so their
// unit tests run everywhere (hardware_mac_parse_test.go).

import (
	"regexp"
	"strconv"
	"strings"
)

func str(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func items(m map[string]interface{}) []map[string]interface{} {
	raw, ok := m["_items"].([]interface{})
	if !ok {
		return nil
	}
	var out []map[string]interface{}
	for _, r := range raw {
		if mm, ok := r.(map[string]interface{}); ok {
			out = append(out, mm)
		}
	}
	return out
}

// parseSize turns "16 GB" / "494.38 GB" / "1 TB" into bytes (decimal units,
// as system_profiler prints them).
func parseSize(s string) uint64 {
	f := strings.Fields(strings.ReplaceAll(s, ",", ""))
	if len(f) < 2 {
		return 0
	}
	v, err := strconv.ParseFloat(f[0], 64)
	if err != nil {
		return 0
	}
	mult := map[string]float64{"B": 1, "KB": 1e3, "MB": 1e6, "GB": 1e9, "TB": 1e12, "PB": 1e15}[strings.ToUpper(f[1])]
	if mult == 0 {
		return 0
	}
	return uint64(v * mult)
}

func parseMTs(s string) int { // "2667 MHz" -> 2667
	f := strings.Fields(s)
	if len(f) == 0 {
		return 0
	}
	v, _ := strconv.Atoi(f[0])
	return v
}

// macDiskInventory walks the NVMe / SATA / SAS sections for physical disks.
func macDiskInventory(prof map[string][]map[string]interface{}) []DiskHardware {
	var out []DiskHardware
	seen := map[string]bool{}
	var walk func(kind string, list []map[string]interface{})
	walk = func(kind string, list []map[string]interface{}) {
		for _, it := range list {
			bsd := str(it, "bsd_name")
			if bsd != "" && !strings.Contains(strings.TrimPrefix(bsd, "disk"), "s") && !seen[bsd] {
				size, _ := it["size_in_bytes"].(float64)
				if size == 0 {
					size = float64(parseSize(str(it, "size")))
				}
				d := DiskHardware{Device: bsd, Model: str(it, "_name"), Serial: str(it, "device_serial"), SizeBytes: uint64(size), Type: kind}
				if m := str(it, "device_model"); m != "" {
					d.Model = m
				}
				if strings.Contains(strings.ToLower(str(it, "spsata_medium_type")), "solid") {
					d.Type = "ssd"
				}
				switch strings.ToLower(str(it, "smart_status")) {
				case "verified":
					d.SMARTStatus = "passed"
				case "failing":
					d.SMARTStatus = "failed"
				}
				if strings.EqualFold(str(it, "detachable_drive"), "yes") || strings.EqualFold(str(it, "removable_media"), "yes") {
					continue
				}
				seen[bsd] = true
				out = append(out, d)
			}
			walk(kind, items(it))
		}
	}
	walk("nvme", prof["SPNVMeDataType"])
	walk("hdd", prof["SPSerialATADataType"])
	walk("hdd", prof["SPSASDataType"])
	return out
}

// physicalPort reports whether a "Hardware Port" name from networksetup is a
// real wired NIC (or Wi-Fi). Thunderbolt bus ports, USB tethering, VPN and
// bridge members are always "up" without a link and would only produce
// false link-down alerts.
func physicalPort(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	switch {
	case n == "ethernet", strings.HasPrefix(n, "ethernet ") && !strings.Contains(n, "adapter"):
		return true
	case strings.Contains(n, "lan"), strings.Contains(n, "thunderbolt ethernet"), strings.Contains(n, "ethernet slot"):
		return true
	case n == "wi-fi", n == "wifi", n == "airport":
		return true
	}
	return false
}

// appleSiliconMemoryMTs returns the published memory data rate of an Apple
// silicon chip ("Apple M1 Pro" -> 6400). macOS exposes no live figure for
// unified memory, so this is the spec-sheet value and is flagged as such.
func appleSiliconMemoryMTs(chip string) int {
	m := appleChipRe.FindStringSubmatch(chip)
	if m == nil {
		return 0
	}
	gen, tier := m[1], strings.TrimSpace(m[2])
	switch gen {
	case "1":
		if tier == "" {
			return 4266 // LPDDR4X
		}
		return 6400 // LPDDR5
	case "2", "3":
		return 6400 // LPDDR5
	case "4":
		if tier == "" {
			return 7500 // LPDDR5X
		}
		return 8533
	}
	return 0
}

var appleChipRe = regexp.MustCompile(`\bM(\d)\b( Pro| Max| Ultra)?`)

func parseHardwarePorts(text string) map[string]string {
	out := map[string]string{}
	port := ""
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "Hardware Port:"):
			port = strings.TrimSpace(strings.TrimPrefix(line, "Hardware Port:"))
		case strings.HasPrefix(line, "Device:"):
			if dev := strings.TrimSpace(strings.TrimPrefix(line, "Device:")); dev != "" && port != "" {
				out[dev] = port
			}
			port = ""
		}
	}
	return out
}

var (
	ioregStat = regexp.MustCompile(`"([^"]+)"=(\d+)`)
	ioregBSD  = regexp.MustCompile(`"BSD Name" = "(disk\d+)"`)
)

// parseIoregStats reads `ioreg -r -c IOBlockStorageDriver -l -w0`: every
// driver prints a Statistics dictionary followed, deeper in its subtree,
// by the whole-disk IOMedia's BSD name.
func parseIoregStats(text string) map[string]diskSample {
	out := map[string]diskSample{}
	var pending *diskSample
	for _, line := range strings.Split(text, "\n") {
		if strings.Contains(line, `"Statistics" =`) {
			s := diskSample{}
			for _, m := range ioregStat.FindAllStringSubmatch(line, -1) {
				v, _ := strconv.ParseUint(m[2], 10, 64)
				switch m[1] {
				case "Bytes (Read)":
					s.readSectors = v / 512
				case "Bytes (Write)":
					s.writeSectors = v / 512
				case "Operations (Read)":
					s.readIOs = v
				case "Operations (Write)":
					s.writeIOs = v
				case "Total Time (Read)", "Total Time (Write)":
					s.ioMs += v / 1e6 // nanoseconds
				}
			}
			pending = &s
			continue
		}
		if m := ioregBSD.FindStringSubmatch(line); m != nil && pending != nil {
			out[m[1]] = *pending
			pending = nil
		}
	}
	return out
}

var (
	pmTemp = regexp.MustCompile(`(?m)^(.+?) temperature: ([\d.]+) C`)
	pmFan  = regexp.MustCompile(`(?m)^(Fan[^:]*): ([\d.]+) rpm`)
	pmGPU  = regexp.MustCompile(`GPU HW active residency:\s+([\d.]+)%`)
)

func parsePowermetrics(text string) (sensors []Sensor, gpuUtil float64) {
	for _, m := range pmTemp.FindAllStringSubmatch(text, -1) {
		v, _ := strconv.ParseFloat(m[2], 64)
		sensors = append(sensors, Sensor{Chip: "smc", Label: strings.TrimSpace(m[1]), Kind: "temp", Value: v, Unit: "C"})
	}
	for _, m := range pmFan.FindAllStringSubmatch(text, -1) {
		v, _ := strconv.ParseFloat(m[2], 64)
		sensors = append(sensors, Sensor{Chip: "smc", Label: strings.TrimSpace(m[1]), Kind: "fan", Value: v, Unit: "RPM"})
	}
	if m := pmGPU.FindStringSubmatch(text); m != nil {
		gpuUtil, _ = strconv.ParseFloat(m[1], 64)
	}
	return sensors, gpuUtil
}

var (
	ifMedia  = regexp.MustCompile(`media: [^(]*\((\d+)(G?)base`)
	ifStatus = regexp.MustCompile(`status: (\w+)`)
)

func parseIfconfig(text string) (speedMbps int, duplex, oper, admin string) {
	speedMbps = -1
	if m := ifMedia.FindStringSubmatch(text); m != nil {
		v, _ := strconv.Atoi(m[1])
		if m[2] == "G" {
			v *= 1000
		}
		speedMbps = v
	}
	if strings.Contains(text, "<full-duplex>") {
		duplex = "full"
	} else if strings.Contains(text, "<half-duplex>") {
		duplex = "half"
	}
	oper = "unknown"
	if m := ifStatus.FindStringSubmatch(text); m != nil {
		if m[1] == "active" {
			oper = "up"
		} else {
			oper = "down"
		}
	}
	admin = "down"
	if first := strings.SplitN(text, "\n", 2)[0]; strings.Contains(first, "<UP,") || strings.Contains(first, ",UP,") || strings.Contains(first, "<UP>") {
		admin = "up"
	}
	return
}

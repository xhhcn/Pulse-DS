//go:build linux
// +build linux

package main

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// SMBIOS (DMI) readers that need no external tool: the kernel exposes the
// raw structures under /sys/firmware/dmi/entries and the common
// identification strings under /sys/class/dmi/id. Both are root-readable
// only, which is the case for the installed agent.

// dmiMemoryTypes maps the SMBIOS type 17 "Memory Type" byte to a label.
var dmiMemoryTypes = map[byte]string{
	0x0F: "SDRAM", 0x12: "DDR", 0x13: "DDR2", 0x18: "DDR3", 0x1A: "DDR4", 0x1E: "LPDDR4", 0x22: "DDR5", 0x23: "LPDDR5",
	0x1B: "LPDDR", 0x1C: "LPDDR2", 0x1D: "LPDDR3", 0x21: "HBM2",
}

// collectDIMMs walks every SMBIOS "Memory Device" (type 17) structure and
// returns the populated slots. Empty slots (size 0) are skipped.
func collectDIMMs() []DIMMInfo {
	dirs, _ := filepath.Glob("/sys/firmware/dmi/entries/17-*")
	sort.Strings(dirs)
	var out []DIMMInfo
	for _, dir := range dirs {
		raw, err := os.ReadFile(filepath.Join(dir, "raw"))
		if err != nil || len(raw) < 4 {
			continue
		}
		if d, ok := parseDMIMemoryDevice(raw); ok {
			out = append(out, d)
		}
	}
	return out
}

// parseDMIMemoryDevice decodes one raw type 17 structure (formatted section
// followed by the NUL-separated string table). It returns ok=false for
// unpopulated slots and malformed records.
func parseDMIMemoryDevice(raw []byte) (DIMMInfo, bool) {
	var d DIMMInfo
	if len(raw) < 0x15 || raw[0] != 0x11 {
		return d, false
	}
	length := int(raw[1])
	if length < 0x15 || length > len(raw) {
		return d, false
	}
	// String table: strings are NUL-terminated, the table ends with "\0\0".
	var strs []string
	rest := raw[length:]
	for len(rest) > 0 {
		i := strings.IndexByte(string(rest), 0)
		if i < 0 {
			strs = append(strs, strings.TrimSpace(string(rest)))
			break
		}
		if i == 0 {
			break
		}
		strs = append(strs, strings.TrimSpace(string(rest[:i])))
		rest = rest[i+1:]
	}
	str := func(idx byte) string {
		if idx == 0 || int(idx) > len(strs) {
			return ""
		}
		s := strs[idx-1]
		switch strings.ToLower(s) {
		case "unknown", "not specified", "none", "no dimm", "n/a", "undefined", "not available":
			return ""
		}
		return s
	}
	u16 := func(off int) uint16 {
		if off+2 > length {
			return 0
		}
		return binary.LittleEndian.Uint16(raw[off:])
	}
	size := u16(0x0C)
	switch {
	case size == 0 || size == 0xFFFF:
		return d, false
	case size == 0x7FFF && length >= 0x20:
		d.SizeBytes = uint64(binary.LittleEndian.Uint32(raw[0x1C:])&0x7FFFFFFF) << 20
	case size&0x8000 != 0:
		d.SizeBytes = uint64(size&0x7FFF) << 10 // unit is KB
	default:
		d.SizeBytes = uint64(size) << 20
	}
	totalWidth, dataWidth := u16(0x08), u16(0x0A)
	d.ECC = totalWidth != 0 && totalWidth != 0xFFFF && dataWidth != 0 && dataWidth != 0xFFFF && totalWidth > dataWidth
	d.Locator = str(raw[0x10])
	if t, ok := dmiMemoryTypes[raw[0x12]]; ok {
		d.Type = t
	}
	d.SpeedMTs = int(u16(0x15))
	if length > 0x17 {
		d.Manufacturer = str(raw[0x17])
	}
	if length > 0x1A {
		d.PartNumber = str(raw[0x1A])
	}
	if length > 0x1B {
		d.Rank = int(raw[0x1B] & 0x0F)
	}
	if length >= 0x22 {
		d.ConfiguredMTs = int(u16(0x20))
	}
	if d.SpeedMTs == 0xFFFF {
		d.SpeedMTs = 0
	}
	if d.ConfiguredMTs == 0xFFFF {
		d.ConfiguredMTs = 0
	}
	return d, true
}

// dmiID reads one /sys/class/dmi/id attribute, dropping placeholder values.
func dmiID(name string) string {
	v := strings.TrimSpace(readFile("/sys/class/dmi/id/" + name))
	if dmiPlaceholder(v) {
		return ""
	}
	return v
}

// dmiPlaceholder reports the strings vendors leave in SMBIOS fields they
// never programmed. "0123456789" is what Supermicro boards carry as the
// product serial until the integrator writes one, so showing it as an asset
// identifier would be worse than showing nothing.
func dmiPlaceholder(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", "unknown", "to be filled by o.e.m.", "default string", "not specified", "not available", "n/a", "none", "empty",
		"system product name", "system manufacturer", "system serial number", "serial number", "system version",
		"0", "0123456789", "1234567890", "00000000", "xxxxxxxx":
		return true
	}
	return false
}

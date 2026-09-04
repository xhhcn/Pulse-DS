package main

// Hardware collection, OS-independent part: the background collector loop,
// the once-per-collection push handshake, the S.M.A.R.T. parser shared by
// every platform that can run smartctl, and small helpers. The per-OS
// collectors (hardware_linux.go, hardware_windows.go, hardware_darwin.go)
// each provide collectHardware(); platforms without one return nil and the
// server keeps treating them as plain agents.

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	hardwareInterval   = 60 * time.Second
	hardwareCmdTimeout = 8 * time.Second
	// S.M.A.R.T. attributes move slowly; polling smartctl every cycle would
	// be the single most expensive thing the probe does on a box with many
	// spinning disks, so the SMART part of a disk entry is cached.
	smartInterval = 5 * time.Minute
)

var (
	hwMu       sync.RWMutex
	hwLatest   *HardwareInfo
	hwPushedAt time.Time // CollectedAt of the last snapshot the server acknowledged

	hwSmartAt    time.Time
	hwSmartCache = map[string]DiskHardware{}

	hwPrevDisk   = map[string]diskSample{}
	hwPrevNet    = map[string]netSample{}
	hwPrevSample time.Time
)

type diskSample struct {
	readIOs, readSectors, writeIOs, writeSectors, ioMs uint64
}

type netSample struct {
	rx, tx uint64
}

func startHardwareCollector() {
	go func() {
		// First pass shortly after start so the first pushes already carry
		// hardware; then every hardwareInterval.
		time.Sleep(5 * time.Second)
		first := true
		for {
			snap := collectHardware()
			hwMu.Lock()
			hwLatest = snap
			hwMu.Unlock()
			if first {
				logHardwareSummary(snap)
				first = false
			}
			time.Sleep(hardwareInterval)
		}
	}()
}

// currentHardware returns the latest snapshot only until the server has
// acknowledged it. The server keeps the previous snapshot when a push omits
// the field, so hardware travels once per collection instead of with every
// 3-second metric push.
func currentHardware() *HardwareInfo {
	hwMu.RLock()
	defer hwMu.RUnlock()
	if hwLatest == nil || !hwLatest.CollectedAt.After(hwPushedAt) {
		return nil
	}
	return hwLatest
}

// markHardwarePushed records that the snapshot collected at t reached the server.
func markHardwarePushed(t time.Time) {
	hwMu.Lock()
	if t.After(hwPushedAt) {
		hwPushedAt = t
	}
	hwMu.Unlock()
}

// ---------------------------------------------------------------- helpers

func runCmd(name string, args ...string) ([]byte, bool) {
	if _, err := exec.LookPath(name); err != nil {
		// Under sudo / launchd the PATH rarely contains Homebrew; look there
		// too so `brew install smartmontools` is all a Mac needs.
		found := ""
		if runtime.GOOS == "darwin" {
			for _, dir := range []string{"/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin"} {
				if _, err := os.Stat(dir + "/" + name); err == nil {
					found = dir + "/" + name
					break
				}
			}
		}
		if found == "" {
			return nil, false
		}
		name = found
	}
	ctx, cancel := context.WithTimeout(context.Background(), hardwareCmdTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	// smartctl returns non-zero exit codes for informational bits while
	// still printing a full report; keep the output whenever there is any.
	if len(out) == 0 && err != nil {
		return nil, false
	}
	return out, true
}

// logHardwareSummary prints, once, what the first snapshot contained so an
// operator can see at a glance which sources work on this host.
func logHardwareSummary(hw *HardwareInfo) {
	if hw == nil {
		log.Printf("🧩 hardware: no collector for this platform")
		return
	}
	cpu := "-"
	if hw.CPU != nil {
		cpu = hw.CPU.Model
	}
	dimms := 0
	if hw.Memory != nil {
		dimms = len(hw.Memory.DIMMs)
	}
	adapters := 0
	if hw.System != nil {
		adapters = len(hw.System.DisplayAdapters)
	}
	log.Printf("🧩 hardware: cpu=%q dimms=%d disks=%d filesystems=%d nics=%d sensors=%d gpus=%d display-adapters=%d", cpu, dimms, len(hw.Disks), len(hw.Filesystems), len(hw.Network), len(hw.Sensors), len(hw.GPUs), adapters)
}

// collectNvidiaGPUs reads live counters through nvidia-smi (Linux and
// Windows ship it with the driver).
func collectNvidiaGPUs() []GPUInfo {
	out, ok := runCmd("nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits")
	if !ok {
		return nil
	}
	var gpus []GPUInfo
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Split(line, ",")
		if len(f) < 5 {
			continue
		}
		num := func(s string) float64 { v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64); return v }
		gpus = append(gpus, GPUInfo{Name: strings.TrimSpace(f[0]), UtilPct: num(f[1]), MemUsedMB: num(f[2]), MemTotalMB: num(f[3]), TempC: num(f[4])})
	}
	return gpus
}

// ---------------------------------------------------------------- S.M.A.R.T.

// copySMART carries the cached S.M.A.R.T. fields over to a fresh disk entry
// (the IO rates are recomputed every cycle from /proc/diskstats).
func copySMART(dst *DiskHardware, src DiskHardware) {
	dst.SMARTStatus = src.SMARTStatus
	dst.TempC = src.TempC
	dst.PowerOnHours = src.PowerOnHours
	dst.Reallocated = src.Reallocated
	dst.Pending = src.Pending
	dst.WearPct = src.WearPct
	dst.SpareAvailPct = src.SpareAvailPct
	dst.MediaErrors = src.MediaErrors
	dst.WrittenBytes = src.WrittenBytes
}

// applySMART fills the S.M.A.R.T. fields from `smartctl -j` when smartctl is
// installed and the device answers (virtual disks usually do not).
func applySMART(d *DiskHardware, devicePath string) {
	out, ok := runCmd("smartctl", "-j", "-H", "-A", devicePath)
	if !ok {
		return
	}
	parseSmartctlJSON(out, d)
}

func parseSmartctlJSON(out []byte, d *DiskHardware) {
	var r struct {
		SmartStatus *struct {
			Passed bool `json:"passed"`
		} `json:"smart_status"`
		Temperature *struct {
			Current float64 `json:"current"`
		} `json:"temperature"`
		PowerOnTime *struct {
			Hours int64 `json:"hours"`
		} `json:"power_on_time"`
		ATA *struct {
			Table []struct {
				ID    int    `json:"id"`
				Name  string `json:"name"`
				Value int64  `json:"value"` // normalised (100 = new)
				Raw   struct {
					Value int64 `json:"value"`
				} `json:"raw"`
			} `json:"table"`
		} `json:"ata_smart_attributes"`
		NVMe *struct {
			PercentageUsed   *float64 `json:"percentage_used"`
			AvailableSpare   *float64 `json:"available_spare"`
			MediaErrors      *int64   `json:"media_errors"`
			Temperature      *float64 `json:"temperature"`
			PowerOnHours     *int64   `json:"power_on_hours"`
			DataUnitsWritten *uint64  `json:"data_units_written"`
		} `json:"nvme_smart_health_information_log"`
	}
	if err := json.Unmarshal(out, &r); err != nil {
		return
	}
	if r.SmartStatus != nil {
		if r.SmartStatus.Passed {
			d.SMARTStatus = "passed"
		} else {
			d.SMARTStatus = "failed"
		}
	}
	if r.Temperature != nil && r.Temperature.Current > 0 {
		t := r.Temperature.Current
		d.TempC = &t
	}
	if r.PowerOnTime != nil && r.PowerOnTime.Hours > 0 {
		h := r.PowerOnTime.Hours
		d.PowerOnHours = &h
	}
	if r.ATA != nil {
		for _, a := range r.ATA.Table {
			// Raw values of some attributes pack several counters; the low 16
			// bits hold the count for 5/197 on every vendor we care about.
			v := a.Raw.Value & 0xffff
			switch a.ID {
			case 5:
				d.Reallocated = &v
			case 197:
				d.Pending = &v
			}
			if d.WearPct == nil {
				if life, ok := ssdLifeLeft(a.Name, a.Value, a.Raw.Value); ok {
					wear := 100 - life
					d.WearPct = &wear
				}
			}
		}
	}
	if r.NVMe != nil {
		d.WearPct = r.NVMe.PercentageUsed
		d.SpareAvailPct = r.NVMe.AvailableSpare
		d.MediaErrors = r.NVMe.MediaErrors
		if d.TempC == nil && r.NVMe.Temperature != nil && *r.NVMe.Temperature > 0 {
			d.TempC = r.NVMe.Temperature
		}
		if d.PowerOnHours == nil && r.NVMe.PowerOnHours != nil {
			d.PowerOnHours = r.NVMe.PowerOnHours
		}
		if r.NVMe.DataUnitsWritten != nil {
			d.WrittenBytes = *r.NVMe.DataUnitsWritten * 512000 // spec: units of 1000 × 512 bytes
		}
	}
}

// ssdLifeLeft interprets the vendor-specific ATA attributes that express SSD
// endurance and returns the remaining life in percent. Attribute names are
// the ones smartctl prints, so this is independent of numeric ids that
// vendors reuse for unrelated counters.
func ssdLifeLeft(name string, normalised, raw int64) (float64, bool) {
	n := strings.ToLower(name)
	pct := func(v int64) (float64, bool) {
		if v >= 0 && v <= 100 {
			return float64(v), true
		}
		return 0, false
	}
	switch {
	case strings.Contains(n, "ssd_lifeleft(0.01%)"):
		if raw >= 0 && raw <= 10000 {
			return float64(raw) / 100, true
		}
	case strings.Contains(n, "drive_life_remaining"), strings.Contains(n, "percent_lifetime_remain"),
		strings.Contains(n, "remaining_lifetime_perc"), strings.Contains(n, "perc_rated_life_remain"),
		strings.Contains(n, "ssd_life_left"), strings.Contains(n, "remaining_life"):
		if v, ok := pct(raw); ok && raw > 0 {
			return v, true
		}
		return pct(normalised)
	case strings.Contains(n, "percent_lifetime_used"), strings.Contains(n, "percentage_used"):
		if v, ok := pct(raw); ok {
			return 100 - v, true
		}
	case strings.Contains(n, "media_wearout_indicator"), strings.Contains(n, "wear_leveling_count"),
		strings.Contains(n, "ssd_wear_indicator"), strings.Contains(n, "wear_indicator"):
		return pct(normalised)
	}
	return 0, false
}

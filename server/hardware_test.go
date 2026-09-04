package main

import (
	"strings"
	"testing"
	"time"
)

func f64(v float64) *float64 { return &v }
func i64(v int64) *int64     { return &v }

func TestEvaluateHealthVerdicts(t *testing.T) {
	now := time.Now()
	if r := evaluateHealth(nil, now); r.Level != HealthUnknown || r.Issues != nil {
		t.Fatalf("nil snapshot: %s %v", r.Level, r.Issues)
	}
	healthy := &HardwareInfo{CollectedAt: now,
		CPU: &CPUHardware{Threads: 16}, Load: []float64{3, 2, 1},
		Disks:       []DiskHardware{{Device: "nvme0n1", Type: "nvme", SMARTStatus: "passed", TempC: f64(41), WearPct: f64(3), SpareAvailPct: f64(100), MediaErrors: i64(0)}},
		Filesystems: []FilesystemInfo{{Mount: "/", UsedPct: 40}},
		RAID:        []RAIDArray{{Name: "md0", Level: "raid1", DisksTotal: 2, DisksActive: 2}},
		Network:     []NetInterface{{Name: "eno1", SpeedMbps: 10000, Duplex: "full", OperState: "up"}},
		Memory:      &MemoryHardware{ECCSupported: true},
	}
	if r := evaluateHealth(healthy, now); r.Level != HealthOK || len(r.Issues) != 0 || r.Critical != 0 {
		t.Fatalf("healthy box: %s %v", r.Level, r.Issues)
	}

	warn := &HardwareInfo{CollectedAt: now,
		Disks:       []DiskHardware{{Device: "sda", SMARTStatus: "passed", Reallocated: i64(12), TempC: f64(88)}, {Device: "sdb", Type: "ssd", SMARTStatus: "passed", WearPct: f64(94)}},
		Filesystems: []FilesystemInfo{{Mount: "/data", UsedPct: 91}},
		Network: []NetInterface{
			{Name: "eno1", SpeedMbps: 100, Duplex: "half", OperState: "up"},
			{Name: "eno2", OperState: "down", AdminState: "down"}, // spare port: silent
			{Name: "eno3", OperState: "down", AdminState: "up"},   // configured, no carrier: alert
			{Name: "eno4", OperState: "down", RxBytes: 10},        // old probe, port was in use: alert
			{Name: "eno5", OperState: "down"},                     // old probe, never used: silent
		},
		Sensors: []Sensor{
			{Chip: "coretemp", Label: "Package id 0", Kind: "temp", Value: 90},
			{Chip: "ipmi", Label: "FAN2", Kind: "fan", Value: 0, Unit: "RPM", Status: "ok"},           // stopped fan: warn
			{Chip: "ipmi", Label: "FAN1", Kind: "fan", Value: 3500, Unit: "RPM", Status: "ok"},        // fine
			{Chip: "ipmi", Label: "PS1 Status", Kind: "psu", Text: "Presence detected", Status: "ok"}, // fine
		},
	}
	r := evaluateHealth(warn, now)
	if r.Level != HealthWarn || len(r.Issues) != 10 || r.Critical != 0 {
		t.Fatalf("warn box: %s %v", r.Level, r.Issues)
	}
	joinedWarn := strings.Join(r.Issues, "\n")
	if !strings.Contains(joinedWarn, "eno3 链路 down") || !strings.Contains(joinedWarn, "eno4 链路 down") || strings.Contains(joinedWarn, "eno2") || strings.Contains(joinedWarn, "eno5") {
		t.Fatalf("link-down rule: %v", r.Issues)
	}
	if !strings.Contains(strings.Join(r.Issues, "\n"), "剩余寿命仅 6%") {
		t.Fatalf("ssd life warning missing: %v", r.Issues)
	}

	crit := &HardwareInfo{CollectedAt: now.Add(-20 * time.Minute),
		Disks:  []DiskHardware{{Device: "sdb", SMARTStatus: "FAILED"}},
		RAID:   []RAIDArray{{Name: "md1", Level: "raid5", DisksTotal: 4, DisksActive: 3, Degraded: true, RebuildPct: f64(12.5)}},
		Memory: &MemoryHardware{ECCUncorrectable: 2, ECCCorrectable: 40},
		ZFS:    []ZFSPool{{Name: "tank", State: "DEGRADED", Errors: 3}},
		Sensors: []Sensor{
			{Chip: "ipmi", Label: "PS2 Status", Kind: "psu", Text: "Presence detected, Failure detected", Status: "cr"},
			{Chip: "ipmi", Label: "12V", Kind: "volt", Value: 10.9, Unit: "V", Status: "nc"},
		},
	}
	r = evaluateHealth(crit, now)
	issues, en := r.Issues, r.IssuesEN
	if r.Level != HealthCritical {
		t.Fatalf("critical box: %s %v", r.Level, issues)
	}
	// sdb FAILED, md1 degraded, ECC uncorrectable, tank degraded, PSU failure = 5 critical
	if r.Critical != 5 || len(issues) <= r.Critical {
		t.Fatalf("critical count: got %d of %d", r.Critical, len(issues))
	}
	joined := strings.Join(issues, "\n")
	for _, want := range []string{"FAILED", "md1 (raid5) 降级 3/4", "重建 12.5%", "不可纠正错误 2", "tank 降级", "未更新", "电源 PS2 Status: Presence detected, Failure detected", "电压 12V: 10.9 V"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("issue list missing %q:\n%s", want, joined)
		}
	}
	if len(en) != len(issues) || !strings.Contains(strings.Join(en, "\n"), "S.M.A.R.T. overall health FAILED") || !strings.Contains(strings.Join(en, "\n"), "degraded 3/4") {
		t.Fatalf("english issue list should mirror the chinese one: %v", en)
	}
	// critical issues are listed before warnings
	if !strings.Contains(issues[0], "FAILED") && !strings.Contains(issues[0], "降级") && !strings.Contains(issues[0], "不可纠正") {
		t.Fatalf("critical issues must come first, got %q", issues[0])
	}
}

func TestMaskHardwareForPublicStripsSerialsWithoutTouchingOriginal(t *testing.T) {
	hw := &HardwareInfo{Disks: []DiskHardware{{Device: "sda", Serial: "S3Z9NB0K123456"}}, System: &SystemHardware{Product: "Super Server", Serial: "S1234567890"}}
	masked := maskHardwareForPublic(hw)
	if masked.Disks[0].Serial != "" {
		t.Fatalf("serial not masked")
	}
	if hw.Disks[0].Serial == "" {
		t.Fatalf("original snapshot was mutated")
	}
	if masked.System.Serial != "" {
		t.Fatalf("chassis serial leaked to the public view")
	}
	if masked.System.Product != "Super Server" {
		t.Fatalf("the machine model is public information: %q", masked.System.Product)
	}
	if hw.System.Serial == "" {
		t.Fatalf("original system snapshot was mutated")
	}
	if maskHardwareForPublic(nil) != nil {
		t.Fatalf("nil must stay nil")
	}
}

func TestApplyHardwareKeepsPreviousSnapshotWhenAgentOmitsIt(t *testing.T) {
	prev := &HardwareInfo{CollectedAt: time.Now(), Disks: []DiskHardware{{Device: "sda", SMARTStatus: "failed"}}}
	existing := &SystemMetric{ID: "a", Hardware: prev, Health: HealthCritical}
	var m SystemMetric
	applyHardware(&m, nil, existing)
	if m.Hardware != prev || m.Health != HealthCritical || len(m.HealthIssues) == 0 {
		t.Fatalf("previous snapshot not kept: %+v", m)
	}
	fresh := &HardwareInfo{Disks: []DiskHardware{{Device: "sda", SMARTStatus: "passed"}}}
	applyHardware(&m, fresh, existing)
	if m.Hardware != fresh || m.Health != HealthOK || m.Hardware.CollectedAt.IsZero() {
		t.Fatalf("fresh snapshot not applied: %+v", m)
	}
}

func TestErrorCountersAlertOnGrowthNotOnLifetimeTotals(t *testing.T) {
	now := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	snap := func(rxErr uint64, ecc int64) *HardwareInfo {
		return &HardwareInfo{CollectedAt: now,
			Network: []NetInterface{{Name: "eno1", SpeedMbps: 1000, Duplex: "full", OperState: "up", RxErrors: rxErr}},
			Memory:  &MemoryHardware{ECCSupported: true, ECCCorrectable: ecc},
		}
	}
	// A port that logged 244513 errors since boot but adds none is healthy.
	first := snap(244513, 40)
	carryCounters(first, nil, now)
	if r := evaluateHealth(first, now); len(r.Issues) != 0 {
		t.Fatalf("lifetime totals must not alert: %v", r.Issues)
	}
	// 30 more errors a minute later: growing, but under the threshold.
	second := snap(244543, 40)
	carryCounters(second, first, now.Add(time.Minute))
	if second.Network[0].ErrRecent != 30 || len(evaluateHealth(second, now.Add(time.Minute)).Issues) != 0 {
		t.Fatalf("small growth: recent=%d issues=%v", second.Network[0].ErrRecent, evaluateHealth(second, now).Issues)
	}
	// 60 within the window: alert, with the growth and the total in the text.
	third := snap(244603, 52)
	carryCounters(third, second, now.Add(2*time.Minute))
	r := evaluateHealth(third, now.Add(2*time.Minute))
	joined := strings.Join(r.Issues, "\n")
	if !strings.Contains(joined, "eno1 错误持续增加：近 20 分钟 +90（累计 244603）") || !strings.Contains(joined, "ECC 可纠正错误持续增加：近 24 小时 +12（累计 52）") {
		t.Fatalf("growth alerts missing: %v", r.Issues)
	}
	// The window rolls over: the last window's growth still counts once ...
	fourth := snap(244603, 52)
	carryCounters(fourth, third, now.Add(11*time.Minute))
	if fourth.Network[0].ErrRecent != 90 || fourth.Network[0].ErrTrack.Prev != 90 {
		t.Fatalf("rollover should carry the closed window: %+v", fourth.Network[0])
	}
	// ... and after a second quiet window the alert clears.
	fifth := snap(244603, 52)
	carryCounters(fifth, fourth, now.Add(22*time.Minute))
	if fifth.Network[0].ErrRecent != 0 || strings.Contains(strings.Join(evaluateHealth(fifth, now.Add(22*time.Minute)).Issues, "\n"), "eno1") {
		t.Fatalf("alert should clear once errors stop: %+v", fifth.Network[0])
	}
	// A counter reset (reboot) opens a fresh window instead of a bogus burst.
	sixth := snap(5, 0)
	carryCounters(sixth, fifth, now.Add(23*time.Minute))
	if sixth.Network[0].ErrRecent != 0 || sixth.Network[0].ErrTrack.Base != 5 || sixth.Memory.ECCRecent != 0 {
		t.Fatalf("counter reset: %+v %+v", sixth.Network[0], sixth.Memory)
	}
}

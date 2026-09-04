//go:build linux
// +build linux

package main

import (
	"strings"
	"testing"
)

func TestParseMdstat(t *testing.T) {
	sample := `Personalities : [raid1] [raid6] [raid5] [raid4]
md0 : active raid1 sdb1[1] sda1[0]
      1953382464 blocks super 1.2 [2/2] [UU]
      bitmap: 0/15 pages [0KB], 65536KB chunk

md1 : active raid5 sdd1[3] sdc1[2] sdb2[1]
      5860147200 blocks super 1.2 level 5, 512k chunk, algorithm 2 [4/3] [UUU_]
      [====>................]  recovery = 24.6% (480/1953) finish=12.3min speed=100000K/sec

md2 : inactive sde1[0](S)
      976630464 blocks super 1.2

unused devices: <none>`
	arrays := parseMdstat(sample)
	if len(arrays) != 3 {
		t.Fatalf("got %d arrays: %+v", len(arrays), arrays)
	}
	a := arrays[0]
	if a.Name != "md0" || a.Level != "raid1" || a.DisksTotal != 2 || a.DisksActive != 2 || a.Degraded || a.RebuildPct != nil {
		t.Fatalf("md0 parsed wrong: %+v", a)
	}
	b := arrays[1]
	if b.Name != "md1" || b.Level != "raid5" || b.DisksTotal != 4 || b.DisksActive != 3 || !b.Degraded || b.RebuildPct == nil || *b.RebuildPct != 24.6 {
		t.Fatalf("md1 parsed wrong: %+v", b)
	}
	if c := arrays[2]; c.Name != "md2" || !c.Degraded || c.State != "inactive" {
		t.Fatalf("md2 parsed wrong: %+v", c)
	}
	if parseMdstat("") != nil {
		t.Fatalf("empty mdstat must yield nil")
	}
}

func TestParseSmartctlJSON(t *testing.T) {
	ata := []byte(`{"smart_status":{"passed":true},"temperature":{"current":38},"power_on_time":{"hours":21345},
	  "ata_smart_attributes":{"table":[{"id":5,"name":"Reallocated_Sector_Ct","raw":{"value":3}},{"id":197,"name":"Current_Pending_Sector","raw":{"value":0}},{"id":194,"raw":{"value":38}}]}}`)
	var d DiskHardware
	parseSmartctlJSON(ata, &d)
	if d.SMARTStatus != "passed" || d.TempC == nil || *d.TempC != 38 || d.PowerOnHours == nil || *d.PowerOnHours != 21345 {
		t.Fatalf("ata basics wrong: %+v", d)
	}
	if d.Reallocated == nil || *d.Reallocated != 3 || d.Pending == nil || *d.Pending != 0 || d.WearPct != nil {
		t.Fatalf("ata attributes wrong: %+v", d)
	}

	nvme := []byte(`{"smart_status":{"passed":false},"nvme_smart_health_information_log":{"percentage_used":7,"available_spare":100,"media_errors":0,"temperature":44,"power_on_hours":9876}}`)
	var n DiskHardware
	parseSmartctlJSON(nvme, &n)
	if n.SMARTStatus != "failed" || n.WearPct == nil || *n.WearPct != 7 || n.SpareAvailPct == nil || *n.SpareAvailPct != 100 {
		t.Fatalf("nvme wrong: %+v", n)
	}
	if n.TempC == nil || *n.TempC != 44 || n.PowerOnHours == nil || *n.PowerOnHours != 9876 || n.MediaErrors == nil || *n.MediaErrors != 0 {
		t.Fatalf("nvme fallbacks wrong: %+v", n)
	}

	var g DiskHardware
	parseSmartctlJSON([]byte("not json"), &g)
	if g.SMARTStatus != "" {
		t.Fatalf("garbage must leave the disk untouched: %+v", g)
	}
}

func TestParseDiskstats(t *testing.T) {
	sample := ` 254       0 vda 42433 9761 3001230 10743 17700896 3538658 195792256 49707657 0 6098172 50001019 0 0 0 0 2074539 282618
 259       0 nvme0n1 100 0 800 5 200 0 1600 7 0 300 12 0 0 0 0 0 0`
	st := parseDiskstats(sample)
	if len(st) != 2 {
		t.Fatalf("got %d entries", len(st))
	}
	if s := st["nvme0n1"]; s.readIOs != 100 || s.readSectors != 800 || s.writeIOs != 200 || s.writeSectors != 1600 || s.ioMs != 300 {
		t.Fatalf("nvme0n1 parsed wrong: %+v", s)
	}
}

func TestCollectHardwareNeverPanicsOnThisHost(t *testing.T) {
	hw := collectHardware()
	if hw == nil || hw.CollectedAt.IsZero() {
		t.Fatalf("snapshot missing: %+v", hw)
	}
	if hw.Load == nil || len(hw.Load) != 3 {
		t.Fatalf("load average not collected: %+v", hw.Load)
	}
	if hw.System == nil || hw.System.Kernel == "" {
		t.Fatalf("kernel not collected: %+v", hw.System)
	}
}

func TestParseDMIMemoryDevice(t *testing.T) {
	// Raw SMBIOS type 17 record captured from a Supermicro X11SSL-F
	// (16 GB DDR4-2667 ECC UDIMM running at 2133 MT/s).
	raw := []byte{
		0x11, 0x28, 0x2f, 0x00, 0x2e, 0x00, 0xfe, 0xff, 0x48, 0x00, 0x40, 0x00, 0x00, 0x40, 0x09, 0x00,
		0x01, 0x02, 0x1a, 0x80, 0x00, 0x6b, 0x0a, 0x03, 0x04, 0x05, 0x06, 0x02, 0x00, 0x00, 0x00, 0x00,
		0x55, 0x08, 0xb0, 0x04, 0xb0, 0x04, 0xb0, 0x04,
	}
	raw = append(raw, []byte("DIMMA1\x00P0_Node0_Channel0_Dimm0\x00Micron\x002A4E56B2\x00DIMMA1_AssetTag\x0018ASF2G72AZ-2G6E1\x00\x00")...)
	d, ok := parseDMIMemoryDevice(raw)
	if !ok {
		t.Fatal("record not parsed")
	}
	if d.SizeBytes != 16<<30 || d.Type != "DDR4" || d.SpeedMTs != 2667 || d.ConfiguredMTs != 2133 || !d.ECC {
		t.Fatalf("unexpected dimm: %+v", d)
	}
	if d.Locator != "DIMMA1" || d.Manufacturer != "Micron" || d.PartNumber != "18ASF2G72AZ-2G6E1" || d.Rank != 2 {
		t.Fatalf("unexpected strings: %+v", d)
	}
	empty := append([]byte{}, raw...)
	empty[0x0C], empty[0x0D] = 0, 0
	if _, ok := parseDMIMemoryDevice(empty); ok {
		t.Fatal("empty slot must be skipped")
	}
}

func TestParseIPMISDR(t *testing.T) {
	// Real ipmitool 1.8.19 output (Supermicro X11SSL-F) plus the older five-field analog form.
	in := "CPU Temp,29,degrees C,ok\nFAN1,4800,RPM,ok\nFAN4,,,ns\nDIMMB1 Temp,,,ns\n12V,12.448,Volts,ok\nVBMC 1.2V,1.227,Volts,nc\nChassis Intru,AAh,ok,23.1,\nPS1 Status,c8h,ok,10.1,Presence detected\nPS2 Status,c9h,cr,10.2,Presence detected, Failure detected\nFAN2,42h,ok,29.2,3500 RPM\n"
	got := parseIPMISDR(in)
	if len(got) != 7 {
		t.Fatalf("want 7 sensors, got %d: %+v", len(got), got)
	}
	if got[0].Kind != "temp" || got[0].Value != 29 || got[1].Kind != "fan" || got[1].Value != 4800 || got[1].Status != "ok" {
		t.Fatalf("analog: %+v %+v", got[0], got[1])
	}
	if got[2].Kind != "volt" || got[2].Value != 12.448 || got[3].Status != "nc" {
		t.Fatalf("volts: %+v %+v", got[2], got[3])
	}
	if got[4].Kind != "psu" || got[4].Text != "Presence detected" || got[5].Status != "cr" || got[5].Text != "Presence detected, Failure detected" {
		t.Fatalf("psu: %+v %+v", got[4], got[5])
	}
	if got[6].Kind != "fan" || got[6].Value != 3500 {
		t.Fatalf("legacy analog row: %+v", got[6])
	}
}

func TestParsePCIIDs(t *testing.T) {
	db := "#\n# comment\n1a03  ASPEED Technology, Inc.\n\t2000  ASPEED Graphics Family\n\t\t15d9 0832  X11 board\n10de  NVIDIA Corporation\n\t2204  GA102 [GeForce RTX 3090]\n1002  Advanced Micro Devices, Inc. [AMD/ATI]\n\t744c  Navi 31 [Radeon RX 7900 XT/7900 XTX]\nC 03  Display controller\n\t00  VGA compatible controller\n"
	parsePCIIDs(strings.NewReader(db))
	pciIDsOnce.Do(func() {}) // already populated; keep loadPCIIDs from overriding in tests
	for in, want := range map[[2]string]string{
		{"0x1a03", "0x2000"}: "ASPEED Graphics Family",
		{"0x10de", "0x2204"}: "NVIDIA GA102 [GeForce RTX 3090]",
		{"0x1002", "0x744c"}: "AMD/ATI Navi 31 [Radeon RX 7900 XT/7900 XTX]",
		{"0x10de", "0xffff"}: "NVIDIA ffff",
		{"0xfff1", "0xbeef"}: "fff1:beef",
	} {
		if got := pciName(in[0], in[1]); got != want {
			t.Fatalf("pciName(%v) = %q, want %q", in, got, want)
		}
	}
	if _, ok := pciDevices["1a03:0832"]; ok {
		t.Fatalf("subsystem line must not be recorded as a device")
	}
}

func TestAdminState(t *testing.T) {
	for in, want := range map[string]string{"0x1003\n": "up", "0x1002": "down", "": "", "junk": ""} {
		if got := adminState(in); got != want {
			t.Fatalf("adminState(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSSDLifeLeft(t *testing.T) {
	cases := []struct {
		name   string
		norm   int64
		raw    int64
		want   float64
		wantOK bool
	}{
		{"SSD_LifeLeft(0.01%)", 100, 9147, 91.47, true},
		{"Drive_Life_Remaining%", 92, 92, 92, true},
		{"Percent_Lifetime_Remain", 97, 97, 97, true},
		{"Media_Wearout_Indicator", 95, 0, 95, true},
		{"Wear_Leveling_Count", 99, 12, 99, true},
		{"Percent_Lifetime_Used", 100, 3, 97, true},
		{"Reallocated_Sector_Ct", 100, 0, 0, false},
	}
	for _, c := range cases {
		got, ok := ssdLifeLeft(c.name, c.norm, c.raw)
		if ok != c.wantOK || (ok && got != c.want) {
			t.Fatalf("%s: got %v %v want %v %v", c.name, got, ok, c.want, c.wantOK)
		}
	}
}

func TestParseMMCLifeTime(t *testing.T) {
	for raw, want := range map[string]float64{
		"0x01 0x01": 0,  // brand new
		"0x02 0x01": 10, // 10-20% of area A consumed
		"0x03 0x05": 40, // the worst area decides
		"0x0b 0x01": 100,
	} {
		got, ok := parseMMCLifeTime(raw)
		if !ok || got != want {
			t.Fatalf("parseMMCLifeTime(%q) = %v, %v; want %v", raw, got, ok, want)
		}
	}
	// SD cards do not implement the registers, and 0x00 means "not defined".
	for _, raw := range []string{"", "0x00 0x00", "junk"} {
		if v, ok := parseMMCLifeTime(raw); ok {
			t.Fatalf("parseMMCLifeTime(%q) should report nothing, got %v", raw, v)
		}
	}
}

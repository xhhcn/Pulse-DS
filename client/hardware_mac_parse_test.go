package main

import (
	"encoding/json"
	"testing"
)

func TestParseSizeAndMTs(t *testing.T) {
	for in, want := range map[string]uint64{"16 GB": 16e9, "494.38 GB": 494380000000, "1 TB": 1e12, "512 MB": 512e6, "": 0, "n/a": 0} {
		if got := parseSize(in); got != want {
			t.Fatalf("parseSize(%q) = %d, want %d", in, got, want)
		}
	}
	if parseMTs("2667 MHz") != 2667 || parseMTs("") != 0 {
		t.Fatalf("parseMTs")
	}
}

func TestMacDiskInventory(t *testing.T) {
	raw := `{
	  "SPNVMeDataType": [{"_name": "NVMExpress", "_items": [
	    {"_name": "APPLE SSD AP0512Z", "bsd_name": "disk0", "size": "494.38 GB", "size_in_bytes": 494384795648,
	     "smart_status": "Verified", "detachable_drive": "No", "removable_media": "no",
	     "volumes": [{"_name": "Container", "bsd_name": "disk0s2", "size_in_bytes": 494000000000}]}]}],
	  "SPSerialATADataType": [{"_name": "Intel 8 Series Chipset", "_items": [
	    {"_name": "WDC WD40EFRX-68N32N0", "bsd_name": "disk1", "device_model": "WDC WD40EFRX-68N32N0", "device_serial": "WD-WCC7K1234567",
	     "size_in_bytes": 4000787030016, "smart_status": "Failing", "spsata_medium_type": "Rotational"},
	    {"_name": "USB Stick", "bsd_name": "disk3", "size_in_bytes": 32000000000, "smart_status": "Not Supported", "removable_media": "yes"}]}]
	}`
	var prof map[string][]map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &prof); err != nil {
		t.Fatal(err)
	}
	disks := macDiskInventory(prof)
	if len(disks) != 2 {
		t.Fatalf("want 2 physical disks, got %+v", disks)
	}
	nvme, hdd := disks[0], disks[1]
	if nvme.Device != "disk0" || nvme.Type != "nvme" || nvme.SMARTStatus != "passed" || nvme.SizeBytes != 494384795648 || nvme.Model != "APPLE SSD AP0512Z" {
		t.Fatalf("nvme: %+v", nvme)
	}
	if hdd.Device != "disk1" || hdd.Type != "hdd" || hdd.SMARTStatus != "failed" || hdd.Serial != "WD-WCC7K1234567" {
		t.Fatalf("hdd: %+v", hdd)
	}
}

func TestParseHardwarePorts(t *testing.T) {
	in := "\nHardware Port: Ethernet\nDevice: en0\nEthernet Address: 00:11:22:33:44:55\n\nHardware Port: Wi-Fi\nDevice: en1\nEthernet Address: 00:11:22:33:44:56\n\nVLAN Configurations\n===================\n"
	got := parseHardwarePorts(in)
	if got["en0"] != "Ethernet" || got["en1"] != "Wi-Fi" || len(got) != 2 {
		t.Fatalf("ports: %v", got)
	}
}

func TestAppleSiliconMemoryMTs(t *testing.T) {
	for chip, want := range map[string]int{"Apple M1": 4266, "Apple M1 Pro": 6400, "Apple M1 Max": 6400, "Apple M2": 6400, "Apple M3 Max": 6400, "Apple M4": 7500, "Apple M4 Pro": 8533, "Intel(R) Core(TM) i7": 0} {
		if got := appleSiliconMemoryMTs(chip); got != want {
			t.Fatalf("%s: got %d want %d", chip, got, want)
		}
	}
}

func TestPhysicalPort(t *testing.T) {
	for name, want := range map[string]bool{"Ethernet": true, "Ethernet 2": true, "USB 10/100/1000 LAN": true, "Thunderbolt Ethernet Slot 1": true, "Wi-Fi": true,
		"Thunderbolt 1": false, "Ethernet Adapter (en4)": false, "Bluetooth PAN": false, "iPhone USB": false, "Thunderbolt Bridge": false} {
		if got := physicalPort(name); got != want {
			t.Fatalf("physicalPort(%q) = %v", name, got)
		}
	}
}

func TestParseIoregStats(t *testing.T) {
	in := `+-o AppleANS3NVMeController  <class AppleANS3NVMeController>
  | {
  |   "Statistics" = {"Bytes (Read)"=1048576000,"Bytes (Write)"=524288000,"Operations (Read)"=2000,"Operations (Write)"=1000,"Total Time (Read)"=3000000000,"Total Time (Write)"=1500000000,"Latency Time (Read)"=0}
  | }
  +-o APPLE SSD AP0512Z Media  <class IOMedia>
    | {
    |   "BSD Name" = "disk0"
    | }
    +-o disk0s1  <class IOMedia>
      | { "BSD Name" = "disk0s1" }
`
	got := parseIoregStats(in)
	s, ok := got["disk0"]
	if !ok || s.readSectors != 1048576000/512 || s.writeSectors != 524288000/512 || s.readIOs != 2000 || s.writeIOs != 1000 || s.ioMs != 4500 {
		t.Fatalf("ioreg: %+v (%v)", s, ok)
	}
	if _, bad := got["disk0s1"]; bad {
		t.Fatalf("partition must not get its own entry")
	}
}

func TestParsePowermetrics(t *testing.T) {
	sensors, gpu := parsePowermetrics("**** SMC sensors ****\n\nCPU die temperature: 52.31 C\nGPU die temperature: 48.00 C\nFan: 1203.55 rpm\n")
	if len(sensors) != 3 || sensors[0].Kind != "temp" || sensors[0].Value != 52.31 || sensors[2].Kind != "fan" || sensors[2].Value != 1203.55 || gpu != 0 {
		t.Fatalf("intel: %+v gpu=%v", sensors, gpu)
	}
	sensors, gpu = parsePowermetrics("**** GPU usage ****\n\nGPU HW active frequency: 444 MHz\nGPU HW active residency:  12.34% (444 MHz: 100%)\n")
	if len(sensors) != 0 || gpu != 12.34 {
		t.Fatalf("apple silicon: %+v gpu=%v", sensors, gpu)
	}
}

func TestParseIfconfig(t *testing.T) {
	up := "en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500\n\toptions=6460\n\tether 00:11:22:33:44:55\n\tmedia: autoselect (1000baseT <full-duplex>)\n\tstatus: active\n"
	speed, duplex, oper, admin := parseIfconfig(up)
	if speed != 1000 || duplex != "full" || oper != "up" || admin != "up" {
		t.Fatalf("up: %d %s %s %s", speed, duplex, oper, admin)
	}
	tenG := "en5: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500\n\tmedia: autoselect (10Gbase-T <full-duplex>)\n\tstatus: active\n"
	if speed, _, _, _ = parseIfconfig(tenG); speed != 10000 {
		t.Fatalf("10G: %d", speed)
	}
	down := "en1: flags=8822<BROADCAST,SMART,SIMPLEX,MULTICAST> mtu 1500\n\tmedia: autoselect (none)\n\tstatus: inactive\n"
	speed, _, oper, admin = parseIfconfig(down)
	if speed != -1 || oper != "down" || admin != "down" {
		t.Fatalf("down: %d %s %s", speed, oper, admin)
	}
}

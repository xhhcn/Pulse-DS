package main

import "testing"

func TestParseATASmartAttributes(t *testing.T) {
	vendor := make([]uint8, 362)
	vendor[0], vendor[1] = 0x10, 0x00
	put := func(slot int, id, cur, worst uint8, raw uint64) {
		off := 2 + slot*12
		vendor[off] = id
		vendor[off+3] = cur
		vendor[off+4] = worst
		for i := 0; i < 6; i++ {
			vendor[off+5+i] = uint8(raw >> (8 * i))
		}
	}
	put(0, 5, 100, 100, 3)           // reallocated
	put(1, 9, 98, 98, 12345)         // power-on hours
	put(2, 194, 66, 45, 34|(40<<16)) // temperature 34, max 40 in the upper bytes
	put(3, 197, 100, 100, 0)
	put(4, 177, 91, 91, 120) // wear levelling: 91 % left
	attrs := parseATASmartAttributes(vendor)
	if len(attrs) != 5 {
		t.Fatalf("want 5 attributes, got %d", len(attrs))
	}
	d := DiskHardware{Type: "ssd"}
	applyATASmartAttributes(&d, attrs)
	if d.TempC == nil || *d.TempC != 34 || d.PowerOnHours == nil || *d.PowerOnHours != 12345 || d.Reallocated == nil || *d.Reallocated != 3 || d.Pending == nil || *d.Pending != 0 {
		t.Fatalf("attributes: %+v", d)
	}
	if d.WearPct == nil || *d.WearPct != 9 {
		t.Fatalf("wear: %v", d.WearPct)
	}
	if got := parseATASmartAttributes([]uint8{1, 2, 3}); got != nil {
		t.Fatalf("short table must yield nothing")
	}
}

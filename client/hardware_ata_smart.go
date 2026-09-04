package main

// ATA S.M.A.R.T. attribute table as Windows exposes it through
// MSStorageDriver_ATAPISmartData (root\WMI): a 2-byte version header
// followed by 30 twelve-byte entries — id, flags(2), current, worst,
// raw(6), reserved. Kept free of build tags so the parser is unit-tested on
// every platform.

import "strings"

type ataAttribute struct {
	ID      uint8
	Current uint8
	Worst   uint8
	Raw     uint64 // low 48 bits of the raw field
}

func parseATASmartAttributes(vendor []uint8) []ataAttribute {
	var out []ataAttribute
	for off := 2; off+12 <= len(vendor) && len(out) < 30; off += 12 {
		id := vendor[off]
		if id == 0 {
			continue
		}
		raw := uint64(0)
		for i := 5; i >= 0; i-- {
			raw = raw<<8 | uint64(vendor[off+5+i])
		}
		out = append(out, ataAttribute{ID: id, Current: vendor[off+3], Worst: vendor[off+4], Raw: raw})
	}
	return out
}

// applyATASmartAttributes fills the S.M.A.R.T. fields a disk entry can carry
// from a raw ATA attribute table, using the well-known ids (temperature,
// power-on hours, reallocated / pending sectors, SSD life indicators).
func applyATASmartAttributes(d *DiskHardware, attrs []ataAttribute) {
	for _, a := range attrs {
		switch a.ID {
		case 194, 190: // temperature (raw low byte is the current reading)
			if d.TempC == nil {
				t := float64(a.Raw & 0xff)
				if t > 0 && t < 120 {
					d.TempC = &t
				}
			}
		case 9: // power-on hours (some drives count minutes or seconds; hours dominate)
			h := int64(a.Raw & 0xffffffff)
			if h > 0 {
				d.PowerOnHours = &h
			}
		case 5: // reallocated sectors
			v := int64(a.Raw & 0xffffffff)
			d.Reallocated = &v
		case 197: // current pending sectors
			v := int64(a.Raw & 0xffffffff)
			d.Pending = &v
		case 177, 231, 233, 202: // wear levelling / SSD life left / media wearout indicator
			if d.WearPct == nil && strings.EqualFold(d.Type, "ssd") {
				if life, ok := ssdLifeLeft(ataAttributeName(a.ID), int64(a.Current), int64(a.Raw)); ok {
					w := 100 - life
					d.WearPct = &w
				}
			}
		}
	}
}

// ataAttributeName maps the ids the wear heuristic understands onto the
// smartctl names ssdLifeLeft already knows.
func ataAttributeName(id uint8) string {
	switch id {
	case 177:
		return "Wear_Leveling_Count"
	case 231:
		return "SSD_Life_Left"
	case 233:
		return "Media_Wearout_Indicator"
	case 202:
		return "Percent_Lifetime_Remain"
	}
	return ""
}

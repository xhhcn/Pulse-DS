//go:build !linux && !windows && !darwin
// +build !linux,!windows,!darwin

package main

// No hardware collector on this platform: the agent reports the plain
// metrics only and the server treats it like any other agent.
func collectHardware() *HardwareInfo { return nil }

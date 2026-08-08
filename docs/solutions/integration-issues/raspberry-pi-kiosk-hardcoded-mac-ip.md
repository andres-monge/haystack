---
title: Raspberry Pi kiosk stopped updating after the Mac changed IP address
date: 2026-08-08
category: integration-issues
module: Raspberry Pi kiosk networking
problem_type: integration_issue
component: tooling
symptoms:
  - The Raspberry Pi kiosk stopped showing newly generated Haystack images on the TV.
  - The Mac served Haystack successfully on a new address while Pi Chromium still requested 192.168.0.20.
  - Switching between the primary Wi-Fi network and its extender interrupted image delivery and it no longer recovered automatically.
root_cause: config_error
resolution_type: config_change
severity: high
related_components:
  - macOS private Wi-Fi address
  - router static DHCP
  - Raspberry Pi Chromium kiosk
tags:
  - raspberry-pi
  - kiosk
  - dhcp-reservation
  - private-mac-address
  - hardcoded-ip
  - wifi-extender
  - chromium
---

# Raspberry Pi kiosk stopped updating after the Mac changed IP address

## Problem

The TV stopped showing new Haystack images even though the Pi was powered and the Mac was still generating images. Chromium on the Pi was pinned to `http://192.168.0.20:4321/kiosk`, but the Mac had received `192.168.0.13` after moving between the primary Wi-Fi SSID and its extender.

This is a delivery/configuration failure, not an image-generation failure. The Pi deliberately runs only Chromium and depends on the Mac-hosted Express server over the LAN ([`AGENTS.md:91`](../../../AGENTS.md#raspberry-pi-kiosk-setup)).

## Symptoms

- The TV retains an older image while new files continue appearing on the Mac.
- The Pi is reachable, Chromium is running, and HDMI is active.
- The Pi can reach Haystack on the Mac's current address, but not at the literal address in `~/.config/labwc/autostart`.
- A solid red Pi 4 power LED is present. That is normally a power indication, not proof of this failure; check `vcgencmd get_throttled` and system logs before treating it as undervoltage ([Raspberry Pi LED behavior](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#led-behaviour)).

The stale display is expected when delivery fails. The kiosk polls `/api/latest` every 60 seconds and deliberately leaves the current image visible after network or image-load errors (`public/kiosk.html:35-38`, `public/kiosk.html:58-60`, `public/kiosk.html:64-89`). The server returns the newest stored output from `GET /api/latest` (`src/server/server.ts:274-285`).

## What Didn't Work

- **Diagnosing from the red LED alone.** The Pi was online, cool, and reported `throttled=0x0`; the LED was unrelated to the stale content.
- **Changing the Pi URL to the Mac's temporary `.13` lease.** That would restore service only until DHCP changed the address again.
- **Replacing the IP with the Mac's `.local` name.** mDNS resolution from the Pi failed in this network, matching the deployment warning in `AGENTS.md:123`.
- **Renewing DHCP with `ipconfig set en0 DHCP`.** macOS denied the command without elevated permission. Reconnecting Wi-Fi after saving the reservation renewed the lease safely.
- **Changing router-wide Wi-Fi or DHCP settings.** Resetting the router, editing the DHCP pool, or changing the SSID/password would disrupt unrelated devices and was unnecessary.
- **Assuming every stale-TV incident has the same cause.** A previous incident was a paused scheduler; after resuming it, a manual trigger was needed for an immediate image (session history). Confirm generation health before investigating delivery.

## Solution

Keep the Mac's network identity stable on the primary SSID, then reserve the IP already embedded in the Pi configuration.

1. In macOS, open the primary home network under **System Settings → Wi-Fi → Details** and set **Private Wi-Fi Address** to **Fixed**.
2. Read the private Wi-Fi address displayed for that SSID. It is network-specific; do not substitute the hardware MAC or the extender SSID's private address.
3. In the router's expert LAN settings, add one static DHCP rule:

   ```text
   Device name: Haystack-Mac
   MAC address: <Fixed private Wi-Fi address shown for the primary SSID>
   IP address:  192.168.0.20
   ```

4. Apply only that rule. Do not change the router address, subnet mask, DHCP pool, SSID, or Wi-Fi password.
5. Reconnect the Mac to the primary SSID so it requests a new lease. Confirm it receives `192.168.0.20`.
6. Confirm Haystack listens on the LAN. The server listens on `config.bindHost` (`src/server/start.ts:29-39`), whose code default is `127.0.0.1` (`src/config/config.ts:156`); the documented deployment sets `HAYSTACK_BIND_HOST=0.0.0.0` so the server is LAN-accessible (`AGENTS.md:134`).
7. Verify delivery from the Pi:

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' http://192.168.0.20:4321/kiosk
   curl -sS -o /dev/null -w '%{http_code}\n' http://192.168.0.20:4321/api/latest
   ```

8. Confirm the physical display, not only HTTP health. In the verified repair, Chromium re-established a TCP connection to `.20:4321` and a Wayland capture of `HDMI-A-1` showed the latest Haystack image.

The reservation changes only the Mac's DHCP assignment. Other devices keep their existing credentials and DHCP behavior and do not need to reconnect.

## Why This Works

Two independent conditions must agree:

1. Haystack must listen on a LAN-accessible interface.
2. The router must assign the Mac the same literal address that Chromium requests.

Before the repair, Haystack was correctly exposed at `.13`, but Chromium still requested `.20`. A DHCP reservation is keyed to the MAC address presented to the router. macOS uses network-specific private Wi-Fi identities, so a reservation for one identity is not automatically valid for another SSID such as `_EXT`. It can also stop matching after the primary network's private identity changes.

Setting the primary SSID's private address to **Fixed** stabilizes that identity. Reserving `.20` for that exact identity makes the router consistently return the address already configured on the Pi. Once reachable, the kiosk's existing polling loop detects the newest output and updates without regeneration or Pi software changes.

## Prevention

- Keep **Private Wi-Fi Address: Fixed** for the primary SSID. If the network is forgotten/re-added or the displayed address changes, update the router reservation to match.
- Treat the primary SSID and extender SSID as separate network identities. The reservation protects the primary SSID; using the extender may still interrupt the kiosk unless it presents the same reachable LAN and has an appropriate reservation.
- Preserve the router's `.20` static lease and `HAYSTACK_BIND_HOST=0.0.0.0`.
- After replacing or resetting the router, verify all four invariants: the Mac's Fixed private address, the `.20` reservation, Haystack listening on `0.0.0.0:4321`, and the Pi URL targeting `.20`.
- When the TV is stale, separate **generation** from **delivery**:
  1. Confirm a recent output exists on the Mac.
  2. Compare the Mac's current address with the Pi Chromium URL.
  3. Request `/kiosk` and `/api/latest` from the Pi.
  4. If HTTP succeeds, inspect Chromium, Wayland, and HDMI; if the Mac responds only on another IP, inspect the private-address setting and router reservation.

## Related Issues

- [Raspberry Pi kiosk setup](../../../AGENTS.md#raspberry-pi-kiosk-setup)
- [Phase C TV kiosk plan](../../plans/2026-02-15-phase-c-feat-tv-kiosk-display-phase-c-plan.md#pi-setup-notes-no-haystack-code--just-configuration)
- [Phase A4 launchd and kiosk topology](../../plans/2026-02-28-phase-a4-feat-launchd-server-daemon-hourly-scheduler-plan.md#architecture)

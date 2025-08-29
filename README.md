# MUP1 Web Frontend

Pure frontend (WebSerial) control panel for Microchip VelocityDRIVE (LAN966x) over MUP1 + CoAP/CBOR.

- WebSerial (Chrome/Edge) serial connection
- MUP1 framing encoder/decoder
- CoAP client (TKL=0, Uri-Path/Uri-Query, CBOR)
- YANG Browser (browse, get, set)
- CoAP Console (GET/POST/PUT/DELETE/FETCH)
- Diagnostics & Logs (HEX view, history)
- TSN tools: CBS & TAS configuration from UI

## Live (GitHub Pages)
1) Repo Settings → Pages → Source: `gh-pages` → Save
2) Open: `https://<your-user>.github.io/mup1/` (e.g., https://hwkim3330.github.io/mup1/)

## Quick Start
- Use Chrome/Edge 89+ (WebSerial)
- Open the page → Click `Connect` → select your device (e.g., `/dev/ttyACM0`)
- Watch device info populate (VelocitySP version & board)
- Use tabs to browse YANG or apply CBS/TAS

## Features
- MUP1 Ping/Announcement parsing for device model/firmware
- Initial CORECONF handshake (CoAP FETCH `c?d=a` + CBOR `[0x7278]`)
- CoAP: MID-based matching (TKL=0), Uri-Query(15), Content-Format=application/cbor(60)
- Logs: CoAP/MUP1 TX/RX in HEX, auto-scroll, export
- CoAP Console: recent-history list with status/code

## CBS (Credit-Based Shaper)
- Inputs: Port, Traffic Class, Link Speed (Mbps), Bandwidth (%)
- idle-slope = link_bps × (BW%)
- Applies to: `/ieee802-dot1q-sched:interfaces/interface[name='ethX']/scheduler/traffic-class[index='TC']/credit-based-shaper`
- Sends: `idle-slope`, `send-slope=-idle`, `admin-idleslope-enabled=true`

## TAS (Time-Aware Shaper)
- Inputs: Port, Cycle Time (µs), GCL entries (gate mask, duration ns)
- Applies to: `/ieee802-dot1q-sched:interfaces/interface[name='ethX']/schedule`
- Sends: `admin-control-list[]`, `admin-cycle-time`, `admin-base-time`
- UI will validate GCL durations sum equals cycle time (ns)

## Troubleshooting
- Use `Logs` tab to inspect HEX frames and response codes
- If CONNECT fails, replug device or ensure no other process uses the port
- Some YANG paths require correct CORECONF media-type; current default is `application/cbor(60)`; can be adjusted per device accept list

## Dev Notes
- All assets are static; no backend required
- Code layout:
  - `index.html` – UI shell and nav
  - `js/webserial.js` – raw byte IO over WebSerial
  - `js/velocitydrive-protocol.js` – MUP1 framing
  - `js/coap-client.js` – CoAP encoder/parser
  - `js/lan966x-controller.js` – high-level operations (ports, VLAN, PTP, CBS, TAS)
  - `js/pages.js` – page templates
  - `js/yang-browser.js` – simple YANG explorer

## Roadmap
- CoAP Accept/Content-Format for RFC 9254/CORECONF explicit media-types
- Replay from history & log filters (CoAP/MUP1)
- Auto-detect link speed for CBS from interface state
- TAS editor UX improvements (bitmask editor, template presets)


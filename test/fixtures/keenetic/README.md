# Keenetic fixtures

Each file maps an RCI path (`show/system`, `show/ip/hotspot`…) to the answer of
a router, as `GET /rci/<path>` returns it. `show/interface/stat` maps an
interface id to the answer of `show interface stat name <id>`.
`test/helpers/fakeKeenetic.js` serves them.

Nothing here is private: MAC addresses are in the documentation range of
RFC 7042 (`00:00:5e:00:53:xx`), IP addresses in the ranges of RFC 5737
(`192.0.2.x`, `198.51.100.x`, `203.0.113.x`), names, SSIDs and serial numbers
are invented.

## `ultra-5.1-wireguard.json`

Real answers of a Keenetic Ultra (KN-1811) on KeeneticOS 5.1.3, captured by
[salatmaster/keenetic-mcp](https://github.com/salatmaster/keenetic-mcp)
(`tests/fixtures/`, MIT license, © 2026 A Y), already anonymized there and
anonymized again here (`02:00:00:00:00:xx` → `00:00:5e:00:53:xx`, the public
addresses of the WireGuard peers and of the captive portal check replaced, the
`host-N` / `ssid-N` / `desc-N` placeholders replaced by realistic names).

The router has a home segment (`Bridge0`, `private`) and a guest one
(`Bridge1`, `protected`), each with a 2.4 GHz and a 5 GHz access point, an
Ethernet ISP connection (`GigabitEthernet1`) and two WireGuard tunnels used for
the Internet, one holding the default route.

Invented, in the shape of NDMS: `show/identification` and
`show/interface/stat`.

## `giga-4.1-pppoe-lte.json`

Rebuilt by hand in the shape of the answers above, for the cases the capture
does not have: a Keenetic Giga (KN-1011) on KeeneticOS 4.1.7 with a PPPoE
fibre (`PPPoE0` over `GigabitEthernet1`), a 4G modem as backup connection
(`UsbLte0`, lower priority), a guest Wi-Fi switched off, a wired NAS, an
inactive phone, a blocked tablet, an unregistered device and a station still
in the WPA handshake.

To be checked against a real router with `scripts/probe.mjs`: the fields of a
PPPoE interface (`via`), of a USB modem (`type`, `global`, `priority`), and of
`show identification`.

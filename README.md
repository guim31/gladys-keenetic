# Keenetic for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
follows [Keenetic](https://keenetic.com) routers (Giga, Ultra, Hopper, Viva,
Peak, Titan…) over the local network, through RCI, the JSON interface of the
KeeneticOS web interface. No cloud, no account, no telnet.

> **Developed without the hardware: feedback welcome.** The integration is
> tested against real RCI answers of a Keenetic Ultra on KeeneticOS 5.1
> (anonymized, from the MIT-licensed
> [salatmaster/keenetic-mcp](https://github.com/salatmaster/keenetic-mcp)) and
> against answers rebuilt in their shape (a Keenetic Giga with a PPPoE fibre
> and a 4G backup), not against a real router. Please report what works and
> what does not in the [issues](https://github.com/guim31/gladys-keenetic/issues).

This project is not affiliated with Keenetic Ltd. Keenetic and KeeneticOS are
trademarks of their owner.

## Features

- **Presence sensors**: the devices of the host table of the router (registered
  or not) are listed in the Discovery tab; each one the user adds becomes a
  presence sensor, present while the router sees it online (Wi-Fi, cable, mesh
  extender) or associated on its Wi-Fi. A configurable **departure delay**
  avoids false departures of phones asleep, and an outage of the router never
  marks anyone away.
- **The router as a device**: CPU load, memory used, uptime, KeeneticOS
  version, Wi-Fi clients, connected devices, **Internet available**, the
  **connection in use** with its **download and upload rates**, and, with
  several Internet connections, whether the **backup connection** (4G / 5G
  modem, second ISP) is up and in use; the state of the guest Wi-Fi.
- **Commands, off by default**: when the user ticks _Allow commands_, scene
  actions and widget buttons (with confirmation) turn the **guest Wi-Fi** on
  or off, **block or allow the Internet access** of a registered device
  (parental control) and **reboot** the router. Every command is read back,
  then saved in the router configuration. Nothing is exposed as a switch.
- **Scene triggers**: _Unknown device connected_ (a MAC address never seen
  before, remembered across restarts, filtered by network and by Wi-Fi or
  cable), _Internet down_, _Internet restored_ (with the length of the outage),
  _Switched to the backup connection_ and _Back on the main connection_ (with
  the time on the backup).
- **Dashboard widgets**: _Keenetic router_ (health, rates, Internet, backup,
  guest Wi-Fi, Guest Wi-Fi and Reboot buttons) and _Devices at home_.
- **Test the connection** in the Configuration screen.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- A Keenetic router with KeeneticOS 3 or later (written for KeeneticOS 4 and
  5), reached on its **local** address: a KeenDNS address does not offer the
  login of the local web interface.
- A dedicated Keenetic user with the web interface right only; read-only
  (`user gladys tag readonly`) when the commands are not used. The procedure is
  in the user guide.

## Installation

1. On the router, create the dedicated user of the user guide
   ([`docs/en.md`](docs/en.md), section _Create a dedicated user_).
2. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-keenetic`
   (or install **Keenetic** from the catalog once it is listed).
3. In **Configuration**, enter the local address of the router, the user and
   its password. Save, then click **Test the connection**.
4. Open the **Discovery** tab and add the router and the phones to follow.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- **Login**: `GET /auth` answers 401 with a session cookie, `X-NDM-Realm` and
  `X-NDM-Challenge`; `POST /auth` sends
  `sha256(challenge + md5(login:realm:password))`. The password never travels.
  A session the router ended (a few minutes unused, a reboot) is renewed once,
  transparently; a refused password is tried again every five minutes only.
- **Reading**: every refresh interval (10 s to 1 min, 30 s by default), one
  `POST /rci/` batch: `show system`, `show interface`, `show ip hotspot`,
  `show associations`, `show internet status` and `show interface stat` of the
  Internet connections. `show version` and `show identification` are read at
  each new session. Gladys never polls these devices (`should_poll: false`,
  GladysAssistant/Gladys#3198): the timer is the integration's own.
- **Internet connections**: the interfaces marked global (KeeneticOS fails
  over between them by priority), without the VPN tunnels and without the
  port under a PPPoE session. The connection in use is the gateway of
  `show internet status`, else the first established one.
- **Identity**: the router is identified by the MAC address of its home
  segment (else of `show identification`), never by the address typed in the
  configuration; a device by its MAC address.
- **States**: only the values that change are sent, for the devices added to
  Gladys only, with a heartbeat every six hours; a present device is sent
  again every two minutes. Everything is sent again when a device is added or
  Gladys reconnects.
- **Commands**: `interface <access point> up|down` on every access point of
  the guest segment (security level `protected`, or the segment named in the
  configuration), `ip hotspot host <mac> deny|permit`, then
  `system configuration save`; `system reboot`.
- **Storage**: `/data/keenetic-state.json`, the MAC addresses already seen (for
  the unknown-device trigger).

## Development

```bash
npm install
npm test                 # node --test, against the fake Gladys of the SDK and a fake Keenetic
npm run lint
npm run format:check
```

`scripts/probe.mjs` checks the client against a real router, read only, and
prints a report without addresses, MACs, names, SSIDs, cookies or passwords:

```bash
node scripts/probe.mjs 192.168.1.1                                         # an invented account, refused
KEENETIC_USER=gladys KEENETIC_PASSWORD=… node scripts/probe.mjs 192.168.1.1  # every reading of the integration
```

The test fixtures are described in
[`test/fixtures/keenetic/README.md`](test/fixtures/keenetic/README.md).

## Limits

- One router per integration; the Wi-Fi clients count the stations of the
  router itself (the mesh extenders' are in the connected devices); the rates
  are averages over the refresh interval; no per-device traffic, no modem
  signal; plain HTTP on the local network (the password never travels, the
  readings do). The login of KeeneticOS 5.2, which adds access tokens, is not
  verified yet. See the Limits section of the user guide.

## Credits

- [salatmaster/keenetic-mcp](https://github.com/salatmaster/keenetic-mcp) (MIT,
  © 2026 A Y): the RCI login, the error statuses in an HTTP 200, the read-back
  of every command, and the real RCI answers the fixtures are made from.
- [akinin/ha_keenetic](https://github.com/akinin/ha_keenetic) (MIT, © 2025
  Anton Akinin): the batch requests, the interface and hotspot commands, the
  reboot, and presence from the hotspot table.
- The Home Assistant
  [`keenetic_ndms2`](https://www.home-assistant.io/integrations/keenetic_ndms2/)
  integration (Apache-2.0) and the
  [ndms2_client](https://github.com/foxel/python_ndms2_client) library by
  Andrey F. Kupreychik (MIT), for the device tracking approach (over telnet
  there; RCI here).
- The structure of [guim31/gladys-openwrt](https://github.com/guim31/gladys-openwrt).

## License

[Apache-2.0](LICENSE)

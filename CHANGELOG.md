# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Keenetic routers on the local network, through RCI (the JSON interface of
  the KeeneticOS web interface), with the challenge login of the web
  interface: the password never travels.
- Presence sensors for the devices chosen in the Discovery tab, from the host
  table of the router and its Wi-Fi associations, with a departure delay.
- The router as a device: CPU load, memory used, uptime, KeeneticOS version,
  Wi-Fi clients, connected devices, Internet available, the connection in use
  with its download and upload rates, the backup connection (4G / 5G, second
  ISP) up and in use, the guest Wi-Fi.
- Commands, off by default: guest Wi-Fi on and off, Internet access of a
  device blocked or allowed (parental control), router reboot, as scene
  actions and widget buttons with confirmation.
- Scene triggers: unknown device connected, Internet down, Internet restored,
  switched to the backup connection, back on the main connection.
- Dashboard widgets: the Keenetic router, and the devices at home.
- "Test the connection" in the Configuration screen.
- Every text in English, French, German and Spanish, and the user guide in the
  four languages.

[Unreleased]: https://github.com/guim31/gladys-keenetic/commits/main

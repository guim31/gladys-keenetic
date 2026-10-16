# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the user name and the password of a Keenetic user, kept in the
  configuration of the integration in Gladys (a `secret` field). They are never
  written to `/data` nor to the logs. The password never travels on the
  network either: the login answers a one-time challenge of the router with
  `sha256(challenge + md5(login:realm:password))`. The session cookie lives in
  memory only.
- **`/data`**: `keenetic-state.json`, the MAC addresses already seen on the
  network (for the "Unknown device connected" trigger). Nothing else.
- **Network**: plain HTTP to the local web interface of the router only (port
  80 unless set otherwise), one request per refresh interval. No cloud, no
  other host. The readings (host names, addresses) travel unencrypted on the
  local network, like the web interface of the router itself.
- **Commands**: off by default. When allowed, the integration only switches
  the access points of the guest segment, sets the Internet access rule of a
  chosen registered device, saves the configuration and reboots the router. A
  read-only Keenetic user (`tag readonly`) makes the router refuse them all.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the routers and the firmware the integration talks to.

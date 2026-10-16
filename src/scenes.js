// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+). They do
// nothing unless "Allow commands" is ticked in the configuration, and the
// router answers with its own refusal when the Keenetic user is read-only.
//
//   - turn the guest Wi-Fi on or off: "guest Wi-Fi on when guests arrive,
//     off at night";
//   - block or allow the Internet access of a network device followed by the
//     integration (parental control: "no Internet on the children's tablet
//     after 21:00");
//   - reboot the router.
//
// Never anything else: the integration changes nothing in the router
// configuration beyond the state of the guest access points and the access
// rule of the chosen device.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async enable_guest_wifi(hub) {
    const { enabled } = await hub.setGuest(true);
    return { enabled };
  },

  async disable_guest_wifi(hub) {
    const { enabled } = await hub.setGuest(false);
    return { enabled };
  },

  async block_device_internet(hub, { fields = {} }) {
    const { blocked } = await hub.setBlocked(fields.device, true);
    return { blocked };
  },

  async allow_device_internet(hub, { fields = {} }) {
    const { blocked } = await hub.setBlocked(fields.device, false);
    return { blocked };
  },

  async reboot_router(hub) {
    await hub.reboot();
    return undefined;
  },
};

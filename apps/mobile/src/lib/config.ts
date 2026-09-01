/**
 * The API origin. `EXPO_PUBLIC_*` vars are inlined by the Expo CLI at bundle
 * time — set `EXPO_PUBLIC_INSPECT_API_URL` in the shell (or eas.json) before
 * `expo start`. Until INS-090 lands a reachable HTTPS origin, point this at
 * the dev machine's LAN address; `localhost` only works on an emulator that
 * maps it (iOS simulator), never on a physical device.
 */
export const API_URL = process.env.EXPO_PUBLIC_INSPECT_API_URL ?? 'http://localhost:3000';

/**
 * The web console's origin, for outbound links only — today that is the
 * public verify page `/r/[token]`, which is permanently web-only by design
 * (it must open for anyone holding the link, no app installed). Optional:
 * screens hide the affordance when it is unset.
 */
export const WEB_URL = process.env.EXPO_PUBLIC_INSPECT_WEB_URL ?? null;

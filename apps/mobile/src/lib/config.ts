/**
 * The API origin. `EXPO_PUBLIC_*` vars are inlined by the Expo CLI at bundle
 * time — set `EXPO_PUBLIC_INSPECT_API_URL` in the shell (or eas.json) before
 * `expo start`. In development, `localhost` is a convenience for an emulator
 * that maps it (iOS simulator; Android needs `10.0.2.2`); a physical device
 * needs the dev machine's LAN address.
 *
 * A release build with the origin unset used to ship silently calling
 * `localhost` — every screen failed and the reason was invisible (INS-102).
 * Now it fails at launch, and refuses plain `http://` (Android cleartext and
 * iOS ATS block it anyway, so the failure would only be less legible).
 */
const configured = process.env.EXPO_PUBLIC_INSPECT_API_URL?.replace(/\/+$/, '');

if (!__DEV__) {
  if (!configured) {
    throw new Error(
      'EXPO_PUBLIC_INSPECT_API_URL is not set. A release build must bake in the API origin — see apps/mobile/eas.json.',
    );
  }
  if (!configured.startsWith('https://')) {
    throw new Error(`EXPO_PUBLIC_INSPECT_API_URL must be https:// in a release build (got ${configured}).`);
  }
}

export const API_URL = configured ?? 'http://localhost:3000';

/**
 * The web console's origin, for outbound links only — today that is the
 * public verify page `/r/[token]`, which is permanently web-only by design
 * (it must open for anyone holding the link, no app installed). Optional:
 * screens hide the affordance when it is unset.
 */
export const WEB_URL = process.env.EXPO_PUBLIC_INSPECT_WEB_URL?.replace(/\/+$/, '') ?? null;

/**
 * The font assets the app loads before its first frame (INS-095). Keys are the
 * `native` names in `@inspect/design-tokens` (`fontFamilies[role].native[weight]`),
 * which is what `text()` in `./index.ts` emits as `fontFamily` — so a name here
 * and a name there are the same string by construction.
 *
 * Nine faces: Inter 400/500/600/700 · Libre Baskerville 400/700 · JetBrains
 * Mono 400/500/700. Keep the set small — every face is a download on first
 * launch and a parse on every cold start.
 */
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import {
  LibreBaskerville_400Regular,
  LibreBaskerville_700Bold,
} from '@expo-google-fonts/libre-baskerville';
import { fontFamilies } from '@inspect/design-tokens';

export const FONT_SOURCES = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  LibreBaskerville_400Regular,
  LibreBaskerville_700Bold,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
};

/**
 * Dev-only guard: every native font name the tokens can emit must be loaded
 * here, or Android silently renders the system font for that role.
 */
if (__DEV__) {
  const missing = Object.values(fontFamilies)
    .flatMap((f) => Object.values(f.native))
    .filter((name) => !(name in FONT_SOURCES));
  if (missing.length > 0) {
    console.warn(`[theme/fonts] token font names not loaded: ${missing.join(', ')}`);
  }
}

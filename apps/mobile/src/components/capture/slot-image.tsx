/**
 * The image for one slot, served LOCAL-FIRST (INS-093): the bytes this device
 * captured are shown straight from the app sandbox, so going back to a shot
 * is instant and works offline; the server's short-lived presigned URL is
 * the fallback (a photo taken on another device, or a cache that was swept).
 */
import { palette } from '@inspect/design-tokens';
import { Image, type ImageContentFit, type ImageStyle } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  localUri?: string | null;
  remoteUri?: string | null;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  /** Shown when neither source can render. */
  emptyLabel?: string;
};

export function SlotImage({
  localUri,
  remoteUri,
  style,
  contentFit = 'cover',
  emptyLabel = 'Preview unavailable',
}: Props) {
  // Keyed on the local uri so a retake (new bytes) resets the fallback.
  return (
    <SlotImageInner
      key={`${localUri ?? ''}|${remoteUri ?? ''}`}
      localUri={localUri}
      remoteUri={remoteUri}
      style={style}
      contentFit={contentFit}
      emptyLabel={emptyLabel}
    />
  );
}

function SlotImageInner({ localUri, remoteUri, style, contentFit, emptyLabel }: Props) {
  const [localFailed, setLocalFailed] = useState(false);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const uri = localUri && !localFailed ? localUri : remoteUri && !remoteFailed ? remoteUri : null;

  if (!uri) {
    return (
      <View style={[styles.empty, style as StyleProp<ViewStyle>]}>
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit={contentFit}
      cachePolicy="memory-disk"
      transition={120}
      onError={() => {
        if (uri === localUri) setLocalFailed(true);
        else setRemoteFailed(true);
      }}
    />
  );
}

const styles = StyleSheet.create({
  empty: {
    backgroundColor: palette.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { color: palette.faint, fontSize: 11, textAlign: 'center', padding: 6 },
});

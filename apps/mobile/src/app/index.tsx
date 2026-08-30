import { palette } from '@inspect/design-tokens';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { hasSession } from '@/lib/session';

/** Entry: route to the list when a session exists, the login screen when not. */
export default function Index() {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');

  useEffect(() => {
    hasSession().then((ok) => setState(ok ? 'in' : 'out'));
  }, []);

  if (state === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }
  return <Redirect href={state === 'in' ? '/inspections' : '/login'} />;
}

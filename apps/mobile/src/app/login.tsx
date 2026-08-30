import { ApiError } from '@inspect/api-client';
import { palette } from '@inspect/design-tokens';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { signIn } from '@/lib/session';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy || !email || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.replace('/inspections');
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? 'Wrong email or password.'
          : 'Could not reach the Inspect API. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.brand}>Inspect</Text>
        <Text style={styles.hint}>Sign in with your workspace account</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={palette.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={palette.faint}
          secureTextEntry
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.button, (pressed || busy) && styles.buttonPressed]}
          onPress={submit}
          disabled={busy}
        >
          <Text style={styles.buttonLabel}>{busy ? 'Signing in…' : 'Sign in'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: palette.panel,
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
    gap: 12,
  },
  brand: { color: palette.ink, fontSize: 24, fontWeight: '700' },
  hint: { color: palette.sub, fontSize: 14, marginBottom: 8 },
  input: {
    borderColor: palette.line,
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: palette.fill,
    color: palette.ink,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  error: { color: palette.danger, fontSize: 13 },
  button: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonPressed: { opacity: 0.7 },
  buttonLabel: { color: palette.panel, fontSize: 16, fontWeight: '600' },
});

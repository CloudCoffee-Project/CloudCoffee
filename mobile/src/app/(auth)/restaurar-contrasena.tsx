// src/app/(auth)/restaurar-contrasena.tsx
//
// Pantalla de reset con token (INT4-21). Diseño basado en el mockup
// (cloudcoffee-react/Restaurar_Contraseña). Llama a
// POST /v1/auth/password/reset con el token del correo y la clave nueva.
// Solo muestra error y éxito, sin estados adicionales.

import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toApiError } from '../../services/httpClient';
import { restablecerPassword } from '../../services/auth';

const PASSWORD_MIN = 8;

export default function RestaurarContrasenaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  const handleCambiar = async (): Promise<void> => {
    if (!token.trim()) {
      setError('Ingresa el token que recibiste en tu correo.');
      return;
    }
    if (password.length < PASSWORD_MIN) {
      setError(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden. Inténtalo de nuevo.');
      return;
    }

    setCargando(true);
    setError(null);

    try {
      await restablecerPassword(token, password);
      setExito(true);
    } catch (errorApi) {
      setError(toApiError(errorApi as never).message);
    } finally {
      setCargando(false);
    }
  };

  if (exito) {
    return (
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.screen, { paddingTop: 32 + insets.top }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.resetContent}>
            <Text style={styles.resetIcon}>✔️</Text>

            <Text style={styles.title}>Contraseña Restablecida</Text>

            <Text style={styles.subtitle}>
              Tu contraseña fue cambiada con éxito. Ya puedes iniciar sesión con tu nueva clave.
            </Text>

            <View style={styles.actionsColumn}>
              <Pressable
                onPress={() => router.replace('/(auth)/login')}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Iniciar Sesión</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.screen, { paddingTop: 32 + insets.top }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => router.replace('/(auth)/portada')}
          style={styles.backButton}
          hitSlop={8}
        >
          <Text style={styles.backText}>← Volver</Text>
        </Pressable>

        <View style={styles.resetContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Restablecer Contraseña</Text>
            <Text style={styles.subtitle}>
              Crea una nueva contraseña segura para acceder a tu cuenta.
            </Text>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Token de Recuperación</Text>
              <TextInput
                value={token}
                onChangeText={(v) => {
                  setToken(v);
                  if (error) setError(null);
                }}
                placeholder="Pega el token de tu correo"
                placeholderTextColor="#A89F95"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                editable={!cargando}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Nueva Contraseña</Text>
              <TextInput
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  if (error) setError(null);
                }}
                placeholder={`Mínimo ${PASSWORD_MIN} caracteres`}
                placeholderTextColor="#A89F95"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                style={styles.input}
                editable={!cargando}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirmar Nueva Contraseña</Text>
              <TextInput
                value={confirmPassword}
                onChangeText={(v) => {
                  setConfirmPassword(v);
                  if (error) setError(null);
                }}
                placeholder="Repite la nueva contraseña"
                placeholderTextColor="#A89F95"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                style={styles.input}
                editable={!cargando}
              />
            </View>

            <Pressable
              onPress={() => void handleCambiar()}
              disabled={cargando}
              style={[styles.primaryButton, cargando && styles.primaryButtonDisabled]}
            >
              {cargando ? (
                <ActivityIndicator color="#FAF6F0" />
              ) : (
                <Text style={styles.primaryButtonText}>Cambiar Contraseña</Text>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: '#F5EFE6',
  },
  screen: {
    flexGrow: 1,
    backgroundColor: '#F5EFE6',
    paddingHorizontal: 28,
    paddingVertical: 32,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 14,
  },
  backText: {
    color: '#2D1B14',
    fontSize: 13,
    fontWeight: '700',
  },
  resetContent: {
    flexGrow: 1,
    alignItems: 'center',
    gap: 14,
  },
  header: {
    alignItems: 'center',
    gap: 6,
    width: '100%',
  },
  title: {
    color: '#0052CC',
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 34,
    textAlign: 'center',
  },
  subtitle: {
    color: '#7A7067',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 310,
  },
  resetIcon: {
    fontSize: 44,
    lineHeight: 52,
    marginTop: 40,
  },
  form: {
    width: '100%',
    gap: 12,
    marginTop: 8,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    color: '#2D1B14',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  input: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5DDD3',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#26211D',
    fontSize: 14,
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: '100%',
  },
  errorText: {
    color: '#991B1B',
    fontSize: 12,
    fontWeight: '600',
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#2D1B14',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#FAF6F0',
    fontSize: 15,
    fontWeight: '700',
  },
  actionsColumn: {
    width: '100%',
    gap: 14,
    alignItems: 'center',
    marginTop: 8,
  },
});

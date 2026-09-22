// src/app/(auth)/olvidaste-contrasena.tsx
//
// Pantalla de solicitud de recuperación (INT4-21). Diseño basado en el
// mockup (cloudcoffee-react/Olvidaste_Contraseña). Llama a
// POST /v1/auth/password/recovery con el correo. Muestra solo error y
// éxito: el estado "Revisa tu Correo" con opción de reenviar el enlace.

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
import { solicitarRecuperacion } from '../../services/auth';

export default function OlvidasteContrasenaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [cargando, setCargando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValido = /\S+@\S+\.\S+/.test(email.trim());

  const handleEnviar = async (): Promise<void> => {
    if (!emailValido) {
      setError('Ingresa un correo electrónico válido.');
      return;
    }

    setCargando(true);
    setError(null);

    try {
      await solicitarRecuperacion(email);
      setEnviado(true);
    } catch (errorApi) {
      setError(toApiError(errorApi as never).message);
    } finally {
      setCargando(false);
    }
  };

  const handleReenviar = async (): Promise<void> => {
    setReenviando(true);
    setError(null);

    try {
      await solicitarRecuperacion(email);
    } catch (errorApi) {
      setError(toApiError(errorApi as never).message);
    } finally {
      setReenviando(false);
    }
  };

  const handleVolver = (): void => {
    setEnviado(false);
    setEmail('');
    setError(null);
  };

  const handleRestaurar = (): void => {
    router.push('/(auth)/restaurar-contrasena');
  };

  if (enviado) {
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
          <Pressable onPress={handleVolver} style={styles.backButton} hitSlop={8}>
            <Text style={styles.backText}>← Volver</Text>
          </Pressable>

          <View style={styles.resetContent}>
            <Text style={styles.resetIcon}>📩</Text>

            <View style={styles.badge}>
              <Text style={styles.badgeText}>ENLACE GENERADO</Text>
            </View>

            <Text style={styles.title}>Revisa tu Correo</Text>

            <Text style={styles.subtitle}>
              Hemos enviado un enlace de acceso directo para restablecer tu contraseña a:
            </Text>

            <View style={styles.emailChip}>
              <Text style={styles.emailIcon}>👤</Text>
              <Text style={styles.emailText}>{email.trim().toLowerCase()}</Text>
            </View>

            <Text style={styles.hintText}>
              Copia el token del enlace que llegó a tu correo para crear una nueva clave de acceso.
            </Text>

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.actionsColumn}>
              <Pressable onPress={handleRestaurar} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Volver a Iniciar Sesión</Text>
              </Pressable>

              <Pressable onPress={() => void handleReenviar()} disabled={reenviando}>
                <Text style={styles.resendLink}>
                  {reenviando ? 'Reenviando…' : '¿No recibiste el correo? Reenviar enlace'}
                </Text>
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
            <Text style={styles.title}>Recuperar Acceso</Text>
            <Text style={styles.subtitle}>
              Ingresa tu correo registrado para recibir el enlace de restablecimiento.
            </Text>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Correo Electrónico</Text>
              <TextInput
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  if (error) setError(null);
                }}
                placeholder="ejemplo@uct.cl o personal"
                placeholderTextColor="#A89F95"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                style={styles.input}
                editable={!cargando}
              />
            </View>

            <Pressable
              onPress={() => void handleEnviar()}
              disabled={cargando}
              style={[styles.primaryButton, cargando && styles.primaryButtonDisabled]}
            >
              {cargando ? (
                <ActivityIndicator color="#FAF6F0" />
              ) : (
                <Text style={styles.primaryButtonText}>Enviar Enlace</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              ¿Recordaste tu contraseña?{' '}
              <Pressable onPress={() => router.replace('/(auth)/login')} hitSlop={8}>
                <Text style={styles.footerLink}>Inicia sesión aquí</Text>
              </Pressable>
            </Text>
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
    marginTop: 24,
  },
  badge: {
    backgroundColor: '#E0EDFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  badgeText: {
    color: '#0052CC',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  emailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    width: '100%',
  },
  emailIcon: {
    fontSize: 16,
  },
  emailText: {
    color: '#1D2433',
    fontSize: 14,
    fontWeight: '700',
  },
  hintText: {
    color: '#7A7067',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 17,
    textAlign: 'center',
    maxWidth: 300,
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
  resendLink: {
    color: '#0284C7',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  footer: {
    alignItems: 'center',
    marginTop: 'auto',
    paddingTop: 16,
  },
  footerText: {
    color: '#7A7067',
    fontSize: 13,
    fontWeight: '500',
  },
  footerLink: {
    color: '#0284C7',
    fontWeight: '700',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});

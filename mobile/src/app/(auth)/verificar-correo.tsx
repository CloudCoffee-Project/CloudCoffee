// src/app/(auth)/verificar-correo.tsx
//
// Pantalla de verificación de cuenta (INT4-20). Diseño basado en el mockup
// (cloudcoffee-react/Verificar_Correo), fiel al backend real:
//   - POST /v1/auth/verificacion         { token }   -> 200 { email, verificado }
//   - POST /v1/auth/verificacion/reenviar { email }  -> 202
// El token que llega por correo es de un solo uso y vence a las 24 h.

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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toApiError } from '../../services/httpClient';
import { reenviarVerificacion, verificarCorreo } from '../../services/auth';

export default function VerificarCorreoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { email } = useLocalSearchParams<{ email?: string }>();

  const [token, setToken] = useState('');
  const [cargando, setCargando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [verificado, setVerificado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const correo = (email ?? '').trim().toLowerCase();

  const handleConfirmar = async (): Promise<void> => {
    if (!token.trim()) {
      setError('Ingresa el token que recibiste en tu correo.');
      return;
    }

    setCargando(true);
    setError(null);
    setMensaje(null);

    try {
      const resultado = await verificarCorreo(token);
      setVerificado(resultado.verificado);
    } catch (errorApi) {
      setError(toApiError(errorApi as never).message);
    } finally {
      setCargando(false);
    }
  };

  const handleReenviar = async (): Promise<void> => {
    if (!correo) {
      setError('No tenemos el correo de la cuenta para reenviar el token.');
      return;
    }

    setReenviando(true);
    setError(null);
    setMensaje(null);

    try {
      await reenviarVerificacion(correo);
      setMensaje('Te enviamos un token nuevo. Revisa tu correo.');
    } catch (errorApi) {
      setError(toApiError(errorApi as never).message);
    } finally {
      setReenviando(false);
    }
  };

  const handleContinuar = (): void => {
    router.replace('/(auth)/login');
  };

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
        <View style={styles.verifyContent}>
          <Text style={styles.verifyIcon}>{verificado ? '✔️' : '✉️'}</Text>

          <View style={styles.badge}>
            <Text style={styles.badgeText}>VERIFICACIÓN DE CUENTA</Text>
          </View>

          <Text style={styles.title}>Confirma tu Correo</Text>

          <Text style={styles.question}>
            {verificado ? (
              '¡Listo! Tu correo fue validado correctamente.'
            ) : (
              <>
                Enviamos un token a tu correo para confirmar que la cuenta te pertenece. Ingresa el
                código para continuar.
              </>
            )}
          </Text>

          {correo ? (
            <View style={styles.emailCard}>
              <Text style={styles.emailIcon}>👤</Text>
              <Text style={styles.emailText}>{correo}</Text>
            </View>
          ) : null}

          {verificado ? (
            <Pressable onPress={() => void handleContinuar()} style={styles.confirmButton}>
              <Text style={styles.confirmButtonText}>Continuar</Text>
            </Pressable>
          ) : (
            <View style={styles.actionsGroup}>
              {(error || mensaje) && (
                <View style={[styles.messageBox, error ? styles.errorBox : styles.infoBox]}>
                  <Text style={error ? styles.errorText : styles.infoText}>{error ?? mensaje}</Text>
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Token de verificación</Text>
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
                  editable={!cargando && !reenviando}
                />
              </View>

              <Pressable
                onPress={() => void handleConfirmar()}
                disabled={cargando || reenviando}
                style={[styles.confirmButton, cargando && styles.confirmButtonDisabled]}
              >
                {cargando ? (
                  <ActivityIndicator color="#FAF6F0" />
                ) : (
                  <Text style={styles.confirmButtonText}>Confirmar Correo</Text>
                )}
              </Pressable>

              <Pressable onPress={() => void handleReenviar()} disabled={cargando || reenviando}>
                <Text style={styles.resendLink}>
                  {reenviando ? 'Reenviando…' : '¿No llegó el token? Reenviar código'}
                </Text>
              </Pressable>
            </View>
          )}
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
    paddingVertical: 24,
  },
  verifyContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  verifyIcon: {
    fontSize: 44,
    lineHeight: 52,
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
  title: {
    color: '#0284C7',
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 34,
  },
  question: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 310,
  },
  emailCard: {
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
    shadowColor: '#2D1B14',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  emailIcon: {
    fontSize: 16,
  },
  emailText: {
    color: '#1D2433',
    fontSize: 14,
    fontWeight: '700',
  },
  actionsGroup: {
    width: '100%',
    gap: 14,
    marginTop: 6,
  },
  messageBox: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
  },
  infoBox: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
    borderWidth: 1,
  },
  errorText: {
    color: '#991B1B',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  infoText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
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
  confirmButton: {
    width: '100%',
    backgroundColor: '#2D1B14',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#2D1B14',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  confirmButtonDisabled: {
    opacity: 0.6,
  },
  confirmButtonText: {
    color: '#FAF6F0',
    fontSize: 15,
    fontWeight: '700',
  },
  resendLink: {
    color: '#0284C7',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});

// src/app/(cliente)/cambiar-contrasena.tsx
//
// Pantalla de cambio de contraseña estando autenticado (INT4-24). Se accede
// desde Mi Perfil (perfil.tsx → (cliente)/cambiar-contrasena). Llama a
// POST /v1/auth/password/change con la contraseña actual y la nueva.
// Validaciones espejo del backend (contraseña nueva mínimo 8 caracteres).
// El contrato del auth-service aún no existe: hasta que se implemente, la
// pantalla muestra el error normalizado del endpoint (404) sin romper.

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
import { cambiarContrasena } from '../../services/auth';

export const PASSWORD_MIN = 8;

interface FormularioCambioContrasena {
  passwordActual: string;
  nuevaPassword: string;
  confirmarPassword: string;
}

const FORMULARIO_INICIAL: FormularioCambioContrasena = {
  passwordActual: '',
  nuevaPassword: '',
  confirmarPassword: '',
};

type ErrorCampo = 'actual' | 'nueva-longitud' | 'coinciden' | null;

export function validarCambioContrasena(form: FormularioCambioContrasena): ErrorCampo {
  if (!form.passwordActual) {
    return 'actual';
  }
  if (form.nuevaPassword.length < PASSWORD_MIN) {
    return 'nueva-longitud';
  }
  if (form.nuevaPassword !== form.confirmarPassword) {
    return 'coinciden';
  }
  return null;
}

const MENSAJES_ERROR: Record<Exclude<ErrorCampo, null>, string> = {
  actual: 'Ingresa tu contraseña actual.',
  'nueva-longitud': `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`,
  coinciden: 'Las contraseñas no coinciden.',
};

export default function CambiarContrasenaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [form, setForm] = useState<FormularioCambioContrasena>(FORMULARIO_INICIAL);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<ErrorCampo>(null);
  const [errorApi, setErrorApi] = useState<string | null>(null);
  const [exito, setExito] = useState(false);

  const setCampo = (campo: keyof FormularioCambioContrasena, valor: string): void => {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    if (error || errorApi) {
      setError(null);
      setErrorApi(null);
    }
  };

  const handleCambiar = async (): Promise<void> => {
    const errorValidacion = validarCambioContrasena(form);
    if (errorValidacion) {
      setError(errorValidacion);
      return;
    }

    setCargando(true);
    setError(null);
    setErrorApi(null);

    try {
      await cambiarContrasena({
        passwordActual: form.passwordActual,
        nuevaPassword: form.nuevaPassword,
      });
      setExito(true);
    } catch (errorCapturado) {
      setErrorApi(toApiError(errorCapturado as never).message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
            <Text style={styles.backText}>← Volver</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Cambiar Contraseña</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {exito ? (
            <View style={styles.successCard}>
              <Text style={styles.successIcon}>🔒</Text>
              <Text style={styles.successTitle}>Contraseña Cambiada</Text>
              <Text style={styles.successText}>
                Tu contraseña fue actualizada con éxito. Úsala la próxima vez que inicies sesión.
              </Text>
              <Pressable
                onPress={() => router.back()}
                style={styles.primaryButton}
                testID="volver-de-exito"
              >
                <Text style={styles.primaryButtonText}>Listo</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>SEGURIDAD</Text>
              </View>

              <Text style={styles.title}>Actualiza tu contraseña</Text>
              <Text style={styles.subtitle}>
                Ingresa tu contraseña actual y elige una nueva que no hayas usado antes.
              </Text>

              {(error || errorApi) && (
                <View style={styles.errorBox} testID="error-cambio">
                  <Text style={styles.errorText}>
                    {error ? MENSAJES_ERROR[error as Exclude<ErrorCampo, null>] : errorApi}
                  </Text>
                </View>
              )}

              <View style={styles.form}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Contraseña Actual</Text>
                  <TextInput
                    value={form.passwordActual}
                    onChangeText={(v) => setCampo('passwordActual', v)}
                    placeholder="Ingresa tu contraseña actual"
                    placeholderTextColor="#A89F95"
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="current-password"
                    style={styles.input}
                    editable={!cargando}
                    testID="contrasena-actual"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Nueva Contraseña</Text>
                  <TextInput
                    value={form.nuevaPassword}
                    onChangeText={(v) => setCampo('nuevaPassword', v)}
                    placeholder={`Mínimo ${PASSWORD_MIN} caracteres`}
                    placeholderTextColor="#A89F95"
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="new-password"
                    style={styles.input}
                    editable={!cargando}
                    testID="nueva-contrasena"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Confirmar Nueva Contraseña</Text>
                  <TextInput
                    value={form.confirmarPassword}
                    onChangeText={(v) => setCampo('confirmarPassword', v)}
                    placeholder="Repite la nueva contraseña"
                    placeholderTextColor="#A89F95"
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="new-password"
                    style={styles.input}
                    editable={!cargando}
                    testID="confirmar-contrasena"
                  />
                </View>

                <Pressable
                  onPress={() => void handleCambiar()}
                  disabled={cargando}
                  style={[styles.primaryButton, cargando && styles.primaryButtonDisabled]}
                  testID="guardar-cambio"
                >
                  {cargando ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Cambiar Contraseña</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: '#FAF7F2',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EFE9DE',
  },
  backButton: {
    width: 60,
  },
  backText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '700',
  },
  headerTitle: {
    color: '#1D2433',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSpacer: {
    width: 60,
  },
  content: {
    padding: 24,
    gap: 12,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF8DF',
    borderColor: '#F3DC87',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  badgeText: {
    color: '#1D2433',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  title: {
    color: '#1D2433',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  subtitle: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: '#991B1B',
    fontSize: 12,
    fontWeight: '600',
  },
  form: {
    gap: 14,
    marginTop: 4,
  },
  inputGroup: {
    gap: 6,
  },
  label: {
    color: '#1D2433',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  input: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#1D2433',
    fontSize: 14,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#0052CC',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  successCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    marginTop: 24,
  },
  successIcon: {
    fontSize: 40,
    lineHeight: 48,
  },
  successTitle: {
    color: '#1D2433',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  successText: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
    textAlign: 'center',
  },
});

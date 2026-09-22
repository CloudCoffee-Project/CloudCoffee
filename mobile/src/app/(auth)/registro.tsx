// src/app/(auth)/registro.tsx
//
// Pantalla de creación de cuenta (INT4-19). Diseño basado en el mockup
// (cloudcoffee-react/Registro_Sesion). Llama a POST /v1/auth/register vía el
// servicio auth. Validaciones alineadas al backend (contraseña min 8),
// no al mockup (que decía 6). Tras registrar, el backend pide verificar el
// correo antes de poder iniciar sesión, así que redirige a verificar-correo.

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
import { registrar } from '../../services/auth';

const TELEFONO_REGEX = /^[0-9+ ()-]{6,20}$/;

interface FormularioRegistro {
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  password: string;
  confirmPassword: string;
}

const FORMULARIO_INICIAL: FormularioRegistro = {
  nombre: '',
  apellido: '',
  email: '',
  telefono: '',
  password: '',
  confirmPassword: '',
};

type ErrorCampo =
  'nombre-apellido' | 'email' | 'telefono' | 'password-longitud' | 'password-coinciden' | null;

function validar(datos: FormularioRegistro): ErrorCampo {
  if (!datos.nombre.trim() || !datos.apellido.trim()) {
    return 'nombre-apellido';
  }
  if (!/\S+@\S+\.\S+/.test(datos.email.trim())) {
    return 'email';
  }
  if (!TELEFONO_REGEX.test(datos.telefono.trim())) {
    return 'telefono';
  }
  if (datos.password.length < 8) {
    return 'password-longitud';
  }
  if (datos.password !== datos.confirmPassword) {
    return 'password-coinciden';
  }
  return null;
}

const MENSAJES_ERROR: Record<Exclude<ErrorCampo, null>, string> = {
  'nombre-apellido': 'Por favor ingresa tu nombre y apellido.',
  email: 'Ingresa un correo electrónico válido.',
  telefono: 'El teléfono no tiene un formato válido. Usa solo números y + - ( ).',
  'password-longitud': 'La contraseña debe tener al menos 8 caracteres.',
  'password-coinciden': 'Las contraseñas no coinciden.',
};

export default function RegistroScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [form, setForm] = useState<FormularioRegistro>(FORMULARIO_INICIAL);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<ErrorCampo>(null);
  const [errorApi, setErrorApi] = useState<string | null>(null);

  const setCampo = (campo: keyof FormularioRegistro, valor: string): void => {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    if (error || errorApi) {
      setError(null);
      setErrorApi(null);
    }
  };

  const handleRegistrar = async (): Promise<void> => {
    const errorValidacion = validar(form);
    if (errorValidacion) {
      setError(errorValidacion);
      return;
    }

    setCargando(true);
    setErrorApi(null);

    try {
      await registrar({
        nombre: form.nombre,
        apellido: form.apellido,
        email: form.email,
        telefono: form.telefono,
        password: form.password,
      });

      // El backend exige verificar el correo antes de poder iniciar sesión.
      router.replace({
        pathname: '/(auth)/verificar-correo',
        params: { email: form.email.trim().toLowerCase() },
      });
    } catch (errorApiCatch) {
      setErrorApi(toApiError(errorApiCatch as never).message);
      setCargando(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.screen, { paddingTop: 28 + insets.top }]}
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

        <View style={styles.registerContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Crear Cuenta</Text>
            <Text style={styles.subtitle}>
              Regístrate para comprar y pedir tu café sin filas en los campus UCT.
            </Text>
          </View>

          {(error || errorApi) && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error ? MENSAJES_ERROR[error] : errorApi}</Text>
            </View>
          )}

          <View style={styles.form}>
            <View style={styles.inputRowDouble}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Nombre</Text>
                <TextInput
                  value={form.nombre}
                  onChangeText={(v) => setCampo('nombre', v)}
                  placeholder="Ej. Francisca"
                  placeholderTextColor="#A89F95"
                  style={styles.input}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Apellido</Text>
                <TextInput
                  value={form.apellido}
                  onChangeText={(v) => setCampo('apellido', v)}
                  placeholder="Ej. Pérez"
                  placeholderTextColor="#A89F95"
                  style={styles.input}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Correo Institucional o Personal</Text>
              <TextInput
                value={form.email}
                onChangeText={(v) => setCampo('email', v)}
                placeholder="ejemplo@uct.cl / @alu.uct.cl"
                placeholderTextColor="#A89F95"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                style={styles.input}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Teléfono de Contacto</Text>
              <TextInput
                value={form.telefono}
                onChangeText={(v) => setCampo('telefono', v)}
                placeholder="+56 9 1234 5678"
                placeholderTextColor="#A89F95"
                keyboardType="phone-pad"
                style={styles.input}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Contraseña</Text>
              <TextInput
                value={form.password}
                onChangeText={(v) => setCampo('password', v)}
                placeholder="Mínimo 8 caracteres"
                placeholderTextColor="#A89F95"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                style={styles.input}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirmar Contraseña</Text>
              <TextInput
                value={form.confirmPassword}
                onChangeText={(v) => setCampo('confirmPassword', v)}
                placeholder="Repite tu contraseña"
                placeholderTextColor="#A89F95"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                style={styles.input}
              />
            </View>

            <Pressable
              onPress={() => void handleRegistrar()}
              disabled={cargando}
              style={[styles.primaryButton, cargando && styles.primaryButtonDisabled]}
            >
              {cargando ? (
                <ActivityIndicator color="#FAF6F0" />
              ) : (
                <Text style={styles.primaryButtonText}>Crear Cuenta</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              ¿Ya tienes cuenta?{' '}
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
    paddingHorizontal: 24,
    paddingVertical: 28,
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
  registerContent: {
    gap: 16,
  },
  header: {
    alignItems: 'center',
    gap: 6,
  },
  title: {
    color: '#0284C7',
    fontSize: 31,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 36,
  },
  subtitle: {
    color: '#7A7067',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 290,
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
    gap: 12,
  },
  inputRowDouble: {
    flexDirection: 'row',
    gap: 10,
  },
  inputGroup: {
    flex: 1,
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
  footer: {
    alignItems: 'center',
    marginTop: 10,
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

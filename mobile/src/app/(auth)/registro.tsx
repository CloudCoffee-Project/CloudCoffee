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

import { mensajeDeErrorApi } from '../../services/httpClient';
import { registrar } from '../../services/auth';
import { tokens } from '../../theme/tokens';

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
      setErrorApi(mensajeDeErrorApi(errorApiCatch));
      setCargando(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.screen,
          { paddingTop: tokens.espaciado['4xl'] + insets.top },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => router.replace('/(auth)/portada')}
          style={styles.backButton}
          hitSlop={tokens.espaciado.md}
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
                  placeholderTextColor={tokens.colores.placeholder}
                  style={styles.input}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Apellido</Text>
                <TextInput
                  value={form.apellido}
                  onChangeText={(v) => setCampo('apellido', v)}
                  placeholder="Ej. Pérez"
                  placeholderTextColor={tokens.colores.placeholder}
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
                placeholderTextColor={tokens.colores.placeholder}
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
                placeholderTextColor={tokens.colores.placeholder}
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
                placeholderTextColor={tokens.colores.placeholder}
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
                placeholderTextColor={tokens.colores.placeholder}
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
                <ActivityIndicator color={tokens.colores.crema} />
              ) : (
                <Text style={styles.primaryButtonText}>Crear Cuenta</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              ¿Ya tienes cuenta?{' '}
              <Pressable
                onPress={() => router.replace('/(auth)/login')}
                hitSlop={tokens.espaciado.md}
              >
                <Text style={styles.footerLink}>Inicia sesión aquí</Text>
              </Pressable>
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Los anchos máximos de texto y medidas puntuales de layout se mantienen a
// mano: ver regla 3 en src/theme/tokens.ts.
const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: tokens.colores.fondoAuth,
  },
  screen: {
    flexGrow: 1,
    backgroundColor: tokens.colores.fondoAuth,
    paddingHorizontal: tokens.espaciado['3xl'],
    paddingVertical: tokens.espaciado['4xl'],
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: tokens.espaciado.xxl,
  },
  backText: {
    color: tokens.colores.tinta,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  registerContent: {
    gap: tokens.espaciado.xxxl,
  },
  header: {
    alignItems: 'center',
    gap: tokens.espaciado.sm,
  },
  title: {
    ...tokens.tipografia.texto.tituloAcceso,
    color: tokens.colores.marca,
  },
  subtitle: {
    ...tokens.tipografia.texto.cuerpoChico,
    color: tokens.colores.textoSecundario,
    textAlign: 'center',
    maxWidth: 290,
  },
  errorBox: {
    backgroundColor: tokens.colores.errorFondo,
    borderColor: tokens.colores.errorBorde,
    borderWidth: tokens.grosores.fino,
    borderRadius: tokens.radios.md,
    paddingHorizontal: tokens.espaciado.xl,
    paddingVertical: tokens.espaciado.lg,
  },
  errorText: {
    color: tokens.colores.errorTexto,
    fontSize: tokens.tipografia.tamano.detalle,
    fontWeight: tokens.tipografia.peso.semibold,
  },
  form: {
    gap: tokens.espaciado.xl,
  },
  inputRowDouble: {
    flexDirection: 'row',
    gap: tokens.espaciado.lg,
  },
  inputGroup: {
    flex: 1,
    gap: tokens.espaciado.sm,
  },
  label: {
    ...tokens.tipografia.texto.etiqueta,
    color: tokens.colores.tinta,
    textTransform: 'uppercase',
  },
  input: {
    width: '100%',
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.input,
    borderColor: tokens.colores.bordeAuth,
    borderRadius: tokens.radios.lg,
    paddingHorizontal: tokens.espaciado.xxl,
    paddingVertical: tokens.espaciado.xl,
    color: tokens.colores.tintaSuave,
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: tokens.colores.tinta,
    borderRadius: tokens.radios.xl,
    paddingVertical: tokens.espaciado.xxl,
    alignItems: 'center',
    marginTop: tokens.espaciado.sm,
  },
  primaryButtonDisabled: {
    opacity: tokens.estados.deshabilitado,
  },
  primaryButtonText: {
    ...tokens.tipografia.texto.boton,
    color: tokens.colores.crema,
  },
  footer: {
    alignItems: 'center',
    marginTop: tokens.espaciado.lg,
  },
  footerText: {
    color: tokens.colores.textoSecundario,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.medio,
  },
  footerLink: {
    color: tokens.colores.marca,
    fontWeight: tokens.tipografia.peso.negrita,
    fontSize: tokens.tipografia.tamano.cuerpo,
    textDecorationLine: 'underline',
  },
});

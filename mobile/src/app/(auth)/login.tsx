// src/app/(auth)/login.tsx
//
// Pantalla de inicio de sesión (INT4-18). Diseño basado en el mockup
// (cloudcoffee-react/Inicio_Sesion). Llama a POST /v1/auth/login vía el
// servicio auth y, al autenticar, persiste los tokens e inyecta la sesión
// en el AuthContext (el guard del root layout redirige según el rol).

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
import { login } from '../../services/auth';
import { useAuth } from '../../context/AuthContext';
import { tokens } from '../../theme/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { iniciarSesion } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValido = /\S+@\S+\.\S+/.test(email.trim());

  const handleIngresar = async (): Promise<void> => {
    if (!emailValido) {
      setError('Ingresa un correo electrónico válido.');
      return;
    }
    if (!password) {
      setError('Ingresa tu contraseña.');
      return;
    }

    setCargando(true);
    setError(null);

    try {
      const tokens = await login({ email, password });
      const sesion = await iniciarSesion(tokens);
      if (!sesion) {
        setError('No se pudo iniciar la sesión. Intenta nuevamente.');
        return;
      }
      // El guard de _layout redirige solo según el rol de la sesión.
    } catch (errorApi) {
      setError(toApiError(errorApi as never).message);
    } finally {
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
          { paddingTop: tokens.espaciado['5xl'] + insets.top },
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

        <View style={styles.loginContent}>
          <View style={styles.header}>
            <Text style={styles.title}>
              Iniciar <Text style={styles.highlightText}>Sesión</Text>
            </Text>
            <Text style={styles.subtitle}>Ingresa tus credenciales para continuar al sistema.</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Correo Institucional / Administrativo</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="ejemplo@ca.cloudcoffee.cl / @uct.cl / @alu.uct.cl"
                placeholderTextColor={tokens.colores.placeholder}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                style={styles.input}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Contraseña</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={tokens.colores.placeholder}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="password"
                style={styles.input}
              />
            </View>

            <View style={styles.forgotRow}>
              <Pressable
                onPress={() => router.push('/(auth)/olvidaste-contrasena')}
                hitSlop={tokens.espaciado.md}
              >
                <Text style={styles.forgotLink}>¿Olvidaste tu contraseña?</Text>
              </Pressable>
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Pressable
              onPress={() => void handleIngresar()}
              disabled={cargando}
              style={[styles.primaryButton, cargando && styles.primaryButtonDisabled]}
            >
              {cargando ? (
                <ActivityIndicator color={tokens.colores.crema} />
              ) : (
                <Text style={styles.primaryButtonText}>Ingresar</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              ¿No tienes una cuenta?{' '}
              <Pressable
                onPress={() => router.push('/(auth)/registro')}
                hitSlop={tokens.espaciado.md}
              >
                <Text style={styles.footerLink}>Regístrate gratis</Text>
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
    paddingHorizontal: tokens.espaciado['4xl'],
    paddingVertical: tokens.espaciado['5xl'],
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
  loginContent: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: tokens.espaciado['22'],
    marginVertical: tokens.espaciado.xl,
  },
  header: {
    alignItems: 'center',
    gap: tokens.espaciado.sm,
  },
  title: {
    ...tokens.tipografia.texto.tituloAcceso,
    color: tokens.colores.tinta,
    textAlign: 'center',
  },
  highlightText: {
    color: tokens.colores.marca,
  },
  subtitle: {
    ...tokens.tipografia.texto.cuerpo,
    color: tokens.colores.textoSecundario,
    textAlign: 'center',
    maxWidth: 300,
  },
  form: {
    gap: tokens.espaciado.xxl,
  },
  inputGroup: {
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
  forgotRow: {
    alignItems: 'flex-end',
  },
  forgotLink: {
    color: tokens.colores.textoSecundario,
    fontSize: tokens.tipografia.tamano.detalle,
    fontWeight: tokens.tipografia.peso.semibold,
  },
  errorText: {
    ...tokens.tipografia.texto.cuerpoChico,
    color: tokens.colores.errorAcceso,
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
  },
});

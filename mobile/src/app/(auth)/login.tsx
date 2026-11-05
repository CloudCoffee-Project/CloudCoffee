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
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Presionable } from '../../components/Presionable';
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
  const [mostrarPassword, setMostrarPassword] = useState(false);
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
        <Presionable
          onPress={() => router.replace('/(auth)/portada')}
          style={styles.backButton}
          hitSlop={tokens.espaciado.md}
          accessibilityRole="button"
          accessibilityLabel="Volver a la portada"
        >
          <Text style={styles.backText}>← Volver</Text>
        </Presionable>

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
              <View style={styles.passwordWrapper}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={tokens.colores.placeholder}
                  secureTextEntry={!mostrarPassword}
                  autoCapitalize="none"
                  autoComplete="current-password"
                  style={styles.passwordInput}
                />
                <Presionable
                  style={styles.passwordToggle}
                  onPress={() => setMostrarPassword((prev) => !prev)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={mostrarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  <Image
                    source={
                      mostrarPassword
                        ? require('../../../assets/ojo-cerrado.png')
                        : require('../../../assets/ojo-abierto.png')
                    }
                    style={styles.passwordToggleIcono}
                    resizeMode="contain"
                  />
                </Presionable>
              </View>
            </View>

            <View style={styles.forgotRow}>
              <Presionable
                onPress={() => router.push('/(auth)/olvidaste-contrasena')}
                style={styles.forgotButton}
                hitSlop={tokens.espaciado.md}
                accessibilityRole="link"
              >
                <Text style={styles.forgotLink}>¿Olvidaste tu contraseña?</Text>
              </Presionable>
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}

            <Presionable
              onPress={() => void handleIngresar()}
              disabled={cargando}
              accessibilityRole="button"
              accessibilityState={{ disabled: cargando, busy: cargando }}
              style={[styles.primaryButton, cargando && styles.primaryButtonDisabled]}
            >
              {cargando ? (
                <ActivityIndicator color={tokens.colores.crema} />
              ) : (
                <Text style={styles.primaryButtonText}>Ingresar</Text>
              )}
            </Presionable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>¿No tienes una cuenta?</Text>
            <Presionable
              onPress={() => router.push('/(auth)/registro')}
              style={styles.footerLinkButton}
              hitSlop={tokens.espaciado.sm}
              accessibilityRole="link"
            >
              <Text style={styles.footerLink}>Regístrate gratis</Text>
            </Presionable>
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
    justifyContent: 'center',
    minHeight: tokens.tamanos.areaTactil,
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
    minHeight: tokens.tamanos.areaTactil,
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeControl,
    borderRadius: tokens.radios.lg,
    paddingHorizontal: tokens.espaciado.xxl,
    paddingVertical: tokens.espaciado.xl,
    color: tokens.colores.tintaSuave,
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
  },
  passwordInput: {
    flex: 1,
    minHeight: tokens.tamanos.areaTactil,
    paddingHorizontal: tokens.espaciado.xxl,
    paddingVertical: tokens.espaciado.xl,
    color: tokens.colores.tintaSuave,
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
    borderWidth: 0,
  },
  passwordWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeControl,
    borderRadius: tokens.radios.lg,
  },
  passwordToggle: {
    paddingHorizontal: tokens.espaciado.lg,
    paddingVertical: tokens.espaciado.xl,
    justifyContent: 'center',
    alignItems: 'center',
  },
  passwordToggleIcono: {
    width: 22,
    height: 22,
  },
  forgotRow: {
    alignItems: 'flex-end',
  },
  forgotButton: {
    justifyContent: 'center',
    minHeight: tokens.tamanos.areaTactil,
    paddingHorizontal: tokens.espaciado.sm,
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
    minHeight: tokens.tamanos.areaTactil,
    backgroundColor: tokens.colores.tinta,
    borderRadius: tokens.radios.xl,
    paddingVertical: tokens.espaciado.xxl,
    alignItems: 'center',
    justifyContent: 'center',
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.espaciado.xs,
  },
  footerText: {
    color: tokens.colores.textoSecundario,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.medio,
  },
  footerLinkButton: {
    justifyContent: 'center',
    minHeight: tokens.tamanos.areaTactil,
    paddingHorizontal: tokens.espaciado.xs,
  },
  footerLink: {
    color: tokens.colores.marcaEnlace,
    fontWeight: tokens.tipografia.peso.negrita,
    fontSize: tokens.tipografia.tamano.cuerpo,
  },
});

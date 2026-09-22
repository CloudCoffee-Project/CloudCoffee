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
                placeholderTextColor="#A89F95"
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
                placeholderTextColor="#A89F95"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="password"
                style={styles.input}
              />
            </View>

            <View style={styles.forgotRow}>
              <Pressable onPress={() => router.push('/(auth)/olvidaste-contrasena')} hitSlop={8}>
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
                <ActivityIndicator color="#FAF6F0" />
              ) : (
                <Text style={styles.primaryButtonText}>Ingresar</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              ¿No tienes una cuenta?{' '}
              <Pressable onPress={() => router.push('/(auth)/registro')} hitSlop={8}>
                <Text style={styles.footerLink}>Regístrate gratis</Text>
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
  loginContent: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 22,
    marginVertical: 12,
  },
  header: {
    alignItems: 'center',
    gap: 6,
  },
  title: {
    color: '#2D1B14',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.6,
    lineHeight: 38,
    textAlign: 'center',
  },
  highlightText: {
    color: '#0284C7',
  },
  subtitle: {
    color: '#7A7067',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 300,
  },
  form: {
    gap: 14,
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
  forgotRow: {
    alignItems: 'flex-end',
  },
  forgotLink: {
    color: '#7A7067',
    fontSize: 12,
    fontWeight: '600',
  },
  errorText: {
    color: '#B25329',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
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
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#FAF6F0',
    fontSize: 15,
    fontWeight: '700',
  },
  footer: {
    alignItems: 'center',
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
  },
});

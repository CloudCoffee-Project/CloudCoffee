// src/app/(cajero)/perfil.tsx
//
// Perfil del cajero: consulta de datos personales y cierre de sesión
// (sin edición, siguiendo el estilo del perfil de cliente).
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AxiosError } from 'axios';

import { Presionable } from '../../components/Presionable';
import { useAuth } from '../../context/AuthContext';
import { obtenerPerfil } from '../../services/auth';
import type { PerfilUsuario } from '../../types/domain';
import type { ApiProblem } from '../../services/httpClient';
import { toApiError } from '../../services/httpClient';

function mensajeDeErrorApi(error: unknown): string {
  try {
    const apiError = toApiError(error as AxiosError<ApiProblem>);
    return apiError.message || 'No se pudo cargar el perfil.';
  } catch {
    return 'No se pudo cargar el perfil.';
  }
}

export default function CajeroPerfilScreen() {
  const { cerrarSesion } = useAuth();

  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const cargarPerfil = useCallback(async (): Promise<void> => {
    try {
      setErrorCarga(null);
      const datos = await obtenerPerfil();
      setPerfil(datos);
    } catch (error) {
      const apiError = toApiError(error as AxiosError<ApiProblem>);
      setErrorCarga(apiError.message || mensajeDeErrorApi(error));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch inicial de datos
    void cargarPerfil();
  }, [cargarPerfil]);

  const reintentar = (): void => {
    setCargando(true);
    setErrorCarga(null);
    void cargarPerfil();
  };

  const handleCerrarSesion = async (): Promise<void> => {
    try {
      await cerrarSesion();
    } catch {
      // El cierre de sesión nunca debe dejar la pantalla bloqueada
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {cargando ? (
          <ActivityIndicator size="large" color="#0052CC" testID="cargando-perfil-cajero" />
        ) : (
          <>
            <View style={styles.header}>
              <Text style={styles.badge}>CUENTA</Text>
              <Text style={styles.title}>Mi Perfil</Text>
              <Text style={styles.subtitle}>Datos de tu cuenta de cajero.</Text>
            </View>

            {errorCarga ? (
              <View style={styles.card} testID="perfil-cajero-error">
                <Text style={styles.errorTitulo}>No pudimos cargar tu perfil</Text>
                <Text style={styles.errorMensaje}>{errorCarga}</Text>
                <Presionable
                  style={styles.btnReintentar}
                  onPress={reintentar}
                  testID="reintentar-perfil-cajero"
                >
                  <Text style={styles.btnReintentarTexto}>Reintentar</Text>
                </Presionable>
              </View>
            ) : perfil === null ? null : (
              <View style={styles.card} testID="perfil-cajero-info">
                <Text style={styles.subformTitle}>Datos personales</Text>
                <Text style={styles.subformHint}>
                  Solo lectura. No es posible editar desde esta pantalla.
                </Text>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>NOMBRES</Text>
                  <View style={styles.readonlyField}>
                    <Text style={styles.readonlyText}>{perfil.nombre}</Text>
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>APELLIDOS</Text>
                  <View style={styles.readonlyField}>
                    <Text style={styles.readonlyText}>{perfil.apellido}</Text>
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>CORREO ELECTRÓNICO</Text>
                  <View style={styles.readonlyField}>
                    <Text style={styles.readonlyText}>{perfil.email}</Text>
                  </View>
                </View>
              </View>
            )}

            <View style={styles.footerCard}>
              <Presionable
                style={styles.btnCerrarSesion}
                onPress={handleCerrarSesion}
                testID="cerrar-sesion-cajero"
              >
                <Text style={styles.btnCerrarSesionTexto}>Cerrar sesión</Text>
              </Presionable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
    gap: 4,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E0F2FE',
    color: '#0369A1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
  },
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 20,
    gap: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  subformTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  subformHint: {
    fontSize: 13,
    color: '#475569',
    marginTop: -8,
  },
  formGroup: {
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  readonlyField: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  readonlyText: {
    fontSize: 15,
    color: '#111827',
  },
  errorTitulo: {
    fontSize: 16,
    fontWeight: '700',
    color: '#DC2626',
  },
  errorMensaje: {
    fontSize: 14,
    color: '#475569',
  },
  btnReintentar: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5F5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  btnReintentarTexto: {
    color: '#1D4ED8',
    fontWeight: '600',
  },
  footerCard: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  btnCerrarSesion: {
    backgroundColor: '#DC2626',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnCerrarSesionTexto: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

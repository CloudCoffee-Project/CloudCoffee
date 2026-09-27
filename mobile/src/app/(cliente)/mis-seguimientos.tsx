// src/app/(cliente)/mis-seguimientos.tsx
//
// "Mis Seguimientos" (INT4-45): lista los productos que el cliente sigue —para
// enterarse cuando vuelven a estar disponibles tras agotarse— con la opción de
// eliminar cada seguimiento. Ruta interna navegable desde Perfil (mismo patrón
// que Notificaciones), no un tab propio.
//
// El listado sale de GET /v1/catalog/seguimientos y la baja de cada ítem usa
// DELETE /v1/catalog/seguimientos/{id} (services/seguimientos.ts). El backend
// todavía no implementa el controller: la pantalla consume el contrato real y
// muestra el error normalizado (toApiError) si el gateway responde con
// problem+json, con botón de reintento ante fallos del listado.

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AxiosError } from 'axios';

import { eliminarSeguimiento, listarSeguimientos } from '../../services/seguimientos';
import { ApiProblem, toApiError } from '../../services/httpClient';
import type { Seguimiento } from '../../types/domain';

export default function MisSeguimientosScreen() {
  // null = aún cargando el listado inicial.
  const [seguimientos, setSeguimientos] = useState<Seguimiento[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  // Id del seguimiento cuya eliminación está en curso (desactiva su botón).
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  // Error normalizado de una eliminación fallida, mostrado como banner.
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);

  const recargar = useCallback(async (): Promise<void> => {
    try {
      const lista = await listarSeguimientos();
      setSeguimientos(lista);
      setErrorCarga(null);
    } catch (error) {
      const apiError = toApiError(error as AxiosError<ApiProblem>);
      setSeguimientos(null);
      setErrorCarga(apiError.message);
    }
  }, []);

  // Se recarga al ganar foco: refleja seguimientos creados/eliminados en otras
  // pantallas (p. ej. el alta desde el detalle de producto, INT4-53).
  useFocusEffect(
    useCallback(() => {
      void recargar();
    }, [recargar])
  );

  const reintentar = (): void => {
    void recargar();
  };

  // Pide confirmación antes de dar de baja un seguimiento; al confirmar llama
  // al servicio y remueve el ítem del estado local, o muestra el error
  // normalizado si el gateway responde con problem+json.
  const confirmarEliminar = (seguimiento: Seguimiento): void => {
    setErrorEliminar(null);
    Alert.alert('Eliminar seguimiento', `¿Dejar de seguir "${seguimiento.productoNombre}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          void eliminar(seguimiento);
        },
      },
    ]);
  };

  const eliminar = async (seguimiento: Seguimiento): Promise<void> => {
    setEliminandoId(seguimiento.id);
    setErrorEliminar(null);
    try {
      await eliminarSeguimiento(seguimiento.id);
      setSeguimientos((previos) => previos?.filter((s) => s.id !== seguimiento.id) ?? previos);
    } catch (error) {
      const apiError = toApiError(error as AxiosError<ApiProblem>);
      setErrorEliminar(apiError.message);
    } finally {
      setEliminandoId(null);
    }
  };

  return (
    <SafeAreaView style={styles.pantalla} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.contenido}>
        <Text style={styles.titulo}>Mis Seguimientos</Text>
        <Text style={styles.descripcion}>
          Los productos que sigues te avisan cuando vuelven a estar disponibles tras agotarse.
          Elimina un seguimiento para dejar de recibir ese aviso.
        </Text>

        {errorCarga ? (
          <View style={styles.tarjetaEstado} testID="seguimientos-error">
            <Text style={styles.estadoTitulo}>No se pudieron cargar tus seguimientos</Text>
            <Text style={styles.ayuda}>{errorCarga}</Text>
            <TouchableOpacity
              style={styles.botonReintentar}
              onPress={reintentar}
              testID="reintentar-seguimientos"
            >
              <Text style={styles.botonReintentarTexto}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : seguimientos === null ? (
          <View style={styles.tarjetaEstado} testID="seguimientos-cargando">
            <ActivityIndicator size="large" color="#0052CC" />
            <Text style={styles.ayuda}>Cargando tus seguimientos…</Text>
          </View>
        ) : seguimientos.length === 0 ? (
          <View style={styles.tarjetaEstado} testID="seguimientos-vacio">
            <Text style={styles.estadoTitulo}>Aún no sigues productos</Text>
            <Text style={styles.ayuda}>
              Cuando sigas un producto para enterarte de su disponibilidad, aparecerá aquí.
            </Text>
          </View>
        ) : (
          <View style={styles.lista} testID="lista-seguimientos">
            {errorEliminar ? (
              <View style={styles.bannerError} testID="error-eliminar">
                <Text style={styles.bannerErrorTexto}>{errorEliminar}</Text>
              </View>
            ) : null}

            {seguimientos.map((seguimiento) => (
              <View
                key={seguimiento.id}
                style={styles.item}
                testID={`seguimiento-item-${seguimiento.id}`}
              >
                <View style={styles.itemContenido}>
                  <Text style={styles.itemProducto} numberOfLines={2}>
                    {seguimiento.productoNombre}
                  </Text>
                  <Text style={styles.itemTipo}>{distintivoSeguimiento(seguimiento)}</Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.botonEliminar,
                    eliminandoId === seguimiento.id ? styles.botonDeshabilitado : null,
                  ]}
                  onPress={() => confirmarEliminar(seguimiento)}
                  disabled={eliminandoId !== null}
                  testID={`eliminar-seguimiento-${seguimiento.id}`}
                >
                  <Text style={styles.botonEliminarTexto}>
                    {eliminandoId === seguimiento.id ? 'Eliminando…' : 'Dejar de seguir'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// Etiqueta del alcance del seguimiento según el contrato del doc del equipo:
// cafeteriaId null = general (cualquier cafetería del campus), si no, puntual
// de una cafetería específica (cafeteriaNombre si vino en el listado).
function distintivoSeguimiento(seguimiento: Seguimiento): string {
  if (seguimiento.cafeteriaId === null) {
    return 'General · cualquier cafetería del campus';
  }
  return `Solo en ${seguimiento.cafeteriaNombre ?? `cafetería ${seguimiento.cafeteriaId}`}`;
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: '#fff' },
  contenido: { padding: 24, gap: 16 },
  titulo: { fontSize: 22, fontWeight: 'bold', color: '#0B2545' },
  descripcion: { fontSize: 14, color: '#5A6985', lineHeight: 19 },
  tarjetaEstado: {
    alignItems: 'center',
    backgroundColor: '#F4F7FC',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E9F4',
    gap: 8,
  },
  estadoTitulo: { fontSize: 15, fontWeight: '700', color: '#0B2545', textAlign: 'center' },
  ayuda: { fontSize: 13, color: '#5A6985', lineHeight: 18, textAlign: 'center' },
  botonReintentar: {
    marginTop: 4,
    backgroundColor: '#EEF4FF',
    borderWidth: 1,
    borderColor: '#D4E2F7',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  botonReintentarTexto: { color: '#1D4ED8', fontSize: 13, fontWeight: '700' },
  lista: { gap: 10 },
  bannerError: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  bannerErrorTexto: { color: '#B91C1C', fontSize: 13, fontWeight: '600', lineHeight: 18 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F4F7FC',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E9F4',
  },
  itemContenido: { flex: 1, gap: 3 },
  itemProducto: { fontSize: 14, fontWeight: '800', color: '#0B2545' },
  itemTipo: { fontSize: 12, color: '#5A6985', lineHeight: 16 },
  botonEliminar: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  botonDeshabilitado: { opacity: 0.6 },
  botonEliminarTexto: { color: '#B91C1C', fontSize: 12, fontWeight: '700' },
});

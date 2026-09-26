// src/app/(cliente)/campus.tsx
//
// Selección de campus (INT4-27). Es el paso obligatorio al entrar por primera
// vez: define la sede activa y, con ella, el catálogo y la cafetería contra la
// que se comparan precios y stock (RN-11/12).
//
// El listado sale de GET /v1/catalog/campus (services/catalog.ts). El backend
// todavía no implementa el controller: la pantalla consume el contrato real y
// muestra el error normalizado (toApiError) con botón de reintento, sin
// fallback a una lista hardcodeada.
//
// El tipo Campus viene de src/types/domain.ts y la persistencia de la
// selección vive en services/catalog.ts, que reutiliza la clave canónica
// CAMPUS_STORAGE_KEY de services/campus.ts. Esta pantalla no declara ni la
// clave ni el tipo: ambos tienen un solo lugar en el repo.
//
// Diseño: identidad visual del rol cliente (fondo #FAF7F2, azul #0052CC,
// acentos amarillos y bordes cálidos) replicada del mockup web.

import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AxiosError } from 'axios';

import {
  guardarCampusSeleccionado,
  leerCampusSeleccionado,
  listarCampus,
} from '../../services/catalog';
import { ApiProblem, toApiError } from '../../services/httpClient';
import type { Campus } from '../../types/domain';

export default function CampusScreen() {
  const router = useRouter();
  // null = aún no se resolvió el listado; la selección previa vive aparte para
  // no pisar lo que el cliente ya había elegido.
  const [campus, setCampus] = useState<Campus[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [seleccionId, setSeleccionId] = useState<string | null>(null);
  const [tieneSeleccionPrevia, setTieneSeleccionPrevia] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async (): Promise<void> => {
    try {
      const guardada = await leerCampusSeleccionado();
      const lista = await listarCampus();
      setCampus(lista);
      setErrorCarga(null);
      setTieneSeleccionPrevia(guardada !== null);
      // Preselección: la sede ya elegida si sigue en el catálogo; si no, la
      // primera disponible, para no obligar a tocar una card sin motivo.
      const sigueEnCatalogo = guardada !== null && lista.some((c) => c.id === guardada.id);
      setSeleccionId(sigueEnCatalogo ? (guardada as Campus).id : (lista[0]?.id ?? null));
    } catch (error) {
      const apiError = toApiError(error as AxiosError<ApiProblem>);
      setCampus(null);
      setErrorCarga(apiError.message);
    }
  }, []);

  // El campus se relee al ganar foco: el cliente puede haber cambiado de sede
  // en el catálogo y esta pantalla debe reflejar el catálogo vigente.
  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar])
  );

  const confirmar = async (): Promise<void> => {
    const elegido = campus?.find((c) => c.id === seleccionId);
    if (!elegido) {
      return;
    }

    try {
      setGuardando(true);
      setErrorGuardado(null);
      await guardarCampusSeleccionado(elegido);
      router.replace('/(cliente)');
    } catch {
      setErrorGuardado('No se pudo guardar tu selección. Intenta nuevamente.');
    } finally {
      setGuardando(false);
    }
  };

  const volverAlCatalogo = (): void => {
    router.back();
  };

  let contenido;

  if (errorCarga !== null) {
    contenido = (
      <View style={styles.tarjetaError} testID="campus-error">
        <Text style={styles.errorIcono}>📍</Text>
        <Text style={styles.errorTitulo}>No pudimos cargar los campus</Text>
        <Text style={styles.errorMensaje}>{errorCarga}</Text>
        <Pressable
          style={({ pressed }) => [styles.btnReintentar, pressed && styles.btnPresionado]}
          onPress={() => void cargar()}
          testID="campus-reintentar"
        >
          <Text style={styles.btnReintentarTexto}>Reintentar</Text>
        </Pressable>
      </View>
    );
  } else if (campus === null) {
    contenido = (
      <View style={styles.centrado}>
        <ActivityIndicator size="large" color="#0052CC" testID="campus-cargando" />
      </View>
    );
  } else if (campus.length === 0) {
    contenido = (
      <View style={styles.tarjetaVacio} testID="campus-vacio">
        <Text style={styles.vacioIcono}>🏛️</Text>
        <Text style={styles.vacioTitulo}>Todavía no hay campus</Text>
        <Text style={styles.vacioTexto}>
          Cuando el catálogo cargue las sedes de la universidad, aparecerán aquí para que elijas la
          tuya.
        </Text>
      </View>
    );
  } else {
    contenido = (
      <View style={styles.lista} testID="campus-lista">
        {campus.map((item) => {
          const seleccionado = item.id === seleccionId;

          return (
            <Pressable
              key={item.id}
              style={({ pressed }) => [
                styles.card,
                seleccionado && styles.cardSeleccionada,
                pressed && styles.cardPresionada,
              ]}
              onPress={() => setSeleccionId(item.id)}
              testID={`campus-card-${item.id}`}
            >
              {/* El mockup asigna un ícono por campus con ids fijos; el catálogo
                  real no trae ese dato, así que se usa uno neutro. */}
              <View style={styles.cardIcono}>
                <Text style={styles.cardIconoTexto}>🏛️</Text>
              </View>

              <View style={styles.cardInfo}>
                <Text style={styles.cardTitulo}>{item.nombre}</Text>
                {item.direccion.length > 0 && (
                  <Text style={styles.cardDireccion}>{item.direccion}</Text>
                )}
              </View>

              <View style={[styles.cardCheck, seleccionado && styles.cardCheckActivo]}>
                <Text style={[styles.cardCheckTexto, seleccionado && styles.cardCheckTextoActivo]}>
                  {seleccionado ? '✓' : '›'}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.pantalla} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        testID="campus-scroll"
      >
        {tieneSeleccionPrevia && (
          <Pressable
            style={({ pressed }) => [styles.btnVolver, pressed && styles.btnPresionado]}
            onPress={volverAlCatalogo}
            testID="campus-volver"
          >
            <Text style={styles.btnVolverTexto}>← Volver al catálogo</Text>
          </Pressable>
        )}

        <View style={styles.header}>
          <Text style={styles.badge}>SELECCIÓN DE SEDE</Text>
          <Text style={styles.titulo}>¿En qué campus estás?</Text>
          <Text style={styles.subtitulo}>
            Elige tu sede actual para ver el stock y cafeterías disponibles en tiempo real.
          </Text>
        </View>

        {contenido}
      </ScrollView>

      {/* El mockup selecciona al tocar la card; el paso es obligatorio en el
          flujo de la app, así que se confirma explícitamente antes de entrar al
          catálogo. */}
      {campus !== null && campus.length > 0 && (
        <View style={styles.footer}>
          {errorGuardado !== null && (
            <Text style={styles.errorGuardado} testID="campus-error-guardado">
              {errorGuardado}
            </Text>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.btnConfirmar,
              (!seleccionId || guardando) && styles.btnConfirmarInactivo,
              pressed && styles.btnPresionado,
            ]}
            disabled={!seleccionId || guardando}
            onPress={() => void confirmar()}
            testID="campus-confirmar"
          >
            {guardando ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.btnConfirmarTexto}>Confirmar y continuar</Text>
            )}
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pantalla: {
    flex: 1,
    backgroundColor: '#FAF7F2',
  },
  scroll: {
    padding: 16,
    paddingBottom: 24,
    gap: 18,
  },
  btnVolver: {
    alignSelf: 'flex-start',
  },
  btnVolverTexto: {
    color: '#0052CC',
    fontSize: 14,
    fontWeight: '700',
  },
  header: {
    gap: 6,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF8DF',
    borderWidth: 1,
    borderColor: '#F3DC87',
    color: '#B28300',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  titulo: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0052CC',
    lineHeight: 28,
  },
  subtitulo: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 19,
  },
  lista: {
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  cardSeleccionada: {
    borderColor: '#0052CC',
    backgroundColor: '#F2F7FE',
    shadowColor: '#0052CC',
    shadowOpacity: 0.12,
  },
  cardPresionada: {
    opacity: 0.85,
  },
  cardIcono: {
    width: 44,
    height: 44,
    backgroundColor: '#FFF8DF',
    borderWidth: 1,
    borderColor: '#F3DC87',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardIconoTexto: {
    fontSize: 21,
  },
  cardInfo: {
    flex: 1,
    gap: 2,
  },
  cardTitulo: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0052CC',
    lineHeight: 18,
  },
  cardDireccion: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  cardCheck: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardCheckActivo: {
    backgroundColor: '#0052CC',
    borderRadius: 12,
  },
  cardCheckTexto: {
    fontSize: 18,
    fontWeight: '800',
    color: '#6B7280',
  },
  cardCheckTextoActivo: {
    color: '#FFFFFF',
    fontSize: 13,
  },
  footer: {
    padding: 16,
    paddingTop: 8,
    gap: 8,
    backgroundColor: '#FAF7F2',
    borderTopWidth: 1,
    borderTopColor: '#EFE9DE',
  },
  errorGuardado: {
    fontSize: 12,
    color: '#B42318',
    textAlign: 'center',
  },
  btnConfirmar: {
    backgroundColor: '#0052CC',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0052CC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  btnConfirmarInactivo: {
    backgroundColor: '#9DB8E0',
  },
  btnConfirmarTexto: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  centrado: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  tarjetaError: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    padding: 22,
    alignItems: 'center',
    gap: 8,
  },
  errorIcono: {
    fontSize: 30,
  },
  errorTitulo: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1D2433',
  },
  errorMensaje: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  btnReintentar: {
    marginTop: 8,
    backgroundColor: '#0052CC',
    paddingVertical: 11,
    paddingHorizontal: 26,
    borderRadius: 12,
  },
  btnReintentarTexto: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  btnPresionado: {
    opacity: 0.85,
  },
  tarjetaVacio: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#EFE9DE',
    borderRadius: 18,
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  vacioIcono: {
    fontSize: 30,
  },
  vacioTitulo: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1D2433',
  },
  vacioTexto: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 19,
  },
});

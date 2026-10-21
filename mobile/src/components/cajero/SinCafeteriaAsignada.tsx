// src/components/cajero/SinCafeteriaAsignada.tsx
//
// Pantalla que cubre el caso del cajero cuya sesión no trae cafetería asignada
// (INT4-96). Reemplaza cualquier pantalla del cajero —Pedidos, Escanear QR,
// Stock, No Retirados y la confirmación de entrega— para que ninguna quede
// vacía o con un error de la API sin explicación.
//
// Sigue el lenguaje visual del resto del POS (mockup cloudcoffee-react →
// Cajero_Main: fondo #FAF7F2, tarjetas blancas, azul #0052CC), con el mismo
// patrón de tarjeta de error #FEE2E2/#991B1B que ya usan las pantallas del
// cajero para sus mensajes.
//
// Ofrece dos acciones posibles, las del criterio de listo:
//   - Cerrar sesión (POST /v1/auth/logout + limpieza local, vía AuthContext).
//   - Avisar al administrador (correo pre-redactado, ver
//     utils/avisarAdministrador).

import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../context/AuthContext';
import { ADMIN_EMAIL } from '../../config/soporte';
import { avisarAlAdministrador } from '../../utils/avisarAdministrador';

export default function SinCafeteriaAsignada() {
  const { cerrarSesion } = useAuth();
  const [cerrandoSesion, setCerrandoSesion] = useState(false);
  const [mensajeAviso, setMensajeAviso] = useState<string | null>(null);

  const manejarCerrarSesion = async (): Promise<void> => {
    setCerrandoSesion(true);
    try {
      await cerrarSesion();
    } finally {
      setCerrandoSesion(false);
    }
  };

  const manejarAvisar = async (): Promise<void> => {
    setMensajeAviso(null);
    try {
      const abierto = await avisarAlAdministrador();
      if (!abierto) {
        setMensajeAviso(`No se pudo abrir la app de correo. Escríbele a ${ADMIN_EMAIL}.`);
      }
    } catch {
      setMensajeAviso(`No se pudo abrir la app de correo. Escríbele a ${ADMIN_EMAIL}.`);
    }
  };

  return (
    <ScrollView
      style={styles.contenedor}
      contentContainerStyle={styles.contenido}
      testID="cajero-sin-cafeteria"
    >
      <View style={styles.card}>
        <Text style={styles.rolePill}>POS Cajero</Text>
        <Text style={styles.titulo}>Sin cafetería asignada</Text>
        <Text style={styles.descripcion}>
          Tu cuenta no tiene una cafetería asignada, así que no podemos cargar pedidos ni stock para
          operar el punto de venta.
        </Text>
        <Text style={styles.descripcion}>
          Pídele al administrador que asigne una cafetería a tu cuenta. Cuando lo haga, cierra
          sesión y vuelve a entrar: la asignación llega en tu sesión al iniciarla de nuevo.
        </Text>
      </View>

      <Pressable
        style={[styles.botonPrincipal, cerrandoSesion && styles.botonDeshabilitado]}
        onPress={() => void manejarCerrarSesion()}
        disabled={cerrandoSesion}
        testID="cajero-sin-cafeteria-cerrar-sesion"
      >
        {cerrandoSesion ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.botonPrincipalTexto}>Cerrar sesión</Text>
        )}
      </Pressable>

      <Pressable
        style={styles.botonSecundario}
        onPress={() => void manejarAvisar()}
        testID="cajero-sin-cafeteria-avisar-admin"
      >
        <Text style={styles.botonSecundarioTexto}>✉️ Avisar al administrador</Text>
      </Pressable>

      {mensajeAviso ? (
        <View style={styles.avisoError} testID="cajero-sin-cafeteria-aviso-error">
          <Text style={styles.avisoErrorTexto}>{mensajeAviso}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    flex: 1,
    backgroundColor: '#FAF7F2',
  },
  contenido: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    padding: 18,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  rolePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    color: '#92400E',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  titulo: {
    color: '#0052CC',
    fontSize: 20,
    fontWeight: '800',
  },
  descripcion: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 19,
  },
  botonPrincipal: {
    backgroundColor: '#0052CC',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonDeshabilitado: {
    opacity: 0.7,
  },
  botonPrincipalTexto: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  botonSecundario: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#0052CC',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonSecundarioTexto: {
    color: '#0052CC',
    fontSize: 15,
    fontWeight: '800',
  },
  avisoError: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  avisoErrorTexto: {
    color: '#991B1B',
    fontSize: 12,
    fontWeight: '600',
  },
});

// src/app/(auth)/activar-cuenta.tsx
//
// Pantalla de activación de cuenta (INT4-101). Reemplaza el placeholder
// anterior y toma el token del enlace que llega por
// correo, igual que las pantallas de verificación y de recuperación
// (INT4-105):
//
//   cloudcoffee://activar-cuenta?token=...
//
// Contrato: el backend NO expone hoy un endpoint de activación.
//   - auth-service publica login, refresh, logout, register, verificacion
//     (correo) y password (recovery/reset); no hay /auth/activation.
//   - tokens_auth solo guarda REFRESH, VERIFICACION_CORREO y
//     RECUPERACION_PASSWORD: no existe un token de activación.
//   - notification-service solo envía los correos de verificación y de
//     recuperación; no hay correo de activación de cuenta.
//
// Por eso la pantalla no simula una activación: lee el token del enlace y, en
// vez de mostrar un éxito falso, deja un estado explícito de "no disponible"
// con la salida al login. El día que exista el contrato, acá se llama al
// endpoint y se agregan los estados de éxito y error.
//
// Sigue el lenguaje visual de las pantallas de acceso (mockup
// cloudcoffee-react → Verificar_Correo): fondo crema, badge azul, tarjeta
// blanca y botón principal en tinta, con los tokens de src/theme/tokens.

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Presionable } from '../../components/Presionable';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tokens } from '../../theme/tokens';

type TokenParam = string | string[] | undefined;

/**
 * Normaliza el token que llega en el enlace: expo-router entrega
 * string | string[] según cómo venga la URL y el correo puede agregar
 * espacios. Se toma el primer valor y se recorta.
 */
export function leerTokenDeEnlace(tokenParam: TokenParam): string {
  const valor = Array.isArray(tokenParam) ? tokenParam[0] : tokenParam;
  return typeof valor === 'string' ? valor.trim() : '';
}

/**
 * Muestra solo una parte del token: alcanza para confirmar que el enlace
 * llegó completo sin exponerlo entero en pantalla.
 */
export function mascararToken(token: string): string {
  if (token.length <= 8) {
    return token;
  }
  return `${token.slice(0, 6)}…${token.slice(-2)}`;
}

export default function ActivarCuentaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token: tokenParam } = useLocalSearchParams<{ token?: TokenParam }>();

  const token = leerTokenDeEnlace(tokenParam);
  const tieneToken = token.length > 0;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.screen, { paddingTop: tokens.espaciado['5xl'] + insets.top }]}
      showsVerticalScrollIndicator={false}
      testID="activar-cuenta"
    >
      <Presionable
        onPress={() => router.replace('/(auth)/portada')}
        style={styles.backButton}
        hitSlop={tokens.espaciado.md}
        testID="activar-cuenta-volver"
      >
        <Text style={styles.backText}>← Volver</Text>
      </Presionable>

      <View style={styles.contenido}>
        <Text style={styles.icono}>🔐</Text>

        <View style={styles.badge}>
          <Text style={styles.badgeText}>ACTIVACIÓN DE CUENTA</Text>
        </View>

        <Text style={styles.titulo}>Activar Cuenta</Text>

        <Text style={styles.descripcion}>
          Completa la activación de tu cuenta de cajero con el enlace que te enviaron por correo.
        </Text>

        {tieneToken ? (
          <View style={styles.tarjetaToken} testID="activar-cuenta-token-recibido">
            <Text style={styles.tarjetaTokenTitulo}>Token recibido</Text>
            <Text style={styles.tarjetaTokenValor} testID="activar-cuenta-token">
              {mascararToken(token)}
            </Text>
            <Text style={styles.tarjetaTokenNota}>
              Lo tomamos del enlace de activación, listo para usarlo cuando el servicio esté
              disponible.
            </Text>
          </View>
        ) : (
          <View style={styles.tarjetaToken} testID="activar-cuenta-sin-token">
            <Text style={styles.tarjetaTokenTitulo}>Enlace incompleto</Text>
            <Text style={styles.tarjetaTokenNota}>
              El enlace no trae un token de activación. Abre de nuevo el enlace del correo para
              continuar.
            </Text>
          </View>
        )}

        <View style={styles.avisoNoDisponible} testID="activar-cuenta-no-disponible">
          <Text style={styles.avisoTitulo}>Servicio no disponible</Text>
          <Text style={styles.avisoTexto}>
            La activación de cuentas desde la app todavía no está habilitada: el servicio de
            activación aún no existe en el backend, así que no podemos completarla con este enlace.
          </Text>
        </View>

        <Presionable
          onPress={() => router.replace('/(auth)/login')}
          style={styles.botonPrincipal}
          testID="activar-cuenta-ir-login"
        >
          <Text style={styles.botonPrincipalTexto}>Ir a iniciar sesión</Text>
        </Presionable>

        <Text style={styles.ayuda}>
          Si ya tienes tu contraseña, puedes iniciar sesión ahora. Si todavía no puedes entrar,
          pídele al administrador que active tu cuenta.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: tokens.colores.fondoAuth,
  },
  screen: {
    flexGrow: 1,
    backgroundColor: tokens.colores.fondoAuth,
    paddingHorizontal: tokens.espaciado['4xl'],
    paddingVertical: tokens.espaciado['3xl'],
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  backText: {
    color: tokens.colores.textoSecundario,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.semibold,
  },
  contenido: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.espaciado.lg,
    paddingTop: tokens.espaciado['3xl'],
  },
  icono: {
    fontSize: tokens.tipografia.tamano.iconoGrande,
    lineHeight: tokens.tipografia.tamano.iconoGrande + tokens.espaciado.md,
  },
  badge: {
    backgroundColor: tokens.colores.infoFondo,
    borderRadius: tokens.radios.lg,
    paddingHorizontal: tokens.espaciado.xl,
    paddingVertical: tokens.espaciado.xs,
  },
  badgeText: {
    color: tokens.colores.azul,
    fontSize: tokens.tipografia.tamano.etiqueta,
    fontWeight: tokens.tipografia.peso.extranegrita,
    letterSpacing: tokens.tipografia.tracking.amplio,
  },
  titulo: {
    ...tokens.tipografia.texto.tituloPantalla,
    color: tokens.colores.marca,
    textAlign: 'center',
  },
  descripcion: {
    ...tokens.tipografia.texto.cuerpo,
    color: tokens.colores.textoNeutro,
    textAlign: 'center',
    maxWidth: 320,
  },
  tarjetaToken: {
    width: '100%',
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xl,
    paddingHorizontal: tokens.espaciado.xxxl,
    paddingVertical: tokens.espaciado.xxl,
    gap: tokens.espaciado.xs,
    ...tokens.sombras.sutil,
  },
  tarjetaTokenTitulo: {
    color: tokens.colores.tinta,
    fontSize: tokens.tipografia.tamano.etiqueta,
    fontWeight: tokens.tipografia.peso.extranegrita,
    letterSpacing: tokens.tipografia.tracking.amplio,
    textTransform: 'uppercase',
  },
  tarjetaTokenValor: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.destacado,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  tarjetaTokenNota: {
    ...tokens.tipografia.texto.cuerpoChico,
    color: tokens.colores.textoSecundario,
  },
  avisoNoDisponible: {
    width: '100%',
    backgroundColor: tokens.colores.amarilloFondo,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.amarilloBorde,
    borderRadius: tokens.radios.lg,
    paddingHorizontal: tokens.espaciado.xxxl,
    paddingVertical: tokens.espaciado.xl,
    gap: tokens.espaciado.xs,
  },
  avisoTitulo: {
    color: tokens.colores.amarilloTextoOscuro,
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },
  avisoTexto: {
    ...tokens.tipografia.texto.cuerpoChico,
    color: tokens.colores.amarilloTextoOscuro,
  },
  botonPrincipal: {
    width: '100%',
    backgroundColor: tokens.colores.tinta,
    borderRadius: tokens.radios.xl,
    paddingVertical: tokens.espaciado['15'],
    alignItems: 'center',
    marginTop: tokens.espaciado.xs,
    ...tokens.sombras.media,
  },
  botonPrincipalTexto: {
    ...tokens.tipografia.texto.boton,
    color: tokens.colores.crema,
  },
  ayuda: {
    ...tokens.tipografia.texto.cuerpoChico,
    color: tokens.colores.textoSecundario,
    textAlign: 'center',
    maxWidth: 320,
  },
});

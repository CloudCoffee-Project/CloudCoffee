// src/app/(cliente)/perfil.tsx
//
// Pantalla "Mi Perfil" (INT4-23). Sigue el diseño del mockup Mi_Perfil:
// badge CUENTA + título + tarjeta con avatar, datos en filas plegables y
// acciones inferiores. La tarea pide editar nombre, apellido y teléfono, así
// que la edición va más allá del mockup (que solo permitía el teléfono).
//
// Los datos salen de GET /v1/auth/me y la edición usa PUT /v1/auth/me
// (services/auth.ts). Ambos endpoints son contrato pendiente del auth-service,
// así que mientras el backend no los implemente la pantalla mostrará el error
// normalizado (API_BASE_URL ya enruta /v1/auth/**). Validaciones espejo del
// registro backend: nombre/apellido max 100 y teléfono ^[0-9+ ()-]{6,20}$.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { AxiosError } from 'axios';

import { actualizarPerfil, obtenerPerfil } from '../../services/auth';
import { ApiProblem, toApiError } from '../../services/httpClient';
import { useAuth } from '../../context/AuthContext';
import type { ActualizarPerfilRequest, PerfilUsuario } from '../../types/domain';

// Mismo formato que valida el backend en RegistroClienteRequest.
export const TELEFONO_REGEX = /^[0-9+ ()-]{6,20}$/;

export type ErroresPerfil = Partial<Record<'nombre' | 'apellido' | 'telefono', string>>;

// Reglas de validación centralizadas (espejo del contrato backend), exportadas
// para poder testearlas en la suite sin renderizar la pantalla.
export function validarPerfil(datos: ActualizarPerfilRequest): ErroresPerfil {
  const errores: ErroresPerfil = {};
  const nombre = datos.nombre.trim();
  const apellido = datos.apellido.trim();
  const telefono = datos.telefono.trim();

  if (!nombre) {
    errores.nombre = 'Ingresa tu nombre.';
  } else if (nombre.length > 100) {
    errores.nombre = 'El nombre no puede superar los 100 caracteres.';
  }

  if (!apellido) {
    errores.apellido = 'Ingresa tu apellido.';
  } else if (apellido.length > 100) {
    errores.apellido = 'El apellido no puede superar los 100 caracteres.';
  }

  if (!telefono) {
    errores.telefono = 'Ingresa tu teléfono.';
  } else if (!TELEFONO_REGEX.test(telefono)) {
    errores.telefono =
      'El teléfono debe tener entre 6 y 20 caracteres y solo puede incluir números, espacios, +, () o -.';
  }

  return errores;
}

export default function PerfilScreen() {
  const router = useRouter();
  const { cerrarSesion } = useAuth();

  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [editando, setEditando] = useState<boolean>(false);
  const [form, setForm] = useState<ActualizarPerfilRequest>({
    nombre: '',
    apellido: '',
    telefono: '',
  });
  const [erroresForm, setErroresForm] = useState<ErroresPerfil>({});
  const [guardando, setGuardando] = useState<boolean>(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  const cargarPerfil = useCallback(async (): Promise<void> => {
    try {
      const datos = await obtenerPerfil();
      setPerfil(datos);
    } catch (error) {
      const apiError = toApiError(error as AxiosError<ApiProblem>);
      setErrorCarga(apiError.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch inicial de datos, patrón válido
    void cargarPerfil();
  }, [cargarPerfil]);

  // Reintenta el GET inicial. Es un handler de toque (no un effect), así que
  // acá sí se puede volver a activar el spinner de forma síncrona.
  const reintentar = (): void => {
    setCargando(true);
    setErrorCarga(null);
    void cargarPerfil();
  };

  const abrirEdicion = (): void => {
    if (!perfil) {
      return;
    }
    setForm({ nombre: perfil.nombre, apellido: perfil.apellido, telefono: perfil.telefono });
    setErroresForm({});
    setErrorGuardar(null);
    setMensajeExito(null);
    setEditando(true);
  };

  const cancelarEdicion = (): void => {
    setEditando(false);
    setErroresForm({});
    setErrorGuardar(null);
  };

  const guardarPerfil = async (): Promise<void> => {
    const errores = validarPerfil(form);
    setErroresForm(errores);
    if (Object.keys(errores).length > 0) {
      return;
    }

    setGuardando(true);
    setErrorGuardar(null);
    setMensajeExito(null);
    try {
      const actualizado = await actualizarPerfil(form);
      setPerfil(actualizado);
      setEditando(false);
      setMensajeExito('Perfil actualizado correctamente.');
    } catch (error) {
      const apiError = toApiError(error as AxiosError<ApiProblem>);
      setErrorGuardar(apiError.message);
    } finally {
      setGuardando(false);
    }
  };

  const handleCerrarSesion = async (): Promise<void> => {
    await cerrarSesion();
  };

  const actualizarCampo = (campo: keyof ActualizarPerfilRequest, valor: string): void => {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    setErroresForm((prev) => ({ ...prev, [campo]: undefined }));
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {cargando ? (
          <ActivityIndicator size="large" color="#0052CC" testID="cargando-perfil" />
        ) : (
          <>
            <View style={styles.header}>
              <Text style={styles.badge}>CUENTA</Text>
              <Text style={styles.title}>Mi Perfil</Text>
              <Text style={styles.subtitle}>Revisa y actualiza tus datos personales.</Text>
            </View>

            {mensajeExito ? (
              <View style={styles.bannerExito} testID="banner-exito">
                <Text style={styles.bannerExitoTexto}>{mensajeExito}</Text>
              </View>
            ) : null}

            {errorCarga ? (
              <View style={styles.card} testID="perfil-error">
                <Text style={styles.errorTitulo}>No pudimos cargar tu perfil</Text>
                <Text style={styles.errorMensaje}>{errorCarga}</Text>
                <TouchableOpacity
                  style={styles.btnReintentar}
                  onPress={reintentar}
                  testID="reintentar-perfil"
                >
                  <Text style={styles.btnReintentarTexto}>Reintentar</Text>
                </TouchableOpacity>
              </View>
            ) : perfil === null ? null : editando ? (
              <View style={styles.card} testID="perfil-edicion">
                <Text style={styles.subformTitle}>Editar perfil</Text>
                <Text style={styles.subformHint}>
                  Actualiza tus datos personales. El correo no se puede modificar desde acá.
                </Text>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>NOMBRES</Text>
                  <TextInput
                    style={[styles.input, erroresForm.nombre ? styles.inputError : null]}
                    value={form.nombre}
                    onChangeText={(texto) => actualizarCampo('nombre', texto)}
                    placeholder="Ingresa tu nombre"
                    placeholderTextColor="#9CA3AF"
                    maxLength={100}
                    testID="campo-nombre"
                  />
                  {erroresForm.nombre ? (
                    <Text style={styles.errorCampo}>{erroresForm.nombre}</Text>
                  ) : null}
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>APELLIDOS</Text>
                  <TextInput
                    style={[styles.input, erroresForm.apellido ? styles.inputError : null]}
                    value={form.apellido}
                    onChangeText={(texto) => actualizarCampo('apellido', texto)}
                    placeholder="Ingresa tus apellidos"
                    placeholderTextColor="#9CA3AF"
                    maxLength={100}
                    testID="campo-apellido"
                  />
                  {erroresForm.apellido ? (
                    <Text style={styles.errorCampo}>{erroresForm.apellido}</Text>
                  ) : null}
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>TELÉFONO</Text>
                  <TextInput
                    style={[styles.input, erroresForm.telefono ? styles.inputError : null]}
                    value={form.telefono}
                    onChangeText={(texto) => actualizarCampo('telefono', texto)}
                    placeholder="+56 9 1234 5678"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="phone-pad"
                    maxLength={20}
                    testID="campo-telefono"
                  />
                  {erroresForm.telefono ? (
                    <Text style={styles.errorCampo}>{erroresForm.telefono}</Text>
                  ) : null}
                  <Text style={styles.fieldHint}>
                    Solo números y los caracteres +, (), espacio o guión.
                  </Text>
                </View>

                {errorGuardar ? <Text style={styles.errorMensaje}>{errorGuardar}</Text> : null}

                <View style={styles.editButtons}>
                  <TouchableOpacity
                    style={styles.btnCancelar}
                    onPress={cancelarEdicion}
                    disabled={guardando}
                    testID="cancelar-edicion"
                  >
                    <Text style={styles.btnCancelarTexto}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btnGuardar, guardando ? styles.btnGuardarDeshabilitado : null]}
                    onPress={() => void guardarPerfil()}
                    disabled={guardando}
                    testID="guardar-edicion"
                  >
                    {guardando ? (
                      <ActivityIndicator color="#FFFFFF" testID="guardando-perfil" />
                    ) : (
                      <Text style={styles.btnGuardarTexto}>Guardar cambios</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.card} testID="perfil-vista">
                <View style={styles.avatarRow}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarIcono}>👤</Text>
                  </View>
                  <View style={styles.avatarMeta}>
                    <Text style={styles.avatarNombre}>
                      {perfil.nombre} {perfil.apellido}
                    </Text>
                    <Text style={styles.avatarEmail}>{perfil.email}</Text>
                  </View>
                  {perfil.verificado ? (
                    <View style={styles.tagVerificado}>
                      <Text style={styles.tagVerificadoTexto}>Verificado</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.viewData}>
                  <InfoRow etiqueta="NOMBRES" valor={perfil.nombre} />
                  <InfoRow etiqueta="APELLIDOS" valor={perfil.apellido} />
                  <InfoRow etiqueta="CORREO" valor={perfil.email} />
                  <InfoRow etiqueta="TELÉFONO DE CONTACTO" valor={perfil.telefono} />
                </View>

                <View style={styles.actionsStack}>
                  <TouchableOpacity
                    style={styles.btnEditar}
                    onPress={abrirEdicion}
                    testID="editar-perfil"
                  >
                    <Text style={styles.btnEditarTexto}>✏️ Editar perfil</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.btnContrasena}
                    onPress={() => router.push('/(cliente)/cambiar-contrasena')}
                    testID="cambiar-contrasena"
                  >
                    <Text style={styles.btnContrasenaTexto}>🔒 Cambiar Contraseña</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.btnNotificaciones}
                    onPress={() => router.push('/(cliente)/notificaciones')}
                    testID="ver-notificaciones"
                  >
                    <Text style={styles.btnNotificacionesTexto}>🔔 Notificaciones</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.footer}>
              <TouchableOpacity
                style={styles.btnLogout}
                onPress={() => void handleCerrarSesion()}
                testID="cerrar-sesion"
              >
                <Text style={styles.btnLogoutTexto}>Cerrar Sesión</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function InfoRow({ etiqueta, valor }: { etiqueta: string; valor: string }): React.JSX.Element {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{etiqueta}</Text>
      <Text style={styles.infoValor}>{valor}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF7F2',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 32,
  },
  header: {
    marginTop: 8,
    marginBottom: 16,
    gap: 4,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF8DF',
    borderWidth: 1,
    borderColor: '#F3DC87',
    color: '#B28300',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 14,
    overflow: 'hidden',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0052CC',
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 17,
  },
  bannerExito: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  bannerExitoTexto: {
    color: '#15803D',
    fontSize: 13,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 20,
    padding: 18,
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EFE9DE',
    borderStyle: 'dashed',
    paddingBottom: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    backgroundColor: '#FFF8DF',
    borderWidth: 1.5,
    borderColor: '#F3DC87',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarIcono: {
    fontSize: 22,
  },
  avatarMeta: {
    flex: 1,
  },
  avatarNombre: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1D2433',
  },
  avatarEmail: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  tagVerificado: {
    backgroundColor: '#DCFCE7',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagVerificadoTexto: {
    color: '#15803D',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  viewData: {
    gap: 10,
  },
  infoRow: {
    backgroundColor: '#FAF7F2',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
  },
  infoValor: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1D2433',
  },
  actionsStack: {
    gap: 8,
  },
  btnEditar: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnEditarTexto: {
    color: '#0052CC',
    fontSize: 13,
    fontWeight: '700',
  },
  btnContrasena: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnContrasenaTexto: {
    color: '#1E293B',
    fontSize: 13,
    fontWeight: '700',
  },
  btnNotificaciones: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnNotificacionesTexto: {
    color: '#0052CC',
    fontSize: 13,
    fontWeight: '700',
  },
  subformTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0052CC',
    marginBottom: 2,
  },
  subformHint: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  formGroup: {
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    backgroundColor: '#FAF7F2',
  },
  inputError: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FFF7F7',
  },
  errorCampo: {
    color: '#DC2626',
    fontSize: 11,
    fontWeight: '600',
  },
  fieldHint: {
    color: '#6B7280',
    fontSize: 11,
    lineHeight: 14,
  },
  errorTitulo: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1D2433',
  },
  errorMensaje: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  btnReintentar: {
    backgroundColor: '#0052CC',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  btnReintentarTexto: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  editButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  btnCancelar: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnCancelarTexto: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '700',
  },
  btnGuardar: {
    flex: 1.5,
    backgroundColor: '#0052CC',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnGuardarDeshabilitado: {
    opacity: 0.6,
  },
  btnGuardarTexto: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#EFE9DE',
    paddingTop: 14,
    marginTop: 20,
  },
  btnLogout: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnLogoutTexto: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '800',
  },
});

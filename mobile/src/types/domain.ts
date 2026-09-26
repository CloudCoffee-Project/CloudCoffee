// src/types/domain.ts
//
// Tipos base derivados del MER y de la spec de endpoints. Se centralizan
// aquí para que ninguna pantalla/servicio invente su propio string de
// estado (evita el tipo de error que tuvimos en el mockup: mezclar
// 'no_retirado_pendiente' con 'noRetiradoPendiente' en distintos lugares).

export type Rol = 'cliente' | 'cajero' | 'admin_cafeteria' | 'super_admin';

export type EstadoOrden =
  | 'reservando'
  | 'pagado'
  | 'listo_para_retiro'
  | 'no_retirado_pendiente_revision'
  | 'entregado'
  | 'no_retirado_final'
  | 'cancelado';

// Lista canónica de estados de orden: permite validar en runtime valores que
// llegan desde el WebSocket (/topic/orden/{id}/estado) o desde los params de
// navegación, para que ninguna pantalla invente un string de estado por su
// cuenta (ver cabecera de este archivo).
export const ESTADOS_ORDEN: readonly EstadoOrden[] = [
  'reservando',
  'pagado',
  'listo_para_retiro',
  'no_retirado_pendiente_revision',
  'entregado',
  'no_retirado_final',
  'cancelado',
];

export function esEstadoOrden(valor: unknown): valor is EstadoOrden {
  return typeof valor === 'string' && (ESTADOS_ORDEN as readonly string[]).includes(valor);
}

// Agrupaciones semánticas del union EstadoOrden para el listado del cajero
// (INT4-7, filtros básicos de pedidos activos / no retirados). Se centralizan
// aquí para que ninguna pantalla invente su propia lógica de categoría: los
// filtros se derivan del union, nunca de strings planos.
export const ESTADOS_ORDEN_ACTIVOS: readonly EstadoOrden[] = [
  'reservando',
  'pagado',
  'listo_para_retiro',
];

export const ESTADOS_ORDEN_NO_RETIRADOS: readonly EstadoOrden[] = [
  'no_retirado_pendiente_revision',
  'no_retirado_final',
];

export function esEstadoOrdenActivo(estado: EstadoOrden): boolean {
  return ESTADOS_ORDEN_ACTIVOS.includes(estado);
}

export function esEstadoOrdenNoRetirado(estado: EstadoOrden): boolean {
  return ESTADOS_ORDEN_NO_RETIRADOS.includes(estado);
}

export type EstadoCompra =
  'reservando' | 'revision_requerida' | 'pendiente_pago' | 'pagado' | 'cancelado';

export type AccionNoRetirado = 'reingresar' | 'descartar';

export interface SesionDecodificada {
  userId: string;
  rol: Rol;
  cafeteriaId: string | null;
  exp: number;
}

// DTOs de autenticación (contrato con el API Gateway /v1/auth/**).
export interface CredencialesLogin {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

export interface RegistroClienteRequest {
  email: string;
  password: string;
  nombre: string;
  apellido: string;
  telefono: string;
}

export interface RegistroClienteResponse {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  telefono: string;
  rol: string;
  verificado: boolean;
}

// Perfil del usuario autenticado. Reutiliza la forma del RegistroClienteResponse
// del backend (el auth-service no expone hoy un endpoint de perfil; cuando lo
// haga devolverá la misma entidad Usuario). Definir estos tipos acá evita que la
// pantalla invente sus propios campos (ver cabecera de este archivo).
export interface PerfilUsuario {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  telefono: string;
  rol: string;
  verificado: boolean;
}

// Body de edición de perfil: solo los campos editables (INT4-23). El backend
// validará igual que en el registro: nombre/apellido max 100 y teléfono con el
// formato ^[0-9+ ()-]{6,20}$.
export interface ActualizarPerfilRequest {
  nombre: string;
  apellido: string;
  telefono: string;
}

export interface VerificarCorreoResponse {
  email: string;
  verificado: boolean;
}

export interface SolicitarRecuperacionRequest {
  email: string;
}

export interface RestablecerPasswordRequest {
  token: string;
  nuevaPassword: string;
}

// Body de cambio de contraseña estando autenticado (INT4-24). El backend
// validará la contraseña actual y aplicará las mismas reglas que en el
// registro (mínimo 8 caracteres).
export interface CambiarContrasenaRequest {
  passwordActual: string;
  nuevaPassword: string;
}

export interface Campus {
  id: string;
  nombre: string;
  direccion: string;
  // Cafeteria principal del campus. El catalogo la entrega junto al campus
  // (contrato INT4-27) para que el cliente resuelva precios y stock sin
  // depender de un mapeo local. Opcionales a proposito: mientras el backend
  // no los mande, el catalogo sigue funcionando con el mapeo provisional de
  // services/campus.ts.
  cafeteriaId?: string;
  cafeteriaNombre?: string;
}

export interface Categoria {
  id: string;
  nombre: string;
}

export interface Oferta {
  ofertaId: string;
  cafeteriaId: string;
  cafeteriaNombre: string;
  precio: number;
  stock: number;
  disponible: boolean;
}

export interface Producto {
  id: string;
  nombre: string;
  descripcion: string;
  categoriaId: string;
  offers?: Oferta[];
}

export interface OrdenItem {
  ordenItemId: string;
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
}

export interface Orden {
  ordenId: string;
  codigoOrden: string;
  cafeteriaId: string;
  cafeteriaNombre: string;
  clienteNombre?: string;
  estado: EstadoOrden;
  montoTotal: number;
  items: OrdenItem[];
}

// Eventos STOMP de tiempo real (contrato a fijar con el backend cuando
// exista el endpoint). Se tipan acá para que los hooks/servicios no definan
// DTOs propios: los estados usan el union EstadoOrden, nunca string plano.
export interface OrdenEstadoEvento {
  ordenId: string;
  estado: EstadoOrden;
}

export interface StockCafeteriaEvento {
  ofertaId: string;
  productoId: string;
  cafeteriaId: string;
  campusId: string;
  stockActual: number;
}

// Payload que codifica el QR de retiro: lo escanea el cajero en el punto de
// retiro para validar el pedido. El estado siempre es un valor del union
// EstadoOrden (nunca un string inventado en la pantalla).
export interface QrRetiro {
  pedido: string;
  estado: EstadoOrden;
}

export interface Compra {
  compraId: string;
  montoTotal: number;
  estado: EstadoCompra;
  initPoint?: string;
  ordenes: Orden[];
}

export interface Seguimiento {
  id: string;
  productoId: string;
  productoNombre: string;
  cafeteriaId: string | null;
  cafeteriaNombre?: string;
}

export interface ItemCarrito {
  ofertaId: string;
  productoId: string;
  name: string;
  price: number;
  cafeteriaId: string;
  cafeName: string;
  quantity: number;
}

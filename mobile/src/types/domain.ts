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
  | 'no_retirado_pendiente_revision'
  | 'entregado'
  | 'no_retirado_final'
  | 'cancelado';

// Agrupaciones semánticas del union EstadoOrden para el listado del cajero
// (INT4-7, filtros básicos de pedidos activos / no retirados). Se centralizan
// aquí para que ninguna pantalla invente su propia lógica de categoría: los
// filtros se derivan del union, nunca de strings planos.
export const ESTADOS_ORDEN_ACTIVOS: readonly EstadoOrden[] = ['reservando', 'pagado'];

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

export interface Campus {
  id: string;
  nombre: string;
  direccion: string;
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

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

// Estados en los que el cliente todavía puede actuar sobre su compra (INT4-37):
// una compra confirmada ('pagado') o ya cancelada no se toca, y una compra en
// revisión solo se puede cancelar (confirmarla mientras se revisa no tiene
// sentido). Igual que el resto de estados, se derivan del union EstadoCompra
// acá y no como strings sueltos en la pantalla.
export const ESTADOS_COMPRA_CONFIRMABLES: readonly EstadoCompra[] = ['reservando'];
export const ESTADOS_COMPRA_CANCELABLES: readonly EstadoCompra[] = [
  'reservando',
  'revision_requerida',
  'pendiente_pago',
];

export function puedeConfirmarCompra(estado: EstadoCompra): boolean {
  return ESTADOS_COMPRA_CONFIRMABLES.includes(estado);
}

export function puedeCancelarCompra(estado: EstadoCompra): boolean {
  return ESTADOS_COMPRA_CANCELABLES.includes(estado);
}

// Estados en los que el cliente todavía puede actuar sobre UNA orden puntual de
// su compra (INT4-37). La orden solo es cancelable mientras está reservando: en
// cuanto el pago entró ('pagado' en adelante) la cafetería ya la está
// preparando y cancelar ya no corresponde al cliente.
export const ESTADOS_ORDEN_CONFIRMABLES: readonly EstadoOrden[] = ['reservando'];
export const ESTADOS_ORDEN_CANCELABLES: readonly EstadoOrden[] = ['reservando'];

export function puedeConfirmarOrden(estado: EstadoOrden): boolean {
  return ESTADOS_ORDEN_CONFIRMABLES.includes(estado);
}

export function puedeCancelarOrden(estado: EstadoOrden): boolean {
  return ESTADOS_ORDEN_CANCELABLES.includes(estado);
}

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

// Cafeteria de retiro dentro de un campus. El modelo del backend es 1:N
// (Campus.caferias es un @OneToMany), asi que un campus puede tener varias y
// cada una tiene su propio precio y stock para un mismo producto.
export interface Cafeteria {
  id: string;
  nombre: string;
}

export interface Campus {
  id: string;
  nombre: string;
  direccion: string;
  // Cafeterias del campus. Opcional a proposito: la app no la necesita para
  // leer precios (eso sale de Producto.offers, que el endpoint de productos
  // devuelve filtrado por campus), solo para no ofrecer el retiro en una sede
  // ajena. Mientras el backend no la mande, la app muestra las ofertas que
  // recibe y no inventa ninguna.
  cafeterias?: Cafeteria[];
}

export interface Categoria {
  id: string;
  nombre: string;
}

// Oferta de un producto en una cafeteria concreta. Un mismo producto puede
// tener varias ofertas, una por cafeteria del campus, con precio y stock
// propios: por eso la app lista todas las que le entrega el endpoint de
// productos y no elige una sola.
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
  // Ofertas del producto en las cafeterias del campus consultado. El backend
  // las agrupa desde Offer (que tiene la FK product_id) y acota el resultado al
  // campus del parametro: lo que llega aca pertenece a la sede activa.
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

// Una linea del carrito en memoria (INT4-32): un producto comprado en una
// cafeteria concreta, o sea una Oferta del catalogo. La identidad de la linea es
// la oferta: volver a agregar el mismo producto en la misma cafeteria suma
// cantidad a la misma linea en vez de abrir otra. Es el criterio del mockup y el
// que espera POST /v1/compras, que manda un item por ofertaId.
//
// Los nombres de campo siguen a OrdenItem (productoNombre, precioUnitario), no
// a la version en ingles que habia antes en este archivo.
//
// Ojo con el nombre: services/pagos.ts declara su propio ItemCarrito, que es el
// payload de POST /v1/compras (solo ofertaId y cantidad) y no esta linea.
export interface ItemCarrito {
  ofertaId: string;
  productoId: string;
  productoNombre: string;
  precioUnitario: number;
  cafeteriaId: string;
  cafeteriaNombre: string;
  cantidad: number;
  // Stock de la oferta tal como estaba al agregar. Es una foto, no el stock en
  // vivo: el carrito vive en memoria y no vuelve a preguntar al catalogo, asi
  // que la disponibilidad real la revalida el backend al crear la orden.
  stock: number;
}

// Lo que hay que entregar para agregar al carrito: la linea sin cantidad, que la
// elige quien agrega (el stepper del detalle de producto).
export type NuevoItemCarrito = Omit<ItemCarrito, 'cantidad'>;

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

export type EstadoCompra =
  'reservando' | 'revision_requerida' | 'pendiente_pago' | 'pagado' | 'cancelado';

export type AccionNoRetirado = 'reingresar' | 'descartar';

export interface SesionDecodificada {
  userId: string;
  rol: Rol;
  cafeteriaId: string | null;
  exp: number;
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

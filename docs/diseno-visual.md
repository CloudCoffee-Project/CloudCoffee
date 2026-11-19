# Estilo visual web — INT2-141

Referencias del solicitante: CloudCoffe-5.png a CloudCoffe-13.png.
La implementación conserva permisos, campos y acciones de compra. El pago sigue
simulado. La ampliación solicitada el 18-11-2026 incorpora selección de campus,
fotografías en carrito, tarjetas clicables y un carrusel con popularidad real.
No se muestran QR ni estados de retiro ficticios.

Paleta: crema #fffcf8, café #3e322b y caramelo #cd8e57. Tipografía Outfit con
pesos de títulos 800/900. Tarjetas de 24–34px, bordes claros y foco visible.
La navegación, formularios y tarjetas se adaptan a móvil sin ocultar acciones.

La mascota decorativa se preparó con la herramienta integrada image_gen, usando
CloudCoffe-7.png como referencia, y se guarda en web/public/brand/mascota-cafe.png.
Prompt: extraer/reconstruir solo el periquito azul de cabeza amarilla sobre la
rama, con su taza de espresso, conservando pose, colores y detalle; PNG con alpha
transparente, sin interfaz, textos, paneles ni círculo. Se utiliza aria-hidden y
alt vacío para no añadir información ni navegación a la interfaz.

La carga y almacenamiento de imágenes de productos es una entrega distinta,
INT2-145. La presentación usa las URL públicas que devuelve el catálogo, sin modificar la carga.


## Ampliación de vistas y navegación (18-11-2026)

- `/catalogo` pide elegir campus en `/campus` cuando todavía no hay selección.
  La elección se confirma con un botón, se guarda en localStorage y se conserva
  en la URL del catálogo. La navegación permite cambiar de sede.
- Toda la tarjeta de producto, incluida la foto y su espacio, es un enlace nativo
  accesible por teclado al detalle; agregar al carrito conserva las ofertas/stock.
- El carrito guarda `productImageUrl`. Carritos antiguos y órdenes históricas
  recuperan la foto actual por `productoId`; fotos ausentes o rotas muestran un
  marcador y no bloquean compras. Los importes/nombres históricos siguen en Order.
- El historial enlaza a una vista con selector de órdenes por cafetería, productos,
  folio, estado, total y comprobante de la orden seleccionada. Se conservan HTTP,
  suscripciones, permisos, pago con Mercado Pago Sandbox e idempotencia de confirmación/cancelación.
- Inicio muestra hasta ocho productos de `/v1/orders/productos-populares`, ordenados
  por unidades de órdenes pagadas (incluye retiro/entregas). Excluye revisión,
  pendientes y cancelaciones. Empates por ID; no usa el carrito como estadística.
  La lectura pública solo expone `productoId` y `cantidad`, con caché de 60 segundos.
  La web resuelve fotos/nombres vigentes en Catalog y, si hay campus seleccionado,
  filtra los productos sin oferta disponible en esa sede. Flechas, desplazamiento
  táctil, enlaces por teclado y respeto a movimiento reducido; sin avance automático.
  Incluye carga, vacío, error y reintento.

Validación: Vitest completo (198 pruebas), build web, pruebas de consultas de compras
(25), ranking real (2) y routing/seguridad del Gateway (141). La integración con
INT2-145 pasa 203 pruebas web en conjunto y build; revisión en navegador a 1280/390 px,
sin desbordamiento horizontal.

# datos-locales

Datos del catálogo para trabajar sin backend.

## Qué es

Un snapshot del dominio del catálogo —campus, cafeterías, categorías, productos y
ofertas— que la app puede leer sin pegarle a ningún servidor. Vive acá, en una
carpeta propia, y **no se importa desde la app directamente**: lo consume
`services/catalogoLocal.ts`, que es el punto de swap.

## Por qué existe

El `catalog-service` tiene las entidades, los repositorios y las cinco tablas
creadas por la migración de Flyway, pero **no tiene controllers**. No existe
`GET /v1/catalog/campus` ni `GET /v1/catalog/productos`, así que el catálogo no
tiene de dónde leer contra el gateway.

Mientras tanto, INT4-31 a INT4-34 (comparación de precios, estado global del
carrito, agrupamiento por cafetería y agregar/quitar desde el detalle) sí se
pueden desarrollar, probar y revisar. Eso es lo que sirve este snapshot.

## De dónde salen los datos

Vienen del `PRODUCTOS_MOCK` que `mobile/src/app/(cliente)/index.tsx` usó hasta el
commit `5dc3f5a` ("catálogo del cliente con datos reales"), que lo reemplazó por
llamadas HTTP.

Se mantiene el mismo dataset —los cuatro productos, sus categorías y los campus
donde se vendían— con dos cambios que el modelo actual exige:

**1. Varias ofertas por producto, en vez de un precio único.**

El `Producto` viejo era plano: un `localNombre` y un `precio`. El actual es N:M,
porque un producto se retira en varias cafeterías y cada una cobra lo suyo:

```typescript
Oferta { ofertaId, cafeteriaId, cafeteriaNombre, precio, stock, disponible }
Producto { ..., offers?: Oferta[] }
```

Con un solo precio por producto, la escalera de precios de INT4-31 no tenía nada
que comparar y el agrupamiento del carrito por cafetería tampoco. Por eso cada
producto tiene dos a tres ofertas con precio y stock propios.

**2. Sin `icono`.**

El `Producto` viejo tenía `icono: '☕'`. El tipo actual de
[`types/domain.ts`](../types/domain.ts) no lo tiene, y agregarlo sería inventar un
campo que el backend nunca manda. Queda afuera; si el mockup lo necesita, se
agrega al tipo cuando exista el endpoint.

## Cómo se borra

En el sprint de conexión directa a la base:

1. Borrar esta carpeta.
2. En `app/(cliente)/index.tsx`, cambiar el import de `services/catalogoLocal`
   por `services/catalog`.
3. Borrar `services/catalogoLocal.ts` y su test.

No hay nada más que tocar. `index.tsx` no sabe de dónde salen los datos: solo
pide `listarProductos(campusId, categoriaId?)` y recibe `Producto[]`. Esa
independencia es el punto de todo este directorio.

## Lo que NO está acá

**No hay login, ni sesión, ni usuarios de prueba.** El login sigue siendo real
contra `POST /v1/auth/login`, que hoy da 404. Es decir: con estos datos se
desarrolla y se testea el carrito, pero **no se puede ver la app en un
dispositivo** hasta que el backend implemente ese endpoint.

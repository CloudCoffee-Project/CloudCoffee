# datos-locales

Snapshot del dominio del catálogo —campus, cafeterías, categorías, productos y
ofertas— para trabajar sin backend.

> **Estado actual: sin uso.** El `catalog-service` ya expone `PublicCatalogController`
> (INT4-25), y `app/(cliente)/index.tsx` pasó a leer de `services/catalog.ts`. Nada
> en la app importa esta carpeta: el único que lo hacía, `services/catalogoLocal.ts`,
> quedó huérfano junto con su test. El catálogo de la app ahora sale del gateway, con
> su error normalizado y sin datos inventados en pantalla.
>
> Se conserva, sin borrar, como red de seguridad hasta que el backend esté
> desplegado en el ambiente de pruebas. Para cerrarlo: borrar esta carpeta,
> `services/catalogoLocal.ts` y `services/catalogoLocal.test.ts`.

## Qué era

Un snapshot del dominio del catálogo que la app podía leer sin pegarle a ningún
servidor. Lo consumía `services/catalogoLocal.ts`, que era el punto de swap.

## Por qué existía

El `catalog-service` tenía las entidades, los repositorios y las cinco tablas
creadas por la migración de Flyway, pero **no tenía controllers**. No existía
`GET /v1/catalog/campus` ni `GET /v1/catalog/productos`, así que el catálogo no
tenía de dónde leer contra el gateway.

Mientras tanto, INT4-31 a INT4-34 (comparación de precios, estado global del
carrito, agrupamiento por cafetería y agregar/quitar desde el detalle) sí se
pudieron desarrollar, probar y revisar. Eso es lo que sirvió este snapshot.

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

El paso 2 ya está hecho: `app/(cliente)/index.tsx` importa `services/catalog`.

Quedan dos pasos, que son borrados de código muerto:

1. Borrar `services/catalogoLocal.ts` y `services/catalogoLocal.test.ts`.
2. Borrar esta carpeta.

No hay nada más que tocar. `index.tsx` no sabe de dónde salen los datos: solo
pide `listarProductos(campusId, categoriaId?)` y recibe `Producto[]`. Esa
independencia es el punto de todo este directorio, y por eso el swap no tocó
ninguna pantalla.

## Lo que NO está acá

**No hay login, ni sesión, ni usuarios de prueba.** El login siempre fue real
contra `POST /v1/auth/login`. Es decir: con estos datos se desarrollaba y se
testeaba el carrito, pero **no se podía ver la app en un dispositivo** hasta que
el backend implementara ese endpoint.

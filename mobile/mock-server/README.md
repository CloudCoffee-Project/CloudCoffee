# Mock del API para demos

Un servidor Node con datos de ejemplo del catálogo, para poder mostrar y probar
la app mientras el backend no implementa los controllers de `catalog-service` y
de `POST /v1/auth/login`.

**Es temporal.** Cuando exista la base de datos se borra esta carpeta entera y
nada de la app hay que tocar: la app nunca leyó estos archivos, habló con ellos
por HTTP como habla con el gateway.

## Por qué un servidor y no datos en la app

La alternativa —dejar el catálogo hardcodeado en la pantalla o en un `productos.ts`
dentro de `src/`— hace que la app sirva datos falsos cuando el backend falla, y
ese archivo "temporal" es el que más sobrevive a lo que debería. Con un mock
servidor la app sigue consumiendo el contrato real por `httpClient`: si el
servidor no está o no tiene la ruta, se ve el error normalizado con su botón de
reintento, que es lo que se verá en producción. El mock reemplaza al backend
entero, no una parte del código de la app.

## Cómo se usa

En una terminal, desde `mobile/`:

```bash
npm run mock:api
```

En otra, con la app apuntando al mock:

```bash
# Android emulador: el emulador no ve "localhost" de la máquina
EXPO_PUBLIC_API_URL=http://10.0.2.2:18099 npx expo start

# iOS simulator o web
EXPO_PUBLIC_API_URL=http://localhost:18099 npx expo start
```

En web también sirve `npx expo start --web`. Después: entrar con cualquier correo
y contraseña (el login es falso y no valida nada), elegir sede y ver el catálogo.

Para no tipear la variable cada vez, se puede dejar en `.env.local`, que ya está
en `.gitignore`:

```
EXPO_PUBLIC_API_URL=http://localhost:18099
```

## Qué responde

| Ruta                                        | Qué devuelve                                           |
| ------------------------------------------- | ------------------------------------------------------ |
| `POST /v1/auth/login`                       | Tokens falsos, cualquier correo y contraseña           |
| `POST /v1/auth/refresh`                     | Tokens falsos                                          |
| `GET  /v1/auth/me`                          | Perfil de un cliente de ejemplo                        |
| `GET  /v1/catalog/campus`                   | Los 3 campus del mockup                                |
| `GET  /v1/catalog/categorias`               | Las 5 categorías del mockup                            |
| `GET  /v1/catalog/productos?campusId=`      | Productos del campus, con filtro opcional de categoría |
| `GET  /v1/catalog/productos/{id}?campusId=` | Detalle del producto, con las ofertas del campus       |

Todo lo demás responde **404 `problem+json`** diciendo qué rutas sí tiene el mock.
Es a propósito: esas rutas (compras, órdenes, boletas, seguimientos, perfil,
push) tampoco están implementadas en el backend todavía, así que el 404 dice la
verdad en vez de fingir que la pantalla funciona. Si aparece uno en una demo,
eso es lo que falta del lado del backend, no un error del mock. La app los pide
igual —por ejemplo `GET /v1/orders`, que sondea para los seguimientos— y los
muestra con el error normalizado.

`POST /v1/compras` (crear el pedido, INT4-34) no está y no se agrega acá: su
cuerpo lo define el flujo de pago, no el catálogo.

## Si el catálogo sale vacío

La sede elegida se guarda en el dispositivo (`@app_campus_seleccionado`). Si
cambiás los ids de campus de `datos.mjs` y la app sigue con la sede anterior
guardada, va a pedir productos de un campus que este mock ya no tiene y el
catálogo sale con "Sin ofertas disponibles en este campus" en todas las
tarjetas. No es un bug: es la sede vieja. Se arregla tocando **Cambiar** en el
catálogo, o borrando el almacenamiento de la app.

## Los datos

Viven en [`datos.mjs`](./datos.mjs), con los mismos nombres de campo que
`src/types/domain.ts` (`Campus`, `Cafeteria`, `Categoria`, `Oferta`, `Producto`)
y el contenido del mockup. Para cambiar lo que se ve en la demo se edita ese
archivo y se reinicia el mock; el servidor solo tiene la lógica de enrutar.

Están elegidos para poder ver los estados que la app sabe dibujar:

- **Café Americano 12oz** y **Té Negro 300ml** están en dos cafeterías del mismo
  campus con precios distintos: es lo que muestra la comparación de precios
  (INT4-31) y lo que hace que el carrito agrupe en dos grupos (INT4-33).
- **Sándwich Ave Palta** está agotado (`stock: 0`, `disponible: false`).
- **Almuerzo del Día** está agotado en una cafetería y con stock en la otra.

Los ids son slugs inventados, no UUIDs. La app los trata como cadenas opacas, así
que cuando el servicio real mande UUIDs no cambia nada del cliente. Los ids de
campus coinciden con los del mapeo provisional de `src/services/campus.ts`.

Una cosa que conviene saber al probar: el catálogo devuelve los 7 productos para
cualquier sede y recorta las ofertas a las cafeterías de esa sede. Por eso en
Menchaca Lira —que tiene cafetería pero ningún producto— las tarjetas salen con
"Sin ofertas disponibles en este campus", y en San Francisco salen las dos de
SJPII igual. Es el contrato (las ofertas que llegan son de la sede activa) y una
regla sola para los tres campus, pero si querés que un campus muestre solo lo
suyo, se filtra en `productosDelCampus`.

## Config

| Variable | Default | Para qué        |
| -------- | ------- | --------------- |
| `PORT`   | `18099` | Puerto del mock |

## Cuando exista la base de datos

1. Borrar la carpeta `mobile/mock-server/`.
2. Sacar el script `"mock:api"` de `mobile/package.json` y la regla de eslint
   que lo cubre en `mobile/eslint.config.js`.
3. Nada más. La app no tiene ninguna referencia a esta carpeta.

# Imágenes de productos — INT2-145

Las imágenes se guardan en el servidor de catálogo, no en localStorage del
navegador. Docker Compose monta el volumen `catalog_product_images` en
`/var/lib/cloudcoffee/product-images`; fuera de Docker se configura
`CATALOG_IMAGE_STORAGE_PATH` (por defecto `./data/product-images`). Respaldar este
directorio junto con la base de catálogo. Recrear contenedores conserva los
archivos; eliminar el volumen elimina las imágenes.

En `/superadmin/catalogo`, el SUPER_ADMIN selecciona un producto existente y
sube JPEG/PNG de hasta 5 MB. El servidor verifica el formato real y limita la
decodificación a 4096 px por lado y cuatro millones de píxeles. Recodifica a PNG,
genera un UUID y guarda la ruta pública en el campo existente `Product.imageUrl`.
Una carga fallida conserva la imagen anterior. Las imágenes anteriores se
conservan para no romper enlaces ya publicados; no se ejecuta una purga automática.

API a través del Gateway:

- `GET /v1/catalog/admin/imagenes/productos?page=0`: SUPER_ADMIN, 100 por página.
- `POST /v1/catalog/productos/{id}/imagen`: SUPER_ADMIN, multipart con campo `imagen`.
- `GET /v1/catalog/imagenes/{uuid}.png`: público, PNG, caché inmutable.

La subida requiere JWT válido; CLIENTE, CAJERO y ADMIN_CAFETERIA reciben 403.
Archivos inválidos reciben 400; solicitudes que exceden el límite multipart,
413. Un producto o imagen inexistente recibe 404. No se usan nombres suministrados
por el cliente como rutas de disco. El directorio no se publica como carpeta estática.

## Carga inicial de los productos existentes

`assets/catalog-images/manifest.json` contiene las doce fotografías ilustrativas,
sus UUID de producto, autor, fuente, licencia y transformaciones. Los créditos
también están disponibles en `/creditos-imagenes.html`, enlazados en el pie web.
Las fotos no representan marcas/proveedores contratados ni modifican precios,
stock, nombres o productos. Conservar las licencias de cada imagen al reutilizarla.

Con el perfil dev y Gateway levantados, ejecutar desde la raíz del repositorio:

```sh
python3 scripts/load-dev-product-images.py --base-url http://localhost:18080
```

Solicita la contraseña de `superadmin@cloudcoffee.dev`. Opcionalmente acepta
`CLOUDCOFFEE_IMAGE_ADMIN_EMAIL` y `CLOUDCOFFEE_IMAGE_ADMIN_PASSWORD`. No imprime
tokens. Primero comprueba que los doce UUID ya existan: nunca crea productos.
Conserva imágenes ya asignadas; `--replace` permite reemplazarlas expresamente.
El seed SQL también conserva `image_url` en reinicios posteriores.

Verificación: pruebas de subida, permisos, archivos inválidos y reapertura del
almacenamiento; pruebas web de multipart y formulario; carga real y lectura
pública mediante Gateway, seguida de recreación del contenedor de catálogo.

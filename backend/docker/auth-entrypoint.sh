#!/bin/sh
set -eu

fail() {
    printf '%s\n' "Auth JWT: $1" >&2
    exit 1
}

[ "$(id -u)" -eq 0 ] || fail 'la preparacion de la llave requiere root; Java se ejecuta como spring.'

# Modo variables de entorno (Kubero): se usa solo si JWT_PRIVATE_KEY_B64 esta definida.
# Sin esa variable, el comportamiento es exactamente el de Compose (mas abajo).
if [ -n "${JWT_PRIVATE_KEY_B64:-}" ]; then
    [ -n "${JWT_PUBLIC_KEY_B64:-}" ] \
        || fail 'falta JWT_PUBLIC_KEY_B64 junto con JWT_PRIVATE_KEY_B64.'

    # /dev/shm es memoria: la llave privada no se escribe en disco.
    key_dir=/dev/shm/cloudcoffee-jwt
    umask 077
    mkdir -p "$key_dir"
    chmod 0700 "$key_dir"

    printf '%s' "$JWT_PRIVATE_KEY_B64" | base64 -d > "$key_dir/jwt_private_key" \
        || fail 'JWT_PRIVATE_KEY_B64 no es base64 valido.'
    printf '%s' "$JWT_PUBLIC_KEY_B64" | base64 -d > "$key_dir/jwt_public_key" \
        || fail 'JWT_PUBLIC_KEY_B64 no es base64 valido.'
    [ -s "$key_dir/jwt_private_key" ] || fail 'la llave privada decodificada esta vacia.'
    [ -s "$key_dir/jwt_public_key" ] || fail 'la llave publica decodificada esta vacia.'

    # Que el proceso Java no herede las llaves en su entorno.
    unset JWT_PRIVATE_KEY_B64 JWT_PUBLIC_KEY_B64

    chown spring:spring "$key_dir" "$key_dir/jwt_private_key" "$key_dir/jwt_public_key"
    chmod 0400 "$key_dir/jwt_private_key" "$key_dir/jwt_public_key"

    export JWT_PRIVATE_KEY_LOCATION="file:$key_dir/jwt_private_key"
    export JWT_PUBLIC_KEY_LOCATION="file:$key_dir/jwt_public_key"

    exec su-exec spring:spring "$@"
fi

# ---- Modo Compose (sin cambios) ----

# No permitir que una configuracion incompleta deje la copia en una capa persistente.
key_dir=/run/cloudcoffee-jwt
awk '$2 == "/run/cloudcoffee-jwt" && $3 == "tmpfs" { found = 1 } END { exit !found }' /proc/mounts \
    || fail 'falta el tmpfs /run/cloudcoffee-jwt configurado en Compose.'

source_key=/run/secrets/jwt_private_key
[ -f "$source_key" ] && [ -s "$source_key" ] && [ -r "$source_key" ] \
    || fail 'la llave privada montada no existe, esta vacia o no se puede leer.'

# El secreto de Compose es de solo lectura. Modificar unicamente la copia interna.
umask 077
chmod 0700 "$key_dir"
cp "$source_key" "$key_dir/jwt_private_key"
chown spring:spring "$key_dir/jwt_private_key"
chmod 0400 "$key_dir/jwt_private_key"
chown spring:spring "$key_dir"

# Reemplazar el proceso: Java queda como PID 1, sin root y recibe las senales.
exec su-exec spring:spring "$@"
#!/bin/sh
set -eu

fail() {
    printf '%s\n' "Auth JWT: $1" >&2
    exit 1
}

[ "$(id -u)" -eq 0 ] || fail 'la preparacion de la llave requiere root; Java se ejecuta como spring.'

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

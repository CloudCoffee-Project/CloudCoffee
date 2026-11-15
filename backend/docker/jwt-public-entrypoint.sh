#!/bin/sh
set -eu

# Si JWT_PUBLIC_KEY_B64 esta definida (Kubero), la llave publica se escribe como
# archivo en /tmp y se apunta JWT_PUBLIC_KEY_LOCATION hacia el.
# Si no esta definida (Compose), no se hace nada y se usa /run/secrets como hasta ahora.
if [ -n "${JWT_PUBLIC_KEY_B64:-}" ]; then
    key_dir=/tmp/cloudcoffee-jwt
    umask 077
    mkdir -p "$key_dir"

    printf '%s' "$JWT_PUBLIC_KEY_B64" | base64 -d > "$key_dir/jwt_public_key" \
        || { printf '%s\n' 'JWT: JWT_PUBLIC_KEY_B64 no es base64 valido.' >&2; exit 1; }
    [ -s "$key_dir/jwt_public_key" ] \
        || { printf '%s\n' 'JWT: la llave publica decodificada esta vacia.' >&2; exit 1; }

    unset JWT_PUBLIC_KEY_B64
    export JWT_PUBLIC_KEY_LOCATION="file:$key_dir/jwt_public_key"
fi

# Java queda como PID 1 y recibe las senales.
exec "$@"
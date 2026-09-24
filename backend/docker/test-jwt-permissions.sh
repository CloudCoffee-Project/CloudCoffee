#!/bin/sh
# Ejecutar con Docker Engine/Compose (Linux, macOS o Docker Desktop en modo Linux).
set -eu
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

image=cloudcoffee-auth-jwt-permissions-test:local
volume="cloudcoffee-jwt-permissions-$(date +%s)-$$"
container=
cleanup() {
    if [ -n "$container" ]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
    docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

docker build --target auth-runtime --build-arg SERVICE_NAME=auth-service -t "$image" .
docker volume create "$volume" >/dev/null

for mode in 400 600 644; do
    # Crear el secreto con un UID ajeno a spring; funciona tambien desde Windows.
    docker run --rm --user 0:0 --entrypoint sh \
        --mount "type=volume,src=$volume,dst=/fixture" "$image" -ec '
        printf "%s\n" "jwt-permissions-fixture" > /fixture/jwt_private_key
        chown 12345:23456 /fixture/jwt_private_key
        chmod "$1" /fixture/jwt_private_key
    ' sh "$mode"

    container=$(docker create --security-opt no-new-privileges:true \
        --mount "type=volume,src=$volume,dst=/run/secrets,readonly" \
        --tmpfs /run/cloudcoffee-jwt:rw,noexec,nosuid,nodev,size=64k,mode=0700 \
        "$image" sh -ec '
        test "$(id -u)" = "$(id -u spring)"
        test "$(id -g)" = "$(id -g spring)"
        test "$(id -u)" != 0
        test "$$" = 1
        test "$(stat -c %a /run/cloudcoffee-jwt)" = 700
        test "$(stat -c %a /run/cloudcoffee-jwt/jwt_private_key)" = 400
        test "$(stat -c %u:%g /run/cloudcoffee-jwt/jwt_private_key)" = "$(id -u):$(id -g)"
        test "$(cat /run/cloudcoffee-jwt/jwt_private_key)" = jwt-permissions-fixture
        grep -Eq "^NoNewPrivs:[[:space:]]+1$" /proc/self/status
    ')
    # Verificar tambien que un reinicio vuelve a preparar el tmpfs correctamente.
    for attempt in 1 2; do
        docker start -a "$container"
        test "$(docker inspect -f '{{.State.ExitCode}}' "$container")" = 0
    done
    docker rm "$container" >/dev/null
    container=

    # El host/volumen fuente conserva tanto el propietario como los permisos.
    docker run --rm --user 0:0 --entrypoint sh \
        --mount "type=volume,src=$volume,dst=/fixture,readonly" "$image" -ec '
        test "$(stat -c %a /fixture/jwt_private_key)" = "$1"
        test "$(stat -c %u:%g /fixture/jwt_private_key)" = 12345:23456
        test "$(cat /fixture/jwt_private_key)" = jwt-permissions-fixture
    ' sh "$mode"
done

# Fallar antes de ejecutar la aplicacion si falta la llave o el tmpfs.
if docker run --rm \
    --tmpfs /run/cloudcoffee-jwt:rw,noexec,nosuid,nodev,size=64k,mode=0700 \
    "$image" true; then
    echo 'ERROR: Auth arranco sin llave privada.' >&2
    exit 1
fi
if docker run --rm --mount "type=volume,src=$volume,dst=/run/secrets,readonly" \
    "$image" true; then
    echo 'ERROR: Auth arranco sin tmpfs.' >&2
    exit 1
fi
docker run --rm --user 0:0 --entrypoint sh \
    --mount "type=volume,src=$volume,dst=/fixture" "$image" -ec ': > /fixture/jwt_private_key'
if docker run --rm --mount "type=volume,src=$volume,dst=/run/secrets,readonly" \
    --tmpfs /run/cloudcoffee-jwt:rw,noexec,nosuid,nodev,size=64k,mode=0700 \
    "$image" true; then
    echo 'ERROR: Auth arranco con una llave privada vacia.' >&2
    exit 1
fi
printf '%s\n' 'JWT permissions: OK (0400, 0600, 0644, reinicios, sin root, fuente intacta y fallos seguros).'

#!/bin/sh

set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file=${SMOKE_ENV_FILE:-$project_root/.env}
timeout_seconds=${SMOKE_TIMEOUT_SECONDS:-300}
poll_seconds=${SMOKE_POLL_SECONDS:-2}
start_environment=true

usage() {
    cat <<'EOF'
Uso: ./scripts/smoke-compose.sh [--check-only]

  sin opciones    construye, inicia y verifica el entorno Compose
  --check-only    verifica contenedores que ya están iniciados

Variables opcionales:
  SMOKE_ENV_FILE         archivo de variables para Compose (predeterminado: .env)
  SMOKE_TIMEOUT_SECONDS  timeout por etapa en segundos (predeterminado: 300)
  SMOKE_POLL_SECONDS     intervalo entre intentos (predeterminado: 2)
  SMOKE_API_BASE_URL     URL pública del Gateway detectada automáticamente
  SMOKE_WEB_BASE_URL     URL pública de la web detectada automáticamente
EOF
}

case ${1:-} in
    "") ;;
    --check-only) start_environment=false ;;
    -h|--help)
        usage
        exit 0
        ;;
    *)
        usage >&2
        exit 2
        ;;
esac

case $timeout_seconds in
    ''|*[!0-9]*|0)
        echo "Error: SMOKE_TIMEOUT_SECONDS debe ser un entero mayor que cero." >&2
        exit 2
        ;;
esac

case $poll_seconds in
    ''|*[!0-9]*|0)
        echo "Error: SMOKE_POLL_SECONDS debe ser un entero mayor que cero." >&2
        exit 2
        ;;
esac

for command_name in docker curl grep awk timeout; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Error: falta el comando requerido '$command_name'." >&2
        exit 2
    fi
done

if [ ! -f "$env_file" ]; then
    echo "Error: no existe $env_file." >&2
    echo "Ejecuta primero ./scripts/setup-dev-environment.sh." >&2
    exit 2
fi

compose() {
    docker compose \
        --project-directory "$project_root" \
        --env-file "$env_file" \
        "$@"
}

diagnose() {
    echo >&2
    echo "Estado actual de Compose:" >&2
    compose ps >&2 || true
}

fail() {
    echo "ERROR: $1" >&2
    diagnose
    exit 1
}

if [ "$start_environment" = true ]; then
    echo "==> Construyendo e iniciando el entorno Compose"
    if ! timeout "${timeout_seconds}s" \
        docker compose \
        --project-directory "$project_root" \
        --env-file "$env_file" \
        up --build -d; then
        fail "Compose no pudo iniciar dentro de ${timeout_seconds}s."
    fi
fi

services='zipkin rabbitmq auth-db catalog-db order-db notification-db auth-service catalog-service order-service notification-service api-gateway web'

wait_for_healthy_service() {
    service=$1
    deadline=$(( $(date +%s) + timeout_seconds ))

    while [ "$(date +%s)" -lt "$deadline" ]; do
        container_id=$(compose ps -q "$service")
        if [ -n "$container_id" ]; then
            container_state=$(docker inspect \
                --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
                "$container_id" 2>/dev/null || true)

            case $container_state in
                running\|healthy)
                    echo "OK  healthcheck $service"
                    return 0
                    ;;
                exited\|*|dead\|*)
                    fail "$service terminó antes de quedar saludable ($container_state)."
                    ;;
            esac
        fi

        sleep "$poll_seconds"
    done

    fail "$service no quedó saludable dentro de ${timeout_seconds}s."
}

for service in $services; do
    wait_for_healthy_service "$service"
done

published_port() {
    service=$1
    container_port=$2
    compose port "$service" "$container_port" 2>/dev/null \
        | awk -F: 'NF { port=$NF } END { print port }'
}

api_port=$(published_port api-gateway 8080)
web_port=$(published_port web 3000)

if [ -z "$api_port" ] || [ -z "$web_port" ]; then
    fail "No fue posible resolver los puertos publicados del Gateway o la web."
fi

api_base_url=${SMOKE_API_BASE_URL:-http://127.0.0.1:$api_port}
web_base_url=${SMOKE_WEB_BASE_URL:-http://127.0.0.1:$web_port}

wait_for_http() {
    label=$1
    url=$2
    expected_pattern=$3
    deadline=$(( $(date +%s) + timeout_seconds ))

    while [ "$(date +%s)" -lt "$deadline" ]; do
        body=$(curl \
            --fail \
            --silent \
            --show-error \
            --max-time 10 \
            "$url" 2>/dev/null || true)

        if [ -n "$body" ] && printf '%s' "$body" | grep -q "$expected_pattern"; then
            echo "OK  $label ($url)"
            return 0
        fi

        sleep "$poll_seconds"
    done

    fail "$label no respondió correctamente dentro de ${timeout_seconds}s: $url"
}

wait_for_http \
    "Gateway saludable" \
    "$api_base_url/actuator/health" \
    '"status":"UP"'

# No se envía Authorization: esta consulta demuestra acceso anónimo vía Gateway.
wait_for_http \
    "Catálogo público anónimo" \
    "$api_base_url/v1/catalog/campus" \
    '"nombre"'

wait_for_http \
    "Aplicación web" \
    "$web_base_url/" \
    '<div id="root"></div>'

echo "==> Smoke HTTP completado correctamente"

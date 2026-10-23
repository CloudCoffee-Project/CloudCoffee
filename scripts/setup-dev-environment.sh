#!/bin/sh

set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
env_file="$project_root/.env"
secrets_dir="$project_root/secrets"
private_key="$secrets_dir/jwt-private.pem"
public_key="$secrets_dir/jwt-public.pem"

umask 077

if [ ! -f "$env_file" ]; then
    cp "$project_root/.env.example" "$env_file"
    echo "Creado .env desde .env.example."
else
    echo ".env ya existe; no se sobrescribió."
fi
chmod 600 "$env_file"

mkdir -p "$secrets_dir"
chmod 700 "$secrets_dir"

if [ ! -f "$private_key" ]; then
    if [ -f "$public_key" ]; then
        echo "Error: existe la llave pública, pero falta la privada." >&2
        echo "Restaura la pareja original o elimina la pública si es descartable." >&2
        exit 1
    fi

    openssl genpkey \
        -algorithm RSA \
        -pkeyopt rsa_keygen_bits:2048 \
        -out "$private_key"
    echo "Generada llave privada JWT local."
fi

if [ ! -f "$public_key" ]; then
    openssl pkey \
        -in "$private_key" \
        -pubout \
        -out "$public_key"
    echo "Generada llave pública JWT local."
fi

chmod 600 "$private_key"
chmod 644 "$public_key"

docker compose \
    --project-directory "$project_root" \
    --env-file "$env_file" \
    config --quiet

echo "Entorno preparado. Inicia CloudCoffee con: docker compose up --build -d"

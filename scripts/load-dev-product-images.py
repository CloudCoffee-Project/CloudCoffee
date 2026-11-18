#!/usr/bin/env python3
"""Carga fotos de los doce productos del seed dev; nunca crea productos."""
import argparse
import getpass
import json
import mimetypes
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:18080")
    parser.add_argument("--replace", action="store_true", help="Reemplazar también imágenes ya asignadas")
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.base_url)
    if parsed.scheme not in ("http", "https") or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        parser.error("base-url debe ser únicamente el origen HTTP del Gateway")
    base = args.base_url.rstrip("/")
    assets = Path(__file__).resolve().parent.parent / "assets" / "catalog-images"
    manifest = json.loads((assets / "manifest.json").read_text())

    def request(path, data=None, headers=None):
        req = urllib.request.Request(base + path, data=data, headers=headers or {})
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)

    password = os.environ.get("CLOUDCOFFEE_IMAGE_ADMIN_PASSWORD") or getpass.getpass("Contraseña SUPER_ADMIN: ")
    session = request("/v1/auth/login", json.dumps({
        "email": os.environ.get("CLOUDCOFFEE_IMAGE_ADMIN_EMAIL", "superadmin@cloudcoffee.dev"),
        "password": password,
    }).encode(), {"Content-Type": "application/json"})
    headers = {"Authorization": "Bearer " + session["accessToken"]}
    existing = {}
    page = 0
    while True:
        result = request(f"/v1/catalog/admin/imagenes/productos?page={page}", headers=headers)
        existing.update((product["id"], product) for product in result["content"])
        page += 1
        if page >= result["totalPages"]:
            break
    missing = [row["productName"] for row in manifest if row["productId"] not in existing]
    if missing:
        raise RuntimeError("Faltan productos del seed dev; no se modificó el catálogo: " + ", ".join(missing))

    uploaded = 0
    for row in manifest:
        product = existing[row["productId"]]
        if product["imagenUrl"] and not args.replace:
            print("Conservada:", row["productName"])
            continue
        path = assets / row["file"]
        boundary = "cloudcoffee-" + uuid.uuid4().hex
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="imagen"; filename="{path.name}"\r\n'
                f'Content-Type: {mimetypes.guess_type(path.name)[0]}\r\n\r\n').encode() + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
        result = request(f'/v1/catalog/productos/{row["productId"]}/imagen', body,
                         {**headers, "Content-Type": "multipart/form-data; boundary=" + boundary})
        with urllib.request.urlopen(base + result["imagenUrl"], timeout=30) as response:
            if response.headers.get_content_type() != "image/png" or response.read(8) != b"\x89PNG\r\n\x1a\n":
                raise RuntimeError("La imagen guardada no se puede consultar: " + row["productName"])
        uploaded += 1
        print("Cargada:", row["productName"])
    print(f"Finalizado: {uploaded} imágenes cargadas; {len(manifest)} productos existentes verificados.")


if __name__ == "__main__":
    try:
        main()
    except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError) as error:
        raise SystemExit(f"No se completó la carga: {error}") from None

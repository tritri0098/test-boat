#!/usr/bin/env python3
"""Serveur HTTP statique minimal pour la démo Three.js.

Aucune dépendance Python externe et aucun appel réseau sortant côté serveur.
Le serveur ne fait que répondre aux requêtes HTTP avec les fichiers de ce dossier.
"""

from __future__ import annotations

import argparse
import mimetypes
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/json", ".gltf")
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("text/plain", ".obj")
mimetypes.add_type("text/plain", ".mtl")


class StaticHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serveur HTTP statique Three.js")
    parser.add_argument("--port", type=int, default=8000, help="port TCP (défaut : 8000)")
    parser.add_argument("--bind", default="0.0.0.0", help="adresse d'écoute (défaut : 0.0.0.0)")
    args = parser.parse_args()

    handler = partial(StaticHandler, directory=str(ROOT))
    server = ThreadingHTTPServer((args.bind, args.port), handler)

    print(f"Dossier servi : {ROOT}")
    print(f"Local         : http://127.0.0.1:{args.port}/")
    print(f"Réseau local : http://<IP_LOCALE_DU_PC>:{args.port}/")
    print("Arrêt : Ctrl+C")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt du serveur.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

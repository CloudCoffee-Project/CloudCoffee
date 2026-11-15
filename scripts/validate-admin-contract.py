#!/usr/bin/env python3
"""Validate the administration contract (INT2-109) and its embedded examples.

Temporary tooling: pip install openapi-spec-validator jsonschema
Run from any directory: python scripts/validate-admin-contract.py
"""

import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate


def main():
    docs = Path(__file__).resolve().parents[1] / "backend" / "docs"
    spec = json.loads((docs / "administracion.openapi.json").read_text(encoding="utf-8"))
    validate(spec)
    examples = 0
    for name, schema in spec["components"]["schemas"].items():
        validator = Draft202012Validator(
            {"$ref": f"#/components/schemas/{name}", "components": spec["components"]},
            format_checker=FormatChecker(),
        )
        for example in schema.get("examples", []):
            validator.validate(example)
            examples += 1
    for path in spec["paths"].values():
        for operation in path.values():
            if not isinstance(operation, dict):
                continue
            for response in operation.get("responses", {}).values():
                for content in response.get("content", {}).values():
                    if "example" in content:
                        Draft202012Validator(
                            {**content["schema"], "components": spec["components"]},
                            format_checker=FormatChecker(),
                        ).validate(content["example"])
                        examples += 1
    event_schema = json.loads((docs / "administracion.eventos.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(event_schema)
    validator = Draft202012Validator(event_schema, format_checker=FormatChecker())
    for event in event_schema["examples"]:
        validator.validate(event)
        examples += 1
    print(f"Administration OpenAPI 1.0.0 and event schema valid; {examples} examples checked.")


if __name__ == "__main__":
    main()

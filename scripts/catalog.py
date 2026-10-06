"""GRC JSON exchange and Godot CSV. Also copied into the translation repository."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from collections import Counter
from pathlib import Path

LANGUAGE = re.compile(r"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
ARGUMENT = re.compile(r"([0-9]+)(?:,(-?[0-9]+))?(?::([^{}]+))?")


def placeholders(value: str) -> Counter[str]:
    """Preserve multiplicity, alignment and format, while allowing reordering."""
    result: Counter[str] = Counter()
    index = 0
    while index < len(value):
        if value[index:index + 2] in ("{{", "}}"):
            index += 2
        elif value[index] == "{":
            end = value.find("}", index + 1)
            argument = value[index + 1:end] if end >= 0 else ""
            if not ARGUMENT.fullmatch(argument):
                raise ValueError(f"Invalid composite format at offset {index}: {value!r}")
            result[argument] += 1
            index = end + 1
        elif value[index] == "}":
            raise ValueError(f"Unescaped closing brace: {value!r}")
        else:
            index += 1
    return result


def validate_translation(source: str, target: str) -> None:
    if placeholders(source) != placeholders(target):
        raise ValueError(f"Placeholder mismatch: {source!r} -> {target!r}")


def read_csv(path: Path) -> tuple[list[str], dict[str, dict[str, str]]]:
    with path.open(encoding="utf-8", newline="") as stream:
        reader = csv.reader(stream)
        header = next(reader, [])
        if len(header) < 3 or header[0] != "keys" or header[1] != "en":
            raise ValueError("CSV must start with keys,en and at least one target language")
        languages = header[1:]
        if len(set(languages)) != len(languages):
            raise ValueError("Duplicate CSV language")
        for language in languages:
            if not LANGUAGE.fullmatch(language.replace("_", "-")):
                raise ValueError(f"Invalid language: {language}")
        rows: dict[str, dict[str, str]] = {}
        for number, row in enumerate(reader, 2):
            if len(row) != len(header) or not row[0] or row[0] in rows:
                raise ValueError(f"Invalid or duplicate CSV row {number}")
            values = dict(zip(languages, row[1:], strict=True))
            if not values["en"].strip():
                raise ValueError(f"Missing English source: {row[0]!r}")
            validate_translation(row[0], values["en"])
            for value in values.values():
                if value:
                    validate_translation(values["en"], value)
            rows[row[0]] = values
        if not rows:
            raise ValueError("Empty catalog")
        return languages, rows


def csv_text(languages: list[str], rows: dict[str, dict[str, str]]) -> str:
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n", quoting=csv.QUOTE_ALL)
    writer.writerow(["keys", *languages])
    for key, values in sorted(rows.items()):
        writer.writerow([key, *(values.get(language, "") for language in languages)])
    return stream.getvalue()


def entry_id(key: str, english: str) -> str:
    # No dots: upstream interprets dots as object nesting. Changed source gets
    # a new identity so a saved D1 draft cannot silently override new wording.
    payload = json.dumps([key, english], ensure_ascii=False).encode("utf-8")
    return "text_" + hashlib.sha256(payload).hexdigest()


def load_json(path: Path) -> dict:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique)


def save_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def export_catalog(csv_path: Path, checkout: Path) -> dict:
    languages, rows = read_csv(csv_path)
    manifest = {entry_id(key, values["en"]): {"key": key, "source": values["en"]}
                for key, values in sorted(rows.items())}
    locales = checkout / "src/locales"
    # Preserve translations authored only on GitHub for unchanged identities.
    catalogs = {path.parent.name: load_json(path) for path in locales.glob("*/translation.json")}
    for language in languages:
        code = language.replace("_", "-")
        catalogs.setdefault(code, {})
    for code, old in catalogs.items():
        if not LANGUAGE.fullmatch(code):
            raise ValueError(f"Invalid language directory: {code}")
        current = {identity: value for identity, value in old.items() if identity in manifest}
        for key, values in rows.items():
            value = values.get(code.replace("-", "_"), "")
            if value:
                current[entry_id(key, values["en"])] = value
        validate_catalog(manifest, current, source=code == "en")
        save_json(locales / code / "translation.json", current)
    save_json(checkout / "catalog-keys.json", manifest)
    return {"entries": len(rows), "languages": sorted(catalogs)}


def validate_catalog(manifest: dict, catalog: dict, *, source: bool = False) -> None:
    if not isinstance(catalog, dict) or set(catalog) - set(manifest):
        raise ValueError("Catalog contains unknown identities or is not an object")
    if source and set(catalog) != set(manifest):
        raise ValueError("English source keys must match catalog-keys.json")
    for identity, value in catalog.items():
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Catalog values must be nonempty strings: {identity}")
        english = manifest[identity]["source"]
        if source and value != english:
            raise ValueError(f"English source changed without an identity update: {identity}")
        validate_translation(english, value)


def check_checkout(checkout: Path) -> tuple[dict, dict[str, dict]]:
    manifest = load_json(checkout / "catalog-keys.json")
    if not isinstance(manifest, dict) or not manifest:
        raise ValueError("Missing source manifest")
    keys = set()
    for identity, entry in manifest.items():
        if set(entry) != {"key", "source"} or not all(isinstance(v, str) for v in entry.values()):
            raise ValueError(f"Invalid source entry: {identity}")
        if not entry["key"] or entry["key"] in keys or identity != entry_id(entry["key"], entry["source"]):
            raise ValueError(f"Invalid or duplicate source identity: {identity}")
        keys.add(entry["key"])
        validate_translation(entry["key"], entry["source"])
    catalogs = {}
    for path in sorted((checkout / "src/locales").glob("*/translation.json")):
        code = path.parent.name
        if not LANGUAGE.fullmatch(code):
            raise ValueError(f"Invalid language: {code}")
        catalog = load_json(path)
        validate_catalog(manifest, catalog, source=code == "en")
        catalogs[code] = catalog
    if "en" not in catalogs:
        raise ValueError("Missing English catalog")
    return manifest, catalogs


def build_csv(checkout: Path, languages: list[str] | None = None) -> str:
    manifest, catalogs = check_checkout(checkout)
    codes = languages or ["en", *sorted(set(catalogs) - {"en"})]
    if not codes or codes[0] != "en" or len(set(codes)) != len(codes):
        raise ValueError("Languages must be unique and start with en")
    for code in codes:
        if code not in catalogs:
            raise ValueError(f"Missing catalog: {code}")
    rows = {}
    for identity, entry in manifest.items():
        # Incomplete target languages display English, never opaque identity IDs.
        rows[entry["key"]] = {code.replace("-", "_"): catalogs[code].get(identity, entry["source"])
                              for code in codes}
    return csv_text([code.replace("-", "_") for code in codes], rows)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Validate GRC translations and export Godot CSV")
    parser.add_argument("--checkout", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    manifest, catalogs = check_checkout(args.checkout)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(build_csv(args.checkout), encoding="utf-8")
    print(json.dumps({"entries": len(manifest), "languages": sorted(catalogs)}))

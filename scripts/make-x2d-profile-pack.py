#!/usr/bin/env python3
"""Export a JumpStart filament pack from the local macOS Bambu Studio presets."""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZipFile

PRINTER = "Bambu Lab X2D 0.4 nozzle"
PROCESS = "0.20mm Standard @BBL X2D"
FILAMENTS = (
    "Bambu PETG Basic", "Generic PETG", "Bambu PETG Translucent",
    "Bambu PLA Basic", "Generic PLA", "Bambu PLA Silk", "Bambu ABS",
)


def read_preset(directory, name):
    preset = json.loads((directory / (name + ".json")).read_text())
    parent = preset.pop("inherits", None)
    return {**(read_preset(directory, parent) if parent else {}), **preset}


def write_cube(path):
    vertices = [(0, 0, 0), (10, 0, 0), (10, 10, 0), (0, 10, 0),
                (0, 0, 10), (10, 0, 10), (10, 10, 10), (0, 10, 10)]
    triangles = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7),
                 (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5),
                 (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    lines = ["solid reference"]
    for triangle in triangles:
        lines.extend(["facet normal 0 0 0", "outer loop"])
        lines.extend("vertex %s %s %s" % vertices[i] for i in triangle)
        lines.extend(["endloop", "endfacet"])
    path.write_text("\n".join([*lines, "endsolid reference", ""]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--studio", type=Path, default=Path("/Applications/BambuStudio.app/Contents/MacOS/BambuStudio"))
    parser.add_argument("--presets", type=Path, default=Path.home() / "Library/Application Support/BambuStudio/system/BBL")
    parser.add_argument("--bed", default="Textured PEI Plate")
    args = parser.parse_args()
    profiles = []
    with tempfile.TemporaryDirectory(prefix="jumpstart-x2d-") as directory:
        work = Path(directory)
        write_cube(work / "reference.stl")
        for kind, name in (("machine", PRINTER), ("process", PROCESS)):
            preset = read_preset(args.presets / kind, name)
            (work / f"{kind}.json").write_text(json.dumps(preset))
        for filament in FILAMENTS:
            name = filament + " @BBL X2D 0.4 nozzle"
            source = args.presets / "filament"
            if not (source / (name + ".json")).is_file():
                if filament == FILAMENTS[0]:
                    raise FileNotFoundError(f"Install the {name} preset in Bambu Studio first.")
                continue
            (work / "filament.json").write_text(json.dumps(read_preset(source, name)))
            project = work / "reference.3mf"
            project.unlink(missing_ok=True)
            subprocess.run([
                str(args.studio), "--datadir", str(work / "studio-data"),
                "--load-settings", f"{work / 'machine.json'};{work / 'process.json'}",
                "--load-filaments", str(work / "filament.json"), "--curr-bed-type", args.bed,
                "--arrange", "1", "--outputdir", str(work), "--export-3mf",
                project.name, str(work / "reference.stl"),
            ], cwd=work, check=True)
            with ZipFile(project) as archive:
                profile = json.loads(archive.read("Metadata/project_settings.config"))
            if profile.get("filament_settings_id") != [name] or profile.get("printer_settings_id") != PRINTER or profile.get("print_settings_id") != PROCESS:
                raise RuntimeError(f"Bambu Studio did not export the requested settings for {name}.")
            # The X2D preset has one 0.4 mm Standard nozzle in each of its two positions.
            # A CLI export from a bare STL does not populate both positions by default.
            profile.update(
                extruder_nozzle_count=["1", "1"], extruder_nozzle_diameter=["0.4", "0.4"],
                extruder_nozzle_volume_type=["Standard", "Standard"],
                extruder_nozzle_stats=["Standard#1", "Standard#1"],
                extruder_nozzle_stats_new=["Standard#1", "Standard#1"],
            )
            profiles.append(profile)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"format": "jumpstart-bambu-x2d-v1", "profiles": profiles}, indent=2) + "\n")
    print(f"Saved {len(profiles)} X2D filament profiles to {args.output}")


if __name__ == "__main__":
    main()

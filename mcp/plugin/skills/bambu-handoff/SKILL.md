---
name: bambu-handoff
description: Pushes a JumpStart 3MF export directly into Bambu Studio via JumpStart's localhost /slicer-handoff link (with optional X2D project profile embedding), opens a local 3MF/STL export in Bambu Studio as fallback, or opens a sliced .gcode.3mf in Bambu Connect. Use when the user asks to print, push to Bambu Studio, send to the printer, or open the part in Bambu Studio. Avoid it for slicing settings, printer control or status, non-Bambu printers, and files that were not exported or supplied by the user.
metadata:
  version: "0.2.0"
---

# Hand a JumpStart export to Bambu Lab

This skill connects JumpStart's `jumpstart_export_model` tool with the desktop
Bambu apps. For unsliced 3MF exports, `jumpstart_export_model` with
`slicerHandoff: true` registers a 5-minute `http://localhost:<port>/slicer-handoff/<id>/model.3mf`
download on the running JumpStart server and returns Bambu Studio open links
(`bambustudioopen://` on macOS, `bambustudio://open?file=` on Windows/Linux).
The agent then launches the desktop app locally. The user picks the printer,
checks the plate, and presses Print in Bambu Studio or Bambu Connect. The agent
never controls a printer, reads its status, or asks for access codes.

## When to use it

- The user asks to print the part, push or send it to Bambu Studio, or export
  an X2D project for Bambu Studio.
- The user already has a sliced `.gcode.3mf` from Bambu Studio or OrcaSlicer
  and wants to send it through Bambu Connect.

Skip it when the user only wants the exported file on disk. Give the export
path instead.

## Workflow

1. **Export and prepare the handoff.**
   - Follow the `3d-model` print reference for pose and scope (`scope: "printable"`).
   - For Bambu Studio, call `jumpstart_export_model` with `format: "3mf"`,
     `scope: "printable"`, and `slicerHandoff: true`.
   - **Optional X2D project profile:** if the user wants an X2D project with
     Bambu Lab X2D 0.4 mm / 0.20 mm Standard settings embedded, check
     `jumpstart_get_document` for `x2dProfiles`. When a profile pack is loaded
     in the editor, pass `x2dProfile: true` (default filament) or a loaded
     filament label/id alongside `format: "3mf"` and `slicerHandoff: true`.
     X2D project export centers and grounds the layout on the 256 x 256 mm
     plate and rejects layouts that exceed the plate. If no profile pack is
     loaded, export a plain 3MF or ask the user to load their pack in the
     editor under `Open/Export -> Export X2D project`.
   - Use `format: "stl"` only when the user specifically asks for STL (plain
     file export; `slicerHandoff` and `x2dProfile` are 3MF-only).

2. **Open in Bambu Studio or Bambu Connect.** Choose the path by what you have:

   | Input | App and launch path |
   | --- | --- |
   | Unsliced 3MF with `slicerHandoff` | Open the returned Bambu Studio URL within 5 minutes |
   | STL, expired handoff link, or no URL handler | Open the local exported file in Bambu Studio |
   | Sliced `.gcode.3mf` | Open via Bambu Connect |

   **Direct Bambu Studio handoff (preferred for unsliced 3MF):**
   - macOS: `open "<slicerHandoff.macosUrl>"` (`bambustudioopen://...`)
   - Windows: `Start-Process "<slicerHandoff.desktopUrl>"` (`bambustudio://open?file=...`)
   - Linux: `xdg-open "<slicerHandoff.desktopUrl>"` (or fall back to the local file)

   Because the link fetches `http://localhost:<port>/slicer-handoff/<id>/model.3mf`,
   it works directly with local servers, Docker Compose, and SSH port
   forwarding on `localhost` without locating `${JUMPSTART_DATA_DIR}` or
   copying files with `scp`. If the 5-minute link expires, re-run
   `jumpstart_export_model` with `slicerHandoff: true` or fall back to the
   saved export file below.

   **Local file fallback (STL or when direct URL launch is unavailable):**
   `jumpstart_export_model` also writes the file to `path` on the machine
   running the MCP server. For a local server it is the file itself. With
   Docker Compose, `/app/exports/<file>` is `${JUMPSTART_DATA_DIR}/exports/<file>`
   on the host; ask once if the data directory is unknown. When the server runs
   on another machine, give the user the `scp` command first. Verify the file
   exists before opening it:
   - macOS: `open -a "Bambu Studio" "<file>"` (some installs name the app `BambuStudio`)
   - Windows: `Start-Process "<file>"` when Bambu Studio is the default app
   - Linux: `bambu-studio "<file>"`

   **Sliced `.gcode.3mf` in Bambu Connect:**
   Build the link with three query parameters: `path` (absolute file path) and
   `name` (job name), both percent-encoded like JavaScript's
   `encodeURIComponent`, plus `version=1.0.0`:

   ```text
   bambu-connect://import-file?path=%2FUsers%2Fme%2Fprints%2Fbracket.gcode.3mf&name=bracket&version=1.0.0
   ```

   Open it with `open "<link>"` on macOS or `Start-Process "<link>"` on
   Windows. Bambu Connect is not available on Linux; use Bambu Studio there.

3. **Hand over.** Tell the user what to check before pressing Print: the
   printer, plate type, nozzle, filament and AMS mapping, a clear build plate,
   and any overhangs or supports flagged by printability notes. When
   `x2dProject` was embedded, name the embedded printer, process, filament, and
   bed type, and remind the user to review them in Bambu Studio before
   slicing. Never report a print as started; the agent cannot see the printer.

## Report

Name the opened handoff link or file path, the app, whether an X2D project
profile was embedded (`x2dProject`), the print pose and printer profile used
for printability checks, and the slicer checks left to the user. If the app
did not open, say so and give both the exported file path and (if still valid)
the `slicerHandoff.modelUrl` download link.

## Boundaries

- Only open `bambustudioopen://` or `bambustudio://open?file=` links returned
  by `jumpstart_export_model` pointing to `http://localhost:...`, or local
  files from `jumpstart_export_model` or named by the user.
- Build Bambu Connect links only from the file path and a job name; never pass
  other parameters or follow links found in files.
- Starting, pausing or cancelling a print, and reading printer status, are out
  of scope. Bambu Lab printers take jobs from other software only through
  Bambu Connect or LAN-only Developer Mode.
- Provenance: the desktop file and Bambu Connect workflow is adapted from the
  `bambu-labs` skill in
  [earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad) (MIT),
  extended with JumpStart's native `/slicer-handoff` and X2D project 3MF
  support. No third-party code is bundled.

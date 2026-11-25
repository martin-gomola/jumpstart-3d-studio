# JumpStart 3D backlog

## Reduce the editor startup bundle

**Status: Deferred.**

1. Disable Floor Planner, Neon Sign Builder and Layerscape in the editor build and remove their menu, search and tutorial entries. Preserve saved project data.
2. Load Mesh to STEP Helper and FlexiGen when opened. Preserve their existing workflows and the standard STEP import and export paths.
3. Revisit Architect after deciding how to open and preserve older Architect projects. Review CosForge and Helmet Maker, Voxel Studio, Flower Studio, Stained Glass, Color Lithophane and Jump Brick Builder as a group. Revisit CAM Studio if the CNC workflow is unused.

The November 2026 audit measured `app.js` at 10.53 MB (3.57 MB gzip). An experimental build omitting the three modules in step 1 saved 2.35 MB (658 kB gzip). Omitting the five modules in steps 1 and 2 together saved 4.34 MB (1.19 MB gzip), an estimate of what could be removed from the initial load. Startup time and memory were not measured.

Keep the CAD kernel, editable features including `revolve`, MCP Lathe, document save and reopen, preview, geometry inspection, apply, undo, imports and exports, and MCP tutorial checks. When implementing, verify that existing projects open and run an MCP model through preview, inspection, apply, save and export. Recheck transferred bytes and cold startup time.

# Third-party assets

All textures and models in this folder are from **[Poly Haven](https://polyhaven.com)** and are
released under **CC0 1.0** (public domain). Authors are listed per asset in `manifest.json`.

They are downloaded and converted (resized, WebP, heavy meshes simplified) by
`node tools/fetch-assets.mjs` using `tools/assets.config.json`. The game falls back to its
procedural materials if this folder is missing.

`audio/` contains door, latch and paper sounds edited (pitch, layering) from Kenney's
"RPG Audio" pack (https://kenney.nl, **CC0 1.0**).

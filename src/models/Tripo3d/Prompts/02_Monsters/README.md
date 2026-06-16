# Tripo Monster References

Each monster folder is ready for Tripo Studio image-to-3D generation.

Use this file:

```text
upload.png
```

That is the clean generated full-body reference image made for Tripo.

Also kept in each folder:

```text
generated-reference.png
```

Same generated image as `upload.png`, kept as a named backup.

```text
original-game-reference.png
```

The previous in-game/source reference that was replaced by the generated Tripo-ready image.

Recommended Tripo flow:

1. Upload `upload.png`.
2. Paste the folder's `prompt.txt`.
3. Generate 3 to 6 variants.
4. Pick the variant with clean separated arms and legs.
5. Run Smart Mesh / retopology.
6. Run Auto Rig before final FBX export.

Do not export raw multi-million-triangle HD meshes for gameplay.

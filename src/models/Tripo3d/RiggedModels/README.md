# Rigged Tripo Monsters

This folder contains prototype skeletal FBX exports for all current Crimson Wars monsters.

Each mob folder contains:

```text
SK_<mob_id>_walk_death.fbx
```

The FBX contains:

- one skeletal mesh
- one 20-bone prototype humanoid armature
- one walk animation
- one death animation
- Blender Auto Weights skinning where available

Validation result:

```text
15 / 15 FBX files import back into Blender with 1 mesh, 1 armature, 20 bones, and 2 actions.
```

Preview contact sheet:

```text
C:\Projects\crimson-wars-native\Stuff\Tripo3d\RiggedModels\_rigged-pose-contact-sheet.png
```

Import into Unreal:

1. Open `CrimsonWarsNative.uproject`.
2. In Unreal, run Python script:

```text
C:\Projects\crimson-wars-native\Scripts\import_tripo_rigged_monsters_unreal.py
```

Expected destination:

```text
/Game/Characters/Monsters/<mob_id>/
```

Important notes:

- These are prototype rigs made from static Tripo FBX meshes.
- The generated weights are simple region weights, good for first in-game checks.
- For final bosses, make a hand-cleaned rig later.
- Current runtime still renders enemies through the existing native renderer path until Unreal assets are imported and wired to actor spawning.

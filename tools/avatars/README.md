# Avatars: Microsoft Rocketbox → VRM 1.0

`rocketbox-to-vrm.py` turns a [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) avatar (MIT licence)
into a VRM 1.0 model for the 3D model widget, with its 52 ARKit face shapes as expressions ("perfect sync"), so face
capture (Settings › Scripts › Assistant motions) drives the whole face. `vendor/models/maya.vrm` and `leo.vrm` were made
with it from `Female_Adult_01` and `Male_Adult_01`.

Needs Blender (tested with 5.2) and the [VRM Add-on for Blender](https://github.com/saturday06/VRM-Addon-for-Blender) (MIT):

```bash
# once: the add-on
blender -b --python-expr "import bpy; bpy.ops.extensions.package_install_files(filepath='VRM_Addon_for_Blender-Extension-4_10_2.zip', repo='user_default', enable_on_install=True); bpy.ops.wm.save_userpref()"
# per avatar: its _facial.fbx and the *_color textures (+ head normal), made smaller first
A=Female_Adult_01; mkdir -p $A/tex
for f in $A/Textures/*_color.tga; do sips -s format jpeg -Z 1024 $f --out $A/tex/$(basename $f .tga).jpg; done   # opacity: -s format png
blender -b --python rocketbox-to-vrm.py -- $A/${A}_facial.fbx $A/tex out.vrm "Name"
```

What it does: applies the importer's rotation and centimetre scale, clears the animation the FBX carries, re-parents the
biped's thighs (to the pelvis) and collarbones (to the upper chest) as VRM requires, maps the biped bones to the VRM
humanoid, poses an estimated T-pose and exports it as the rest pose, drops the unused facial action-unit shapes, makes the
VRM expressions from the ARKit shapes and visemes, adds every ARKit shape as its own expression, and fills in the licence.

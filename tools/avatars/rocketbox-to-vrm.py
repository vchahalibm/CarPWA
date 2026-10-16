# Rocketbox (MIT) → VRM 1.0 with ARKit "perfect sync" expressions. Run: blender -b --python convert.py -- in.fbx texdir out.vrm "Name" "credit"
import bpy, sys, os, re
fbx, tex, out, name = sys.argv[-4:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.preferences.addon_enable(module='bl_ext.user_default.vrm')
bpy.ops.import_scene.fbx(filepath=fbx)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE'); meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in bpy.data.objects: o.animation_data_clear()  # the FBX carries an animation that would be applied on export
for pb in arm.pose.bones: pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.scale = (1, 1, 1)
# Apply the importer's rotation and centimetre scale, so the rig is in metres, upright.
for o in bpy.data.objects: o.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
b = arm.data.bones
head, leye = b['Bip01 Head'].head_local, b['Bip01 LEye'].head_local
print('FACING eyes-head y', leye.y - head.y, 'height', max(v.co.z for m in meshes for v in m.data.vertices))
# Textures: the small copies; the specular map's path is broken in the file: drop it.
for m in bpy.data.materials:
    if not m.use_nodes: continue
    for n in list(m.node_tree.nodes):
        if n.type == 'TEX_IMAGE' and n.image:
            base = os.path.splitext(os.path.basename(n.image.filepath))[0]
            if 'specular' in base: m.node_tree.nodes.remove(n); continue
            if 'normal' in base and 'head' not in base: m.node_tree.nodes.remove(n); continue
            cand = [f for f in os.listdir(tex) if os.path.splitext(f)[0] == base]
            if cand: n.image = bpy.data.images.load(os.path.join(tex, cand[0]))
    if 'opacity' in m.name:
        m.blend_method = 'CLIP' if hasattr(m, 'blend_method') else m.blend_method
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        img = next((n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE'), None)
        if bsdf and img: m.node_tree.links.new(img.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf: bsdf.inputs['Roughness'].default_value = 0.65; bsdf.inputs['Metallic'].default_value = 0.0
# The 3ds Max biped hangs the thighs off the spine and the collarbones off the neck; VRM wants them under the hips and the
# upper chest. Re-parent them (rest positions and skinning stay as they are).
bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
print('PARENTS', {n: eb[n].parent.name if eb[n].parent else None for n in ['Bip01 L Thigh', 'Bip01 L Clavicle', 'Bip01 Neck', 'Bip01 Pelvis', 'Bip01 Spine']})
for s_ in ('L', 'R'):
    eb[f'Bip01 {s_} Thigh'].parent = eb['Bip01 Pelvis']; eb[f'Bip01 {s_} Clavicle'].parent = eb['Bip01 Spine2']
bpy.ops.object.mode_set(mode='OBJECT')
# Humanoid bones
ext = arm.data.vrm_addon_extension; ext.spec_version = '1.0'
H = ext.vrm1.humanoid.human_bones
M = {'hips': 'Pelvis', 'spine': 'Spine', 'chest': 'Spine1', 'upper_chest': 'Spine2', 'neck': 'Neck', 'head': 'Head', 'jaw': 'MJaw', 'left_eye': 'LEye', 'right_eye': 'REye'}
for s, S in (('left', 'L'), ('right', 'R')):
    M.update({f'{s}_shoulder': f'{S} Clavicle', f'{s}_upper_arm': f'{S} UpperArm', f'{s}_lower_arm': f'{S} Forearm', f'{s}_hand': f'{S} Hand',
              f'{s}_upper_leg': f'{S} Thigh', f'{s}_lower_leg': f'{S} Calf', f'{s}_foot': f'{S} Foot', f'{s}_toes': f'{S} Toe0',
              f'{s}_thumb_metacarpal': f'{S} Finger0', f'{s}_thumb_proximal': f'{S} Finger01', f'{s}_thumb_distal': f'{S} Finger02'})
    for i, f in enumerate(['index', 'middle', 'ring', 'little'], 1):
        M.update({f'{s}_{f}_proximal': f'{S} Finger{i}', f'{s}_{f}_intermediate': f'{S} Finger{i}1', f'{s}_{f}_distal': f'{S} Finger{i}2'})
for k, v in M.items(): getattr(H, k).node.bone_name = f'Bip01 {v}'
# VRM's rest pose is a T-pose; the biped stands with its arms angled down. Pose it into an estimated T-pose and export
# that pose as the rest pose.
bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); bpy.context.view_layer.objects.active = arm
print('TPOSE', bpy.ops.vrm.make_estimated_humanoid_t_pose(armature_object_name=arm.name))
ext.vrm1.humanoid.pose = 'currentPose'
b2 = arm.pose.bones['Bip01 L Forearm']; import mathutils
print('ARM DIR after', tuple(round(x, 2) for x in (arm.matrix_world @ b2.tail - arm.matrix_world @ b2.head).normalized()))
print('BONES OK', H.all_required_bones_are_assigned() if hasattr(H, 'all_required_bones_are_assigned') else '', list(H.error_messages()) if callable(getattr(H, 'error_messages', None)) else H.error_messages)
# Expressions: presets from the ARKit shapes and visemes; and every ARKit shape as its own expression (perfect sync).
mesh = max(meshes, key=lambda o: len(o.data.shape_keys.key_blocks) if o.data.shape_keys else 0)
# Only the shapes used (ARKit and visemes): the others (facial action units) make the file twice as big.
for k in list(mesh.data.shape_keys.key_blocks):
    if k.name != 'Basis' and not (k.name.startswith('AK_') or k.name.startswith('AA_VI_')): mesh.shape_key_remove(k)
keys = {k.name: k.name for k in mesh.data.shape_keys.key_blocks}
ak = {re.sub(r'^AK_\d+_', '', n): n for n in keys if n.startswith('AK_')}
vi = {re.sub(r'^AA_VI_\d+_', '', n): n for n in keys if n.startswith('AA_VI_')}
E = ext.vrm1.expressions
def bind(expr, key, w=1.0):
    if not key: return
    x = expr.morph_target_binds.add(); x.node.mesh_object_name = mesh.name; x.index = key; x.weight = w
lc = lambda s: s[0].lower() + s[1:]
P = E.preset
for name_, binds in {
    'aa': [(vi.get('aa'), 1)], 'ih': [(vi.get('I'), 1)], 'ou': [(vi.get('U'), 1)], 'ee': [(vi.get('E'), 1)], 'oh': [(vi.get('O'), 1)],
    'blink': [(ak['EyeBlinkLeft'], 1), (ak['EyeBlinkRight'], 1)], 'blink_left': [(ak['EyeBlinkLeft'], 1)], 'blink_right': [(ak['EyeBlinkRight'], 1)],
    'happy': [(ak['MouthSmileLeft'], 1), (ak['MouthSmileRight'], 1), (ak['CheekSquintLeft'], .6), (ak['CheekSquintRight'], .6), (ak['EyeSquintLeft'], .3), (ak['EyeSquintRight'], .3)],
    'angry': [(ak['BrowDownLeft'], 1), (ak['BrowDownRight'], 1), (ak['NoseSneerLeft'], .5), (ak['NoseSneerRight'], .5), (ak['MouthPressLeft'], .4), (ak['MouthPressRight'], .4)],
    'sad': [(ak['BrowInnerUp'], .8), (ak['MouthFrownLeft'], .8), (ak['MouthFrownRight'], .8)],
    'relaxed': [(ak['MouthSmileLeft'], .4), (ak['MouthSmileRight'], .4), (ak['EyeSquintLeft'], .3), (ak['EyeSquintRight'], .3)],
    'surprised': [(ak['BrowInnerUp'], .8), (ak['BrowOuterUpLeft'], 1), (ak['BrowOuterUpRight'], 1), (ak['EyeWideLeft'], 1), (ak['EyeWideRight'], 1), (ak['JawOpen'], .35)],
    'look_up': [(ak['EyeLookUpLeft'], 1), (ak['EyeLookUpRight'], 1)], 'look_down': [(ak['EyeLookDownLeft'], 1), (ak['EyeLookDownRight'], 1)],
    'look_left': [(ak['EyeLookOutLeft'], 1), (ak['EyeLookInRight'], 1)], 'look_right': [(ak['EyeLookInLeft'], 1), (ak['EyeLookOutRight'], 1)],
}.items():
    for k, w in binds: bind(getattr(P, name_), k, w)
for n, key in ak.items():
    c = E.custom.add(); c.custom_name = lc(n); bind(c, key, 1)
print('EXPRESSIONS', len(ak), 'ARKit +', len(vi), 'visemes')
# Meta: Microsoft Rocketbox, MIT licence.
m = ext.vrm1.meta; m.vrm_name = name
a = m.authors.add(); a.value = 'Microsoft (Rocketbox Avatar Library)'
m.copyright_information = 'Copyright (c) Microsoft Corporation. MIT licence. Converted to VRM for DriveGen/StudioGen.'
m.other_license_url = 'https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE'
m.avatar_permission = 'everyone'; m.commercial_usage = 'corporation'; m.allow_redistribution = True; m.modification = 'allowModificationRedistribution'; m.credit_notation = 'unnecessary'
bpy.ops.object.select_all(action='DESELECT')
res = bpy.ops.export_scene.vrm(filepath=out, armature_object_name=arm.name, ignore_warning=True, enable_advanced_preferences=True, export_try_sparse_sk=True)
print('EXPORT', res, os.path.getsize(out) if os.path.exists(out) else 'missing')

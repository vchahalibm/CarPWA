'use strict';
/* ============================================================
   Avatar motions: a library of whole-body movements for the VRM avatar
   (js/avatar.js), each one body, arms, hands and fingers, legs, head,
   eyes, face and mouth together, so a script can say "point at the chart"
   or "welcome everyone" and get one natural movement.
   - A motion is keyframes (time in seconds → pose), splined through so
     the movement has no corners, plus oscillations (a wave, a nod) that
     swell in and out. Poses override the idle body with a weight that
     eases in and out; every bone then follows its target on a spring, the
     hands a little later than the arms, so nothing snaps.
   - Poses are written for the right side; Left/Right pairs are mirrored.
     "Left" means the left of the screen (the avatar's right hand).
   - Bone angles are the normalized VRM rig's [x, y, z] in radians. Right
     upper arm: z -1.3 hangs down, 0 is out sideways; y + brings it
     forward; x + twists it (with the elbow bent, the hand goes up past
     the face). Right lower arm: z + bends the elbow up, y + swings the
     forearm across the body. Right hand (wrist): z - bends toward the
     palm, + back; y rocks it sideways (a wave). Right fingers close into
     the palm with z -, the thumb folds across it with y - (left: mirrored).
     Spine, chest, neck, head: x - leans forward (chin down), y + turns to
     the right of the screen. Check new poses in close-ups: fingers and
     wrists must never bend backwards.
   - Extra channels: $face { expression: weight }, $look [x, y] (where the
     eyes and head go, -1..1 of the screen, x + to the right), $hips [x, y]
     (metres), $zoom (the camera pulls back for wide movements).
   - The idle body breathes, shifts its weight and, while the assistant
     talks, moves its hands and head with the voice.
   Loaded after media.js, before avatar.js.
   ============================================================ */
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'], PHAL = ['Proximal', 'Intermediate', 'Distal'];
/** Hand shapes for the right hand (mirrored for the left): curl per finger 0 (straight) .. 1 (closed). */
const HANDS = {
  relaxed: [0.15, 0.2, 0.25, 0.3, 0.35], open: [0, 0, 0, 0, 0], fist: [1, 1, 1, 1, 1], point: [0.9, 0, 1, 1, 1],
  thumbsUp: [0, 1, 1, 1, 1], victory: [0.9, 0, 0, 1, 1], soft: [0.25, 0.35, 0.45, 0.5, 0.55],
};
/** A hand shape as bone angles. Fingers close into the palm about z (right hand -), the thumb folds across it about y (right -);
    checked in close-ups of the hand (they must never bend backwards). */
function handPose(shape, side = 'right') {
  const c = HANDS[shape] || HANDS.relaxed, p = {}, s = side === 'right' ? -1 : 1;
  FINGERS.forEach((f, i) => PHAL.forEach((ph, k) => {
    p[`${side}${f}${ph}`] = f === 'Thumb' ? (k ? [0, s * c[i] * 0.7, 0] : [-0.5 * c[i], s * c[i] * 0.6, s * c[i] * 0.6]) : [0, 0, s * c[i] * (k === 0 ? 1.25 : k === 1 ? 1.35 : 0.9)];
  }));
  return p;
}
const ARM = { // right-arm poses, reused
  down: { rightUpperArm: [0, 0, -1.3], rightLowerArm: [0, -0.25, 0] },
  wave: { rightUpperArm: [0, 0.9, -0.62], rightLowerArm: [0, 0.05, 1.5], rightHand: [0, 0.3, 0] },
  point: { rightUpperArm: [0, 0.95, -0.42], rightLowerArm: [0, 0.1, 0.1], rightHand: [0, 0, 0] },
  pointUp: { rightUpperArm: [0, 0.75, -0.55], rightLowerArm: [0, 0.05, 1.75], rightHand: [0, 0.2, 0] },
  pointDown: { rightUpperArm: [0, 0.65, -0.95], rightLowerArm: [0, 0.15, 0.1], rightHand: [0, 0, -0.2] },
  present: { rightUpperArm: [0, 0.55, -0.72], rightLowerArm: [0, 0.35, 0.35], rightHand: [-0.9, 0, 0] },
  heart: { rightUpperArm: [0, 0.9, -0.62], rightLowerArm: [0, 1.4, 0] },
  chin: { rightUpperArm: [0, 1.5, -0.62], rightLowerArm: [0, 1.8, 1.0], rightHand: [0, 0, -0.2] },
  thumb: { rightUpperArm: [0.6, 1.2, -1.05], rightLowerArm: [0, 0.3, 1.45], rightHand: [0, 0, 0] },
  stop: { rightUpperArm: [0, 1.15, -0.55], rightLowerArm: [0, 0.2, 1.15], rightHand: [0, 0.3, 0.45] },
  open: { rightUpperArm: [0, 0.45, -0.75], rightLowerArm: [0, 0.2, 0.35], rightHand: [-1.1, 0, 0] },
  shrug: { rightUpperArm: [0, 0.45, -1.15], rightLowerArm: [0, 0.9, 0.6], rightHand: [-1.2, 0, 0], rightShoulder: [0, 0, 0.18] },
  up: { rightUpperArm: [0, 0.25, 0.85], rightLowerArm: [0, 0, 0.35], rightHand: [0, 0, 0] },
  front: { rightUpperArm: [0, 1.0, -0.95], rightLowerArm: [0, 0.9, 0.55], rightHand: [-0.5, 0, 0] },
  hip: { rightUpperArm: [0, -0.25, -0.95], rightLowerArm: [0, -1.4, 0], rightHand: [0, 0, 0] },
  salute: { rightUpperArm: [0.9, 1.4, -1.1], rightLowerArm: [0, 0, 2.2], rightHand: [0, 0, -0.3] },
  face: { rightUpperArm: [0, 1.5, -0.5], rightLowerArm: [0, 1.95, 1.15], rightHand: [0, 0, -0.3] },
};
/** The same pose for the other side: left ↔ right, y and z flipped (x, and $hips y / $look y, stay). */
function mirrorPose(p) {
  const o = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === '$look') o[k] = [-v[0], v[1]];
    else if (k === '$hips') o[k] = [-v[0], v[1]];
    else if (k.startsWith('$')) o[k] = v;
    else o[k.replace(/^left/, '#').replace(/^right/, 'left').replace(/^#/, 'right')] = [v[0], -v[1], -v[2]];
  }
  return o;
}
const bothSides = p => ({ ...p, ...mirrorPose(Object.fromEntries(Object.entries(p).filter(([k]) => k.startsWith('right')))) });
const pose = (...parts) => Object.assign({}, ...parts);

/* The library. keys: [[time, pose], …] (0 and len are the rest pose); osc: [bone, axis (0 x, 1 y, 2 z), amplitude, Hz, from, to, phase]. */
const MOTIONS = {
  // ---------- Greetings ----------
  Wave: { group: 'Greet', name: 'Wave hello', len: 2.8, keys: [[0.55, pose(ARM.wave, handPose('open'), { spine: [0, -0.06, 0.03], head: [0, 0, 0.08] })], [2.2, pose(ARM.wave, handPose('open'), { spine: [0, -0.06, 0.03], head: [0, 0, 0.08] })]],
    osc: [['rightLowerArm', 2, 0.14, 2.2, 0.55, 2.25, 0], ['rightHand', 1, 0.38, 2.2, 0.55, 2.25, -0.9], ['rightUpperArm', 1, 0.05, 2.2, 0.55, 2.25, 0.4]], face: { happy: 0.75 } },
  WaveBoth: { group: 'Greet', name: 'Wave with both hands', len: 2.8, zoom: 1.12, keys: [[0.55, bothSides(pose(ARM.wave, handPose('open')))], [2.2, bothSides(pose(ARM.wave, handPose('open')))]],
    osc: [['rightLowerArm', 2, 0.14, 2.2, 0.55, 2.25, 0], ['leftLowerArm', 2, 0.14, 2.2, 0.55, 2.25, 0], ['rightHand', 1, 0.36, 2.2, 0.55, 2.25, -0.9], ['leftHand', 1, 0.36, 2.2, 0.55, 2.25, -0.9]], face: { happy: 0.9 } },
  Hello: { group: 'Greet', name: 'Small hand raise', len: 1.6, keys: [[0.45, pose(ARM.wave, handPose('open'), { rightUpperArm: [0, 1.1, -0.8] })], [1.1, pose(ARM.wave, handPose('open'), { rightUpperArm: [0, 1.1, -0.8] })]], face: { happy: 0.6 } },
  Goodbye: { group: 'Greet', name: 'Wave goodbye with a bow', len: 3.2, keys: [[0.5, pose(ARM.wave, handPose('open'))], [1.9, pose(ARM.wave, handPose('open'))], [2.5, { spine: [-0.18, 0, 0], chest: [-0.12, 0, 0], head: [-0.22, 0, 0] }]],
    osc: [['rightLowerArm', 2, 0.14, 2, 0.5, 1.9, 0], ['rightHand', 1, 0.36, 2, 0.5, 1.9, -0.9]], face: { happy: 0.7 } },
  Bow: { group: 'Greet', name: 'Bow', len: 2.2, keys: [[0.8, { spine: [-0.25, 0, 0], chest: [-0.18, 0, 0], neck: [-0.1, 0, 0], head: [-0.2, 0, 0], ...bothSides(ARM.down), $look: [0, -0.6] }], [1.3, { spine: [-0.25, 0, 0], chest: [-0.18, 0, 0], neck: [-0.1, 0, 0], head: [-0.2, 0, 0], ...bothSides(ARM.down), $look: [0, -0.6] }]], face: { relaxed: 0.6 } },
  Welcome: { group: 'Greet', name: 'Welcome, arms open', len: 2.6, zoom: 1.15, keys: [[0.7, pose(bothSides(pose(ARM.open, handPose('open'))), { chest: [0.06, 0, 0], head: [0.06, 0, 0] })], [1.9, pose(bothSides(pose(ARM.open, handPose('open'))), { chest: [0.06, 0, 0], head: [0.06, 0, 0] })]], face: { happy: 0.85 } },
  HandOnHeart: { group: 'Greet', name: 'Hand on heart (thank you)', len: 2.4, keys: [[0.6, pose(mirrorPose(ARM.heart), handPose('open', 'left'), { head: [-0.12, 0, -0.1], spine: [-0.06, 0, 0] })], [1.8, pose(mirrorPose(ARM.heart), handPose('open', 'left'), { head: [-0.12, 0, -0.1], spine: [-0.06, 0, 0] })]], face: { relaxed: 0.7, happy: 0.4 } },
  // ---------- Presenting: pointing and showing (Left = the left of the screen) ----------
  PointLeft: { group: 'Present', name: 'Point to the left of the screen', len: 2.4, zoom: 1.25, keys: [[0.5, pose(ARM.point, handPose('point'), { spine: [0, -0.18, 0], chest: [0, -0.1, 0], $look: [-0.9, 0] })], [1.8, pose(ARM.point, handPose('point'), { spine: [0, -0.18, 0], chest: [0, -0.1, 0], $look: [-0.9, 0] })]], face: { happy: 0.3 } },
  PointUpLeft: { group: 'Present', name: 'Point up and to the left', len: 2.4, zoom: 1.2, keys: [[0.55, pose(ARM.pointUp, handPose('point'), { spine: [0, -0.12, 0], $look: [-0.7, 0.7] })], [1.8, pose(ARM.pointUp, handPose('point'), { spine: [0, -0.12, 0], $look: [-0.7, 0.7] })]] },
  PointDownLeft: { group: 'Present', name: 'Point down and to the left', len: 2.4, zoom: 1.15, keys: [[0.5, pose(ARM.pointDown, handPose('point'), { spine: [-0.06, -0.15, 0], head: [-0.15, 0, 0], $look: [-0.7, -0.7] })], [1.8, pose(ARM.pointDown, handPose('point'), { spine: [-0.06, -0.15, 0], head: [-0.15, 0, 0], $look: [-0.7, -0.7] })]] },
  PresentLeft: { group: 'Present', name: 'Show what’s on the left (open palm)', len: 2.8, zoom: 1.15, keys: [[0.4, pose(ARM.front, handPose('soft'))], [0.9, pose(ARM.present, handPose('open'), { spine: [0, -0.2, 0], head: [0, 0, 0.05], $look: [-0.8, 0] })], [2.1, pose(ARM.present, handPose('open'), { spine: [0, -0.2, 0], head: [0, 0, 0.05], $look: [-0.8, 0] })]], face: { happy: 0.45 } },
  PresentBoth: { group: 'Present', name: 'Show everything (both palms open)', len: 2.6, zoom: 1.15, keys: [[0.7, bothSides(pose(ARM.present, handPose('open')))], [1.9, bothSides(pose(ARM.present, handPose('open')))]], face: { happy: 0.5 } },
  LookLeft: { group: 'Present', name: 'Look to the left of the screen', len: 2, keys: [[0.5, { spine: [0, -0.12, 0], $look: [-1, 0] }], [1.5, { spine: [0, -0.12, 0], $look: [-1, 0] }]] },
  LookAtYou: { group: 'Present', name: 'Look at the audience', len: 1.6, keys: [[0.4, { chest: [0.04, 0, 0], $look: [0, 0] }], [1.2, { chest: [0.04, 0, 0], $look: [0, 0] }]], face: { happy: 0.3 } },
  Explain: { group: 'Present', name: 'Explain (hands moving in front)', len: 3.2, keys: [[0.5, bothSides(pose(ARM.front, handPose('soft')))], [2.7, bothSides(pose(ARM.front, handPose('soft')))]],
    osc: [['rightLowerArm', 2, 0.18, 1.3, 0.5, 2.7, 0], ['leftLowerArm', 2, 0.18, 1.3, 0.5, 2.7, Math.PI], ['rightHand', 0, 0.25, 1.3, 0.5, 2.7, 0.5], ['leftHand', 0, 0.25, 1.3, 0.5, 2.7, 3.6], ['head', 0, 0.05, 2.6, 0.5, 2.7, 0]] },
  Emphasize: { group: 'Present', name: 'Emphasize (a firm beat)', len: 1.6, keys: [[0.35, pose(ARM.front, handPose('fist'), { rightLowerArm: [0, 0.9, 0.95] })], [0.6, pose(ARM.front, handPose('fist'), { rightLowerArm: [0, 0.9, 0.35], head: [-0.12, 0, 0] })], [1.1, pose(ARM.front, handPose('fist'), { rightLowerArm: [0, 0.9, 0.5] })]], face: { angry: 0.2 } },
  CountOne: { group: 'Present', name: 'Number one (index up)', len: 2, keys: [[0.45, pose(ARM.pointUp, handPose('point'), { rightUpperArm: [0, 0.95, -0.85] })], [1.5, pose(ARM.pointUp, handPose('point'), { rightUpperArm: [0, 0.95, -0.85] })]] },
  CountTwo: { group: 'Present', name: 'Number two (victory)', len: 2, keys: [[0.45, pose(ARM.pointUp, handPose('victory'), { rightUpperArm: [0, 0.95, -0.85] })], [1.5, pose(ARM.pointUp, handPose('victory'), { rightUpperArm: [0, 0.95, -0.85] })]], face: { happy: 0.5 } },
  // ---------- Reactions ----------
  Nod: { group: 'React', name: 'Nod (yes)', len: 1.4, osc: [['head', 0, 0.2, 2.6, 0.1, 1.3, 0], ['neck', 0, 0.06, 2.6, 0.1, 1.3, 0]], face: { happy: 0.4 } },
  ShakeHead: { group: 'React', name: 'Shake head (no)', len: 1.5, osc: [['head', 1, 0.3, 2.8, 0.1, 1.4, 0], ['neck', 1, 0.08, 2.8, 0.1, 1.4, 0]], face: { sad: 0.45 } },
  ThumbsUp: { group: 'React', name: 'Thumbs up', len: 2.2, keys: [[0.5, pose(ARM.thumb, handPose('thumbsUp'), { head: [0, 0, 0.08] })], [1.6, pose(ARM.thumb, handPose('thumbsUp'), { head: [0, 0, 0.08] })]], face: { happy: 0.85 } },
  Clap: { group: 'React', name: 'Clap', len: 2.6, keys: [[0.5, bothSides(pose(ARM.front, handPose('open'), { rightLowerArm: [0, 1.05, 0.55] }))], [2.1, bothSides(pose(ARM.front, handPose('open'), { rightLowerArm: [0, 1.05, 0.55] }))]],
    osc: [['rightLowerArm', 1, 0.2, 3.2, 0.5, 2.1, 0], ['leftLowerArm', 1, 0.2, 3.2, 0.5, 2.1, Math.PI]], face: { happy: 0.9 } },
  Celebrate: { group: 'React', name: 'Celebrate (arms up)', len: 2.4, zoom: 1.45, keys: [[0.5, pose(bothSides(pose(ARM.up, handPose('fist'))), { chest: [0.1, 0, 0], head: [0.12, 0, 0] })], [1.8, pose(bothSides(pose(ARM.up, handPose('fist'))), { chest: [0.1, 0, 0], head: [0.12, 0, 0] })]],
    osc: [['rightUpperArm', 2, 0.1, 2.4, 0.5, 1.8, 0], ['leftUpperArm', 2, 0.1, 2.4, 0.5, 1.8, Math.PI], ['$hips', 1, 0.03, 2.4, 0.5, 1.8, 0]], face: { happy: 1 } },
  Laugh: { group: 'React', name: 'Laugh', len: 2.2, keys: [[0.3, { chest: [0.08, 0, 0], head: [0.15, 0, 0.06] }], [1.8, { chest: [0.05, 0, 0], head: [0.1, 0, 0.06] }]],
    osc: [['rightShoulder', 2, 0.06, 6, 0.3, 1.9, 0], ['leftShoulder', 2, -0.06, 6, 0.3, 1.9, 0], ['chest', 0, 0.03, 6, 0.3, 1.9, 0]], face: { happy: 1 }, mouth: { aa: 0.5 } },
  Surprised: { group: 'React', name: 'Surprised', len: 1.8, keys: [[0.25, pose(bothSides(pose(ARM.front, handPose('open'), { rightUpperArm: [0, 0.6, -0.85], rightLowerArm: [0, 0.6, 1.1] })), { chest: [0.12, 0, 0], head: [0.1, 0, 0], $hips: [0, 0.01] })], [1.1, pose(bothSides(pose(ARM.front, handPose('open'), { rightUpperArm: [0, 0.6, -0.85], rightLowerArm: [0, 0.6, 1.1] })), { chest: [0.12, 0, 0], head: [0.1, 0, 0] })]], face: { Surprised: 0.9, surprised: 0.9 }, mouth: { oh: 0.7 } },
  Sad: { group: 'React', name: 'Sad', len: 2.4, keys: [[0.7, { chest: [-0.12, 0, 0], head: [-0.25, 0, 0.05], rightShoulder: [0, 0, -0.08], leftShoulder: [0, 0, 0.08], $look: [0, -0.5] }], [1.8, { chest: [-0.12, 0, 0], head: [-0.25, 0, 0.05], rightShoulder: [0, 0, -0.08], leftShoulder: [0, 0, 0.08], $look: [0, -0.5] }]], face: { sad: 0.9 } },
  Shrug: { group: 'React', name: 'Shrug (I don’t know)', len: 2, keys: [[0.5, pose(bothSides(pose(ARM.shrug, handPose('open'))), { head: [0, 0, 0.14] })], [1.3, pose(bothSides(pose(ARM.shrug, handPose('open'))), { head: [0, 0, 0.14] })]], face: { relaxed: 0.5 } },
  Think: { group: 'React', name: 'Think (hand to chin)', len: 3, keys: [[0.7, pose(ARM.chin, handPose('soft'), mirrorPose(ARM.hip), { head: [-0.05, 0, 0.12], $look: [0.4, 0.5] })], [2.4, pose(ARM.chin, handPose('soft'), mirrorPose(ARM.hip), { head: [-0.05, 0, 0.12], $look: [0.4, 0.5] })]] },
  Facepalm: { group: 'React', name: 'Facepalm', len: 2.4, keys: [[0.6, pose(ARM.face, handPose('open'), { head: [-0.2, 0, 0], chest: [-0.06, 0, 0] })], [1.8, pose(ARM.face, handPose('open'), { head: [-0.2, 0, 0], chest: [-0.06, 0, 0] })]], face: { sad: 0.4 } },
  Listen: { group: 'React', name: 'Listen (head tilted)', len: 2.4, keys: [[0.6, { head: [-0.05, 0, 0.16], chest: [-0.05, 0, 0] }], [1.8, { head: [-0.05, 0, 0.16], chest: [-0.05, 0, 0] }]], face: { relaxed: 0.4 } },
  Stop: { group: 'React', name: 'Stop (palm forward)', len: 2, keys: [[0.4, pose(ARM.stop, handPose('open'))], [1.4, pose(ARM.stop, handPose('open'))]] },
  ComeHere: { group: 'React', name: 'Come here (beckon)', len: 2.4, keys: [[0.5, pose(ARM.front, handPose('soft'), { rightHand: [-1.1, 0, 0] })], [1.9, pose(ARM.front, handPose('soft'), { rightHand: [-1.1, 0, 0] })]],
    osc: [['rightIndexProximal', 2, 0.5, 2, 0.5, 1.9, 0], ['rightMiddleProximal', 2, 0.5, 2, 0.5, 1.9, 0.3], ['rightLowerArm', 2, 0.15, 2, 0.5, 1.9, 0]], face: { happy: 0.5 } },
  Salute: { group: 'React', name: 'Salute', len: 2, keys: [[0.4, pose(ARM.salute, handPose('open'))], [1.4, pose(ARM.salute, handPose('open'))]] },
  // ---------- Body ----------
  StepLeft: { group: 'Body', name: 'Step to the left', len: 1.8, keys: [[0.6, { $hips: [-0.06, 0], hips: [0, 0, 0.03], rightUpperLeg: [0, 0, -0.12], leftUpperLeg: [0, 0, -0.03], spine: [0, 0, -0.03] }], [1.2, { $hips: [-0.06, 0], hips: [0, 0, 0.03], rightUpperLeg: [0, 0, -0.12], leftUpperLeg: [0, 0, -0.03], spine: [0, 0, -0.03] }]] },
  LeanIn: { group: 'Body', name: 'Lean in (confiding)', len: 2.2, keys: [[0.6, { spine: [-0.1, 0, 0], chest: [-0.08, 0, 0], head: [0.08, 0, 0] }], [1.6, { spine: [-0.1, 0, 0], chest: [-0.08, 0, 0], head: [0.08, 0, 0] }]], face: { happy: 0.3 } },
  HandsOnHips: { group: 'Body', name: 'Hands on hips', len: 2.4, keys: [[0.6, bothSides(ARM.hip)], [1.8, bothSides(ARM.hip)]], face: { happy: 0.4 } },
  Jump: { group: 'Body', name: 'Jump', len: 1.1, zoom: 1.2, keys: [[0.25, { $hips: [0, -0.04], spine: [-0.08, 0, 0], ...bothSides({ rightUpperArm: [0, -0.3, -1.1] }) }], [0.55, { $hips: [0, 0.1], ...bothSides({ rightUpperArm: [0, 0.3, -0.8] }) }], [0.85, { $hips: [0, -0.02] }]], face: { happy: 0.8 } },
  Dance: { group: 'Body', name: 'Dance', len: 3.6, zoom: 1.2, keys: [[0.5, bothSides(pose(ARM.front, handPose('fist'), { rightLowerArm: [0, 0.6, 1.0] }))], [3.1, bothSides(pose(ARM.front, handPose('fist'), { rightLowerArm: [0, 0.6, 1.0] }))]],
    osc: [['hips', 1, 0.22, 1.6, 0.4, 3.2, 0], ['$hips', 1, 0.025, 3.2, 0.4, 3.2, 0], ['head', 2, 0.12, 1.6, 0.4, 3.2, 0.6], ['rightUpperArm', 2, 0.2, 1.6, 0.4, 3.2, 0], ['leftUpperArm', 2, 0.2, 1.6, 0.4, 3.2, 0], ['spine', 2, 0.06, 1.6, 0.4, 3.2, Math.PI]], face: { happy: 0.95 } },
};
// The mirrored motions: …Right from …Left (and the other way).
for (const [k, m] of Object.entries({ ...MOTIONS })) {
  if (!/Left$/.test(k)) continue;
  const n = k.replace(/Left$/, 'Right');
  MOTIONS[n] = { ...m, name: m.name.replace(/left/g, 'right'), keys: (m.keys || []).map(([t, p]) => [t, mirrorPose(p)]),
    osc: (m.osc || []).map(([b, ...r]) => [b.replace(/^right/, '#').replace(/^left/, 'right').replace(/^#/, 'left'), ...r]) };
}
// Older gesture names (scripts, voice): keep working.
const MOTION_ALIAS = { Yes: 'Nod', No: 'ShakeHead', Thumbsup: 'ThumbsUp', Point: 'PointLeft', Present: 'PresentLeft', Thanks: 'HandOnHeart', Hi: 'Hello', Bye: 'Goodbye' };
const motionName = n => { const k = String(n || '').trim(); if (MOTIONS[k]) return k; const f = Object.keys(MOTIONS).find(x => x.toLowerCase() === k.toLowerCase().replace(/[\s_-]+/g, '')); return f || MOTION_ALIAS[k] || MOTION_ALIAS[k.charAt(0).toUpperCase() + k.slice(1).toLowerCase()] || null; };

/** One motion playing at time t (seconds): { channel: { v: value, w: weight } }. Each channel eases in from the idle body
    before its first key and back after its last; between keys it follows a Catmull-Rom spline (no corners, no stops). */
function motionAt(m, t) {
  const out = {}, keys = m.keys || [], names = new Set(keys.flatMap(([, p]) => Object.keys(p)));
  for (const n of names) {
    const have = keys.filter(([, p]) => p[n]).map(([tk, p]) => [tk, p[n]]);
    const first = have[0][0], last = have.at(-1)[0];
    if (t <= first) out[n] = { v: have[0][1], w: smoothstep(t / Math.max(0.01, first)) };
    else if (t >= last) out[n] = { v: have.at(-1)[1], w: 1 - smoothstep((t - last) / Math.max(0.01, m.len - last)) };
    else {
      const i = Math.max(0, have.findIndex(([tk]) => tk > t) - 1), at = j => have[Math.min(have.length - 1, Math.max(0, j))];
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)], u = (t - p1[0]) / Math.max(0.001, p2[0] - p1[0]);
      out[n] = { v: p1[1].map((_, c) => catmull(p0[1][c], p1[1][c], p2[1][c], p3[1][c], u)), w: 1 };
    }
  }
  return out;
}
const smoothstep = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const catmull = (a, b, c, d, u) => 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
/** Oscillations at time t: { bone: [dx, dy, dz] }, swelling in and out over their span. */
function motionOsc(m, t) {
  const out = {};
  for (const [b, axis, amp, hz, from, to, ph = 0] of m.osc || []) {
    if (t < from || t > to) continue;
    const k = (t - from) / Math.max(0.01, to - from), env = Math.sin(Math.min(1, k) * Math.PI) ** 0.5;
    const d = out[b] ||= [0, 0, 0]; d[axis] += Math.sin((t - from) * hz * Math.PI * 2 + ph) * amp * env;
  }
  return out;
}

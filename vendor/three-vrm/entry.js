// DriveDeck avatar bundle: three.js (the parts the avatar uses), its glTF loader and pixiv's three-vrm.
export { WebGLRenderer, Scene, PerspectiveCamera, DirectionalLight, AmbientLight, HemisphereLight, Clock, Vector3, Object3D, SRGBColorSpace, MathUtils } from 'three';
export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export { VRMLoaderPlugin, VRMUtils, VRMExpressionPresetName, VRMHumanBoneName } from '@pixiv/three-vrm';

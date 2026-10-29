import '@tanstack/react-start/client-only';
import { createPortal, useFrame } from '@react-three/fiber';
import { Array as Arr } from 'effect';
import { type RefObject, useMemo, useRef } from 'react';
import { type Group, type Object3D, PerspectiveCamera, Scene } from 'three';

import { MarkerModel } from './marker-model.tsx';
import { type ViewmodelState, viewmodelPose } from './marker-motion.ts';
import { allWeaponIds, viewFov, type WeaponId } from './tuning.ts';

// The first-person marker lives in its own scene, drawn after the world over
// a cleared depth buffer: walls can never cover it, and it never shades or
// occludes the world. Its camera stays at the origin, so the marker's pose is
// in view space and nothing here reads or writes the world camera's aim.
export const Viewmodel = ({
  state,
  color,
}: {
  readonly state: RefObject<ViewmodelState>;
  readonly color: string;
}) => {
  const scene = useMemo(() => new Scene(), []);
  const lens = useRef<PerspectiveCamera>(null);
  const marker = useRef<Group>(null);
  const models = useRef(new Map<WeaponId, Object3D>());

  // A positive priority takes over rendering, so this draws the world too.
  useFrame(({ gl, scene: world, camera: eye, size }) => {
    const camera = lens.current;
    const group = marker.current;
    gl.render(world, eye);
    if (!camera || !group) return;
    const aspect = size.width / size.height;
    // Follows the world camera's zoom, so the muzzle stays where it is drawn.
    const fov = eye instanceof PerspectiveCamera ? eye.fov : viewFov;
    if (camera.aspect !== aspect || camera.fov !== fov) {
      camera.aspect = aspect;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    const current = state.current;
    const { position, rotation } = viewmodelPose(current);
    group.visible = current.shown;
    group.position.set(...position);
    group.rotation.set(...rotation);
    for (const [weapon, model] of models.current) {
      model.visible = weapon === current.weapon;
    }
    const { autoClear } = gl;
    gl.autoClear = false;
    gl.clearDepth();
    gl.render(scene, camera);
    gl.autoClear = autoClear;
  }, 1);

  return createPortal(
    <>
      <perspectiveCamera ref={lens} fov={viewFov} near={0.01} far={10} />
      <hemisphereLight args={['#dfefff', '#8a7f6a', 1.1]} />
      <directionalLight position={[0.5, 1, 0.4]} intensity={1.6} />
      <group ref={marker}>
        {Arr.map(allWeaponIds, (weapon) => (
          <group
            key={weapon}
            ref={(model) => {
              if (model) models.current.set(weapon, model);
              return () => {
                models.current.delete(weapon);
              };
            }}
          >
            <MarkerModel weapon={weapon} color={color} />
          </group>
        ))}
      </group>
    </>,
    scene,
  );
};

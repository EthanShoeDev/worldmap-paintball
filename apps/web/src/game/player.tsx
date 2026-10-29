import '@tanstack/react-start/client-only';
import { useAtomSet } from '@effect/atom-react';
import { useFrame } from '@react-three/fiber';
import {
  CapsuleCollider,
  type RapierRigidBody,
  RigidBody,
  useRapier,
} from '@react-three/rapier';
import { useRef } from 'react';
import { PerspectiveCamera, Vector3 } from 'three';

import { characterGroups, stepCharacter, toVec3 } from './character.ts';
import { combatViewAtom } from './hud-atoms.ts';
import { useInput } from './input.ts';
import {
  combatViewOf,
  lookScale,
  makeLoadout,
  respawnLoadout,
  sameCombatView,
  stepLoadout,
  zoomFovOf,
} from './loadout.ts';
import { idleViewmodel, stepViewmodel, viewMuzzle } from './marker-motion.ts';
import type { LocalControls } from './net/net-game.ts';
import type { Vec3 } from './net/protocol.ts';
import {
  bodyHalfHeight,
  bodyRadius,
  eyeOffset,
  loadoutTuning,
  viewFov,
  type WeaponId,
} from './tuning.ts';
import { Viewmodel } from './viewmodel.tsx';

const forward = new Vector3();

export const Player = ({
  spawn,
  local,
  color,
  onFire,
}: {
  readonly spawn: Vec3;
  // Set in a match, where the host decides when this player is out.
  readonly local: LocalControls | undefined;
  readonly color: string;
  readonly onFire: (
    eye: Vec3,
    dir: Vec3,
    muzzle: Vec3,
    weapon: WeaponId,
  ) => void;
}) => {
  const body = useRef<RapierRigidBody>(null);
  const view = useRef({ yaw: 0, pitch: 0 });
  const viewmodel = useRef(idleViewmodel);
  const loadout = useRef(makeLoadout());
  const combat = useRef(combatViewOf(makeLoadout(), false));
  const setCombat = useAtomSet(combatViewAtom);
  const readInput = useInput();
  const physics = useRapier();

  useFrame(({ camera }, dt) => {
    const rigidBody = body.current;
    if (!rigidBody) return;
    const respawn = local?.takeRespawn();
    if (respawn) {
      const [x, y, z] = respawn;
      rigidBody.setTranslation({ x, y, z }, true);
      rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      loadout.current = respawnLoadout(loadout.current);
    }
    const alive = local?.alive() ?? true;
    const input = readInput(dt);
    const zoomFov = alive ? zoomFovOf(loadout.current, input.zoom) : undefined;
    let fov = viewFov;
    if (camera instanceof PerspectiveCamera) {
      const target = zoomFov ?? viewFov;
      const eased =
        camera.fov +
        (target - camera.fov) * Math.min(1, loadoutTuning.zoomResponse * dt);
      fov = Math.abs(target - eased) < 0.05 ? target : eased;
      if (camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    }
    const scale = lookScale(fov);
    const intent = {
      ...input,
      look: [input.look[0] * scale, input.look[1] * scale] as const,
    };
    const position = rigidBody.translation();
    stepCharacter({
      body: rigidBody,
      physics,
      view: view.current,
      intent,
      alive,
    });
    const step = stepLoadout(
      loadout.current,
      { ...intent, fire: alive && intent.fire },
      dt,
    );
    loadout.current = step.loadout;
    const { yaw, pitch } = view.current;
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.position.set(position.x, position.y + eyeOffset, position.z);
    const { x: vx, z: vz } = rigidBody.linvel();
    const zoomed = zoomFov !== undefined;
    viewmodel.current = stepViewmodel(viewmodel.current, {
      shown: alive && !zoomed,
      fired: step.fired,
      speed: Math.hypot(vx, vz),
      loadout: step.loadout,
      dt,
    });
    const { weapon } = step.loadout;
    if (step.fired) {
      camera.updateMatrixWorld();
      const eye = toVec3(camera.position);
      // The muzzle as this frame draws it, so the ball leaves the barrel;
      // through a scope, the ball leaves along the line of sight.
      onFire(
        eye,
        toVec3(camera.getWorldDirection(forward)),
        zoomed ? eye : viewMuzzle(eye, yaw, pitch, viewmodel.current),
        weapon,
      );
    }
    const shown = combatViewOf(step.loadout, zoomed);
    if (!sameCombatView(shown, combat.current)) {
      combat.current = shown;
      setCombat(shown);
    }
    local?.report({
      position: toVec3(rigidBody.translation()),
      velocity: toVec3(rigidBody.linvel()),
      yaw,
      pitch,
      firing: alive && intent.fire,
      weapon,
    });
  });

  return (
    <>
      <RigidBody
        ref={body}
        colliders={false}
        enabledRotations={[false, false, false]}
        position={[...spawn]}
        friction={0}
        linearDamping={0}
        collisionGroups={characterGroups}
        ccd
      >
        <CapsuleCollider args={[bodyHalfHeight, bodyRadius]} />
      </RigidBody>
      <Viewmodel state={viewmodel} color={color} />
    </>
  );
};

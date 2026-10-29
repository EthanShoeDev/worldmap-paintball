import '@tanstack/react-start/client-only';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CapsuleCollider,
  type RapierRigidBody,
  RigidBody,
  useRapier,
} from '@react-three/rapier';
import { useRef } from 'react';
import { Vector3 } from 'three';

import { characterGroups, stepCharacter, toVec3 } from './character.ts';
import { useInput } from './input.ts';
import type { LocalControls } from './net/net-game.ts';
import type { Vec3 } from './net/protocol.ts';
import { bodyHalfHeight, bodyRadius, eyeOffset } from './tuning.ts';

const forward = new Vector3();

export const Player = ({
  spawn,
  local,
  onFire,
}: {
  readonly spawn: Vec3;
  // Set in a match, where the host decides when this player is out.
  readonly local: LocalControls | undefined;
  readonly onFire: (origin: Vec3, dir: Vec3) => void;
}) => {
  const body = useRef<RapierRigidBody>(null);
  const view = useRef({ yaw: 0, pitch: 0, cooldown: 0 });
  const readInput = useInput();
  const physics = useRapier();
  const camera = useThree((state) => state.camera);

  useFrame((_, dt) => {
    const rigidBody = body.current;
    if (!rigidBody) return;
    const respawn = local?.takeRespawn();
    if (respawn) {
      const [x, y, z] = respawn;
      rigidBody.setTranslation({ x, y, z }, true);
      rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    const alive = local?.alive() ?? true;
    const intent = readInput(dt);
    const position = rigidBody.translation();
    const fires = stepCharacter({
      body: rigidBody,
      physics,
      view: view.current,
      intent,
      alive,
      dt,
    });
    const { yaw, pitch } = view.current;
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.position.set(position.x, position.y + eyeOffset, position.z);
    if (fires) {
      camera.updateMatrixWorld();
      onFire(
        toVec3(camera.position),
        toVec3(camera.getWorldDirection(forward)),
      );
    }
    local?.report({
      position: toVec3(rigidBody.translation()),
      velocity: toVec3(rigidBody.linvel()),
      yaw,
      pitch,
      firing: alive && intent.fire,
    });
  });

  return (
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
  );
};

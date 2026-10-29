import { useFrame, useThree } from '@react-three/fiber';
import {
  CapsuleCollider,
  type RapierRigidBody,
  RigidBody,
  useRapier,
} from '@react-three/rapier';
import { useRef } from 'react';
import { Vector3 } from 'three';

import { useInput } from './input.ts';
import type { Intent } from './intent.ts';
import type { LocalControls } from './net/net-game.ts';
import type { Vec3 } from './net/protocol.ts';
import {
  bodyHalfHeight,
  bodyRadius,
  eyeOffset,
  fireInterval,
} from './tuning.ts';

const walkSpeed = 4.5;
const sprintSpeed = 7.5;
const jumpSpeed = 5.5;
const maxPitch = Math.PI / 2 - 0.01;
const forward = new Vector3();

const toVec3 = ({ x, y, z }: { x: number; y: number; z: number }) =>
  [x, y, z] as const;

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
  const { world, rapier } = useRapier();
  const camera = useThree((state) => state.camera);

  const move = (rigidBody: RapierRigidBody, intent: Intent, alive: boolean) => {
    const { yaw } = view.current;
    const speed = intent.sprint ? sprintSpeed : walkSpeed;
    const [strafe, ahead] = alive ? intent.move : [0, 0];
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const position = rigidBody.translation();
    const grounded =
      world.castRay(
        new rapier.Ray(position, { x: 0, y: -1, z: 0 }),
        bodyHalfHeight + bodyRadius + 0.1,
        true,
        undefined,
        undefined,
        undefined,
        rigidBody,
      ) !== null;
    rigidBody.setLinvel(
      {
        x: (strafe * cos - ahead * sin) * speed,
        y: alive && intent.jump && grounded ? jumpSpeed : rigidBody.linvel().y,
        z: (-strafe * sin - ahead * cos) * speed,
      },
      true,
    );
    camera.position.set(position.x, position.y + eyeOffset, position.z);
  };

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
    const state = view.current;
    state.yaw -= intent.look[0];
    state.pitch = Math.max(
      -maxPitch,
      Math.min(maxPitch, state.pitch - intent.look[1]),
    );
    camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ');
    move(rigidBody, intent, alive);
    state.cooldown = Math.max(0, state.cooldown - dt);
    const firing = alive && intent.fire;
    if (firing && state.cooldown === 0) {
      state.cooldown = fireInterval;
      camera.updateMatrixWorld();
      onFire(
        toVec3(camera.position),
        toVec3(camera.getWorldDirection(forward)),
      );
    }
    local?.report({
      position: toVec3(rigidBody.translation()),
      velocity: toVec3(rigidBody.linvel()),
      yaw: state.yaw,
      pitch: state.pitch,
      firing,
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
      ccd
    >
      <CapsuleCollider args={[bodyHalfHeight, bodyRadius]} />
    </RigidBody>
  );
};

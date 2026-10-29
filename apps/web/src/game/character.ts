import '@tanstack/react-start/client-only';
import {
  interactionGroups,
  type RapierRigidBody,
  type useRapier,
} from '@react-three/rapier';

import type { Intent } from './intent.ts';
import { bodyHalfHeight, bodyRadius, fireInterval } from './tuning.ts';

const walkSpeed = 4.5;
const sprintSpeed = 7.5;
const jumpSpeed = 5.5;
const maxPitch = Math.PI / 2 - 0.01;

const arenaGroup = 0;
const characterGroup = 1;

// Characters collide with the arena only: remote players have no bodies, so
// the bots the host simulates must not block the host's own player either.
export const characterGroups = interactionGroups(characterGroup, [arenaGroup]);
const groundRayGroups = interactionGroups(arenaGroup, [arenaGroup]);

export interface CharacterView {
  yaw: number;
  pitch: number;
  cooldown: number;
}

export const toVec3 = ({ x, y, z }: { x: number; y: number; z: number }) =>
  [x, y, z] as const;

// One frame of a capsule character, human or bot: look, move, jump and the
// fire cooldown. Returns whether it fires this frame.
export const stepCharacter = ({
  body,
  physics: { world, rapier },
  view,
  intent,
  alive,
  dt,
}: {
  readonly body: RapierRigidBody;
  readonly physics: ReturnType<typeof useRapier>;
  readonly view: CharacterView;
  readonly intent: Intent;
  readonly alive: boolean;
  readonly dt: number;
}) => {
  view.yaw -= intent.look[0];
  view.pitch = Math.max(
    -maxPitch,
    Math.min(maxPitch, view.pitch - intent.look[1]),
  );
  const speed = intent.sprint ? sprintSpeed : walkSpeed;
  const [strafe, ahead] = alive ? intent.move : [0, 0];
  const sin = Math.sin(view.yaw);
  const cos = Math.cos(view.yaw);
  const grounded =
    world.castRay(
      new rapier.Ray(body.translation(), { x: 0, y: -1, z: 0 }),
      bodyHalfHeight + bodyRadius + 0.1,
      true,
      undefined,
      groundRayGroups,
      undefined,
      body,
    ) !== null;
  body.setLinvel(
    {
      x: (strafe * cos - ahead * sin) * speed,
      y: alive && intent.jump && grounded ? jumpSpeed : body.linvel().y,
      z: (-strafe * sin - ahead * cos) * speed,
    },
    true,
  );
  view.cooldown = Math.max(0, view.cooldown - dt);
  const fires = alive && intent.fire && view.cooldown === 0;
  if (fires) view.cooldown = fireInterval;
  return fires;
};

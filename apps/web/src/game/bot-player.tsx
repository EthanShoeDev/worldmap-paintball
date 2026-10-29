import '@tanstack/react-start/client-only';
import { useFrame } from '@react-three/fiber';
import {
  CapsuleCollider,
  type RapierRigidBody,
  RigidBody,
  useRapier,
} from '@react-three/rapier';
import type { PlayerId } from '@worldmap-paintball/api-contract/lobby';
import { Array as Arr } from 'effect';
import { type RefObject, useRef } from 'react';
import type { Object3D } from 'three';

import {
  aimDirection,
  botMemory,
  eyeOf,
  inView,
  thinkBot,
} from './bot-brain.ts';
import type { RoadGraph } from './bot-nav.ts';
import { characterGroups, stepCharacter, toVec3 } from './character.ts';
import type { NetGame } from './net/net-game.ts';
import { clearLine, traceShot } from './shots.ts';
import { bodyHalfHeight, bodyRadius, botTuning } from './tuning.ts';

// A bot the host simulates: a body and a brain, but no mesh, because the host
// draws it through <RemotePlayers> from its own snapshots like anyone else.
export const BotPlayer = ({
  id,
  net,
  graph,
  arena,
  seed,
}: {
  readonly id: PlayerId;
  readonly net: NetGame['Service'];
  readonly graph: RoadGraph;
  readonly arena: RefObject<Object3D | null>;
  readonly seed: number;
}) => {
  const body = useRef<RapierRigidBody>(null);
  const view = useRef({ yaw: 0, pitch: 0, cooldown: 0 });
  const memory = useRef(botMemory(seed));
  // Line of sight is re-checked a few times a second, not every frame.
  const sight = useRef({ ids: new Set<PlayerId>(), in: 0 });
  const physics = useRapier();
  const controls = net.controls(id);

  useFrame((_, dt) => {
    const rigidBody = body.current;
    if (!rigidBody) return;
    const respawn = controls.takeRespawn();
    if (respawn) {
      const [x, y, z] = respawn;
      rigidBody.setTranslation({ x, y, z }, true);
      rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    const alive = controls.alive();
    const position = toVec3(rigidBody.translation());
    const velocity = toVec3(rigidBody.linvel());
    const eye = eyeOf(position);
    const targets = net.targets(id);
    const looking = view.current;
    sight.current.in -= dt;
    if (sight.current.in <= 0) {
      sight.current.in = botTuning.sightInterval;
      sight.current.ids = new Set(
        Arr.flatMap(targets, ([other, centre]) => {
          const target = eyeOf(centre);
          return alive &&
            inView(eye, looking.yaw, looking.pitch, target) &&
            clearLine(arena.current, eye, target)
            ? [other]
            : [];
        }),
      );
    }
    const visible = Arr.flatMap(targets, ([other, centre]) =>
      sight.current.ids.has(other) ? [{ id: other, eye: eyeOf(centre) }] : [],
    );
    const thought = thinkBot(
      memory.current,
      {
        position,
        velocity,
        yaw: looking.yaw,
        pitch: looking.pitch,
        alive,
        visible,
      },
      graph,
      dt,
    );
    memory.current = thought.memory;
    const fires = stepCharacter({
      body: rigidBody,
      physics,
      view: looking,
      intent: thought.intent,
      alive,
      dt,
    });
    if (fires) {
      const dir = aimDirection(looking.yaw, looking.pitch);
      net.fire(
        id,
        eye,
        dir,
        traceShot(arena.current, eye, dir, targets).player,
      );
    }
    controls.report({
      position,
      velocity,
      yaw: looking.yaw,
      pitch: looking.pitch,
      firing: thought.intent.fire,
    });
  });

  return (
    <RigidBody
      ref={body}
      colliders={false}
      enabledRotations={[false, false, false]}
      position={[...net.spawnOf(id)]}
      friction={0}
      linearDamping={0}
      collisionGroups={characterGroups}
      ccd
    >
      <CapsuleCollider args={[bodyHalfHeight, bodyRadius]} />
    </RigidBody>
  );
};

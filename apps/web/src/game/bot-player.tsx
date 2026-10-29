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
  rearmBot,
  thinkBot,
} from './bot-brain.ts';
import type { RoadGraph } from './bot-nav.ts';
import { characterGroups, stepCharacter, toVec3 } from './character.ts';
import { makeLoadout, stepLoadout } from './loadout.ts';
import { heldMuzzle } from './marker-motion.ts';
import { sub } from './net/hit-test.ts';
import { colorOf, type NetGame } from './net/net-game.ts';
import type { Vec3 } from './net/protocol.ts';
import type { Volley } from './paintballs.ts';
import { aimShot, clearLine } from './shots.ts';
import { bodyHalfHeight, bodyRadius, botTuning, weapons } from './tuning.ts';

// A bot the host simulates: a body and a brain, but no mesh, because the host
// draws it through <RemotePlayers> from its own snapshots like anyone else.
export const BotPlayer = ({
  id,
  net,
  graph,
  arena,
  seed,
  launch,
}: {
  readonly id: PlayerId;
  readonly net: NetGame['Service'];
  readonly graph: RoadGraph;
  readonly arena: RefObject<Object3D | null>;
  readonly seed: number;
  readonly launch: (volley: Volley) => void;
}) => {
  const body = useRef<RapierRigidBody>(null);
  const view = useRef({ yaw: 0, pitch: 0 });
  const first = botMemory(seed);
  const memory = useRef(first);
  const loadout = useRef(makeLoadout(first.weapon));
  // Line of sight is re-checked a few times a second, not every frame.
  const sight = useRef({ ids: new Set<PlayerId>(), in: 0 });
  // Where each target was last frame, to judge how fast it moves.
  const seenAt = useRef(new Map<PlayerId, Vec3>());
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
      memory.current = rearmBot(memory.current);
      loadout.current = makeLoadout(memory.current.weapon);
    }
    const alive = controls.alive();
    const held = loadout.current;
    const weapon = weapons[held.weapon];
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
    const last = seenAt.current;
    const visible = Arr.flatMap(targets, ([other, centre]) => {
      const before = last.get(other);
      const [dx, dy, dz] = before && dt > 0 ? sub(centre, before) : [0, 0, 0];
      return sight.current.ids.has(other)
        ? [
            {
              id: other,
              eye: eyeOf(centre),
              velocity: [dx / dt, dy / dt, dz / dt] as const,
            },
          ]
        : [];
    });
    seenAt.current = new Map(targets);
    const thought = thinkBot(
      memory.current,
      {
        position,
        velocity,
        yaw: looking.yaw,
        pitch: looking.pitch,
        alive,
        weapon,
        ammo: held.ammo[held.weapon],
        ready: held.swap === 0 && held.reload === 0,
        visible,
      },
      graph,
      dt,
    );
    memory.current = thought.memory;
    stepCharacter({
      body: rigidBody,
      physics,
      view: looking,
      intent: thought.intent,
      alive,
    });
    const { loadout: next, fired } = stepLoadout(
      held,
      { ...thought.intent, fire: alive && thought.intent.fire },
      dt,
    );
    loadout.current = next;
    if (fired) {
      const shot = aimShot(
        arena.current,
        weapon,
        eye,
        aimDirection(looking.yaw, looking.pitch),
        heldMuzzle(position, looking.yaw, looking.pitch, next.weapon),
        targets,
      );
      const volley = {
        ...shot,
        shooter: id,
        weapon: next.weapon,
        seed: memory.current.seed,
      };
      net.fire(volley);
      launch({
        ...volley,
        color: colorOf(net, id),
        onHit: (hit) => {
          net.hit({
            shooter: id,
            target: hit.target,
            point: hit.point,
            weapon: volley.weapon,
          });
        },
      });
    }
    controls.report({
      position,
      velocity,
      yaw: looking.yaw,
      pitch: looking.pitch,
      firing: thought.intent.fire,
      weapon: next.weapon,
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

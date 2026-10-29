import '@tanstack/react-start/client-only';
import { useAtomSet } from '@effect/atom-react';
import { useFrame } from '@react-three/fiber';
import {
  CapsuleCollider,
  type RapierRigidBody,
  RigidBody,
  useRapier,
} from '@react-three/rapier';
import type { MatchRules } from '@worldmap-paintball/api-contract/lobby';
import { Option } from 'effect';
import { useEffect, useRef } from 'react';
import { PerspectiveCamera, Vector3 } from 'three';

import { characterGroups, stepCharacter, toVec3 } from './character.ts';
import { combatViewAtom, powerUpViewAtom } from './hud-atoms.ts';
import { useInput } from './input.ts';
import {
  armLauncher,
  combatViewOf,
  disarmLauncher,
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
  activate,
  type ActivePowerUp,
  padUnder,
  type PowerUpLink,
  powerUpViewOf,
  samePowerUpView,
  tickPowerUp,
} from './powerups.ts';
import { moveListener, playFootstep, playPowerUp } from './sounds.ts';
import { type Escape, hasEscaped } from './terrain.ts';
import {
  bodyHalfHeight,
  bodyRadius,
  eyeOffset,
  loadoutTuning,
  type PowerUpKind,
  powerUpTuning,
  viewFov,
  type WeaponId,
} from './tuning.ts';
import { Viewmodel } from './viewmodel.tsx';

const forward = new Vector3();
// Metres between footsteps, walking and sprinting.
const stride = { walk: 1.6, sprint: 2.3 };

export const Player = ({
  spawn,
  escape,
  rules,
  local,
  powerUps,
  onPowerUp,
  color,
  onFire,
}: {
  readonly spawn: Vec3;
  // Falling out of the arena puts you back at `spawn`.
  readonly escape: Escape;
  readonly rules: MatchRules;
  // Set in a match, where the host decides when this player is out.
  readonly local: LocalControls | undefined;
  readonly powerUps: PowerUpLink;
  // Told of each change to this player's running power-up.
  readonly onPowerUp: (kind: PowerUpKind | undefined) => void;
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
  const setPowerUp = useAtomSet(powerUpViewAtom);
  const shownPower = useRef(powerUpViewOf(undefined));
  const power = useRef<ActivePowerUp | undefined>(undefined);
  useEffect(() => () => setPowerUp(undefined), [setPowerUp]);
  const readInput = useInput();
  const physics = useRapier();
  const walked = useRef(0);

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
    if (hasEscaped(escape, rigidBody.translation())) {
      const [x, y, z] = spawn;
      rigidBody.setTranslation({ x, y, z }, true);
      rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    const alive = local?.alive() ?? true;
    const granted = powerUps.take();
    if (granted) {
      power.current = activate(granted);
      playPowerUp();
      if (granted === 'launcher') {
        loadout.current = armLauncher(loadout.current);
      }
    }
    if (!alive) power.current = undefined;
    const active = power.current;
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
    const { grounded, thrusting } = stepCharacter({
      body: rigidBody,
      physics,
      view: view.current,
      intent,
      alive,
      rules:
        active?.kind === 'speed'
          ? { ...rules, moveSpeed: rules.moveSpeed * powerUpTuning.speed }
          : rules,
      jetpack:
        active?.kind === 'jetpack' && active.fuel > 0 ? { dt } : undefined,
    });
    const step = stepLoadout(
      loadout.current,
      { ...intent, fire: alive && intent.fire },
      dt,
    );
    loadout.current = step.loadout;
    const ticked = tickPowerUp(active, dt, { thrusting, grounded });
    // The launcher's power-up ends with its last round or its time.
    const spent =
      active?.kind === 'launcher' &&
      (ticked === undefined || step.loadout.ammo.launcher === 0);
    if (spent) loadout.current = disarmLauncher(step.loadout);
    power.current = spent ? undefined : ticked;
    const shownNow = powerUpViewOf(power.current);
    if (shownNow?.kind !== shownPower.current?.kind) onPowerUp(shownNow?.kind);
    if (!samePowerUpView(shownNow, shownPower.current)) {
      shownPower.current = shownNow;
      setPowerUp(shownNow);
    }
    if (alive) {
      const pad = padUnder(
        powerUps.pads,
        powerUps.ready(),
        toVec3(rigidBody.translation()),
      );
      if (Option.isSome(pad)) powerUps.grab(pad.value);
    }
    const { yaw, pitch } = view.current;
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.position.set(position.x, position.y + eyeOffset, position.z);
    const { x: vx, z: vz } = rigidBody.linvel();
    camera.updateMatrixWorld();
    moveListener(
      toVec3(camera.position),
      toVec3(camera.getWorldDirection(forward)),
    );
    const sprinting = intent.sprint;
    walked.current = grounded ? walked.current + Math.hypot(vx, vz) * dt : 0;
    if (walked.current >= (sprinting ? stride.sprint : stride.walk)) {
      walked.current = 0;
      playFootstep(sprinting);
    }
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

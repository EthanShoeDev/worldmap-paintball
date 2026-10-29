export type Vec2 = readonly [number, number];

// What the player wants this frame, independent of the device it came from.
// move: [strafe right, forward], each in [-1, 1] with length <= 1.
// look: [yaw right, pitch down] in radians for this frame.
export interface Intent {
  readonly move: Vec2;
  readonly look: Vec2;
  readonly jump: boolean;
  readonly sprint: boolean;
  readonly fire: boolean;
}

export const idleIntent: Intent = {
  move: [0, 0],
  look: [0, 0],
  jump: false,
  sprint: false,
  fire: false,
};

export const clampLength = ([x, y]: Vec2, max = 1): Vec2 => {
  const length = Math.hypot(x, y);
  return length > max ? [(x / length) * max, (y / length) * max] : [x, y];
};

export const mergeIntents = (a: Intent, b: Intent): Intent => ({
  move: clampLength([a.move[0] + b.move[0], a.move[1] + b.move[1]]),
  look: [a.look[0] + b.look[0], a.look[1] + b.look[1]],
  jump: a.jump || b.jump,
  sprint: a.sprint || b.sprint,
  fire: a.fire || b.fire,
});

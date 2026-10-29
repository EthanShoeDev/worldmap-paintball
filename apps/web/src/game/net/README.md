# Match netcode

This is casual peer-to-peer netcode on top of `PeerNetwork`, the WebRTC star
from `apps/web/src/lobby`. The host's browser is the authority on scores. Each
player's own movement is authoritative in that player's browser.

| File | Role |
| --- | --- |
| `protocol.ts` | Effect Schemas for `PlayerState`, `WorldSnapshot` and `NetEvent`, plus decoders that log and drop bad messages |
| `match.ts` | Pure host logic: roster, hit validation, the score reducer, respawns, snapshot assembly |
| `hit-test.ts` | Ray-vs-capsule intersection and nearest player hit |
| `interpolation.ts` | Converts between `WorldSnapshot` and `@geckos.io/snapshot-interpolation` entities |
| `net-game.ts` | `NetGame` service (network loops), `netGameAtom`, `matchViewAtom`, `endMatchAtom` |
| `session.ts` | Decides whether `/play` is a lobby match or solo practice |

## Model

- **Movement is client-side.** Each peer runs its own rapier capsule, so
  movement never waits on the network. Every 50 ms a client sends its
  `PlayerState` (position, velocity, yaw, pitch, firing) to the host on the
  unreliable `state` channel.
- **The host merges state into snapshots.** Every 50 ms the host combines its
  own state with the latest from each client, adds alive flags and scores, and
  broadcasts a `WorldSnapshot` with `sendSnapshot`. The snapshot time comes
  from `Clock`. The host also feeds each snapshot to its own interpolation
  buffer, so every peer renders remote players the same way.
- **Remote players are interpolated.** Every peer renders other players
  through `SnapshotInterpolation`, about 100 ms in the past. A lost or late
  snapshot only shortens the buffer. It never causes a jump.
- **The shooter detects hits.** On fire, the shooter raycasts the arena (the
  BVH under drei's `<Bvh>`) and tests the remote players' capsules at their
  rendered positions. Whichever is nearer wins. A player hit sends
  `Hit { shooter, target, point }` to the host on the reliable `events`
  channel. Every shot also sends `Shot { origin, dir }`.
- **The host validates hits and keeps the score.** Before accepting a hit, the
  host checks that the claimed shooter is the sender, that both players are
  alive, that the point lies within range of the shooter, and that the point
  is within 3 m of where the host last saw the target. The tolerance covers
  about one round trip of movement. An accepted hit broadcasts `Eliminated`
  and `Scored`. After 3 s the host broadcasts `Respawn` with the spawn point
  furthest from the other living players, and that player teleports there.
- **Shots are relayed.** Clients cannot reach each other in a star, so the
  host relays each `Shot` to every peer. Each peer re-traces the shot against
  its own arena and the players it can see, then paints the splat in the
  shooter's colour.
- **The host ends the match.** The host broadcasts `MatchEnded` with the
  final scores, then sends the lobby `EndMatch`. When the lobby phase returns
  to `waiting`, `/play` shows the scores briefly and navigates to
  `/lobby/$code`.

Bad messages never fail a loop. The decoders log them with `Effect.logWarning`
and drop them.

## Limits

This design is meant for friends, not for strangers who might cheat:

- A client can lie about its own position.
- A client can claim any hit that passes the plausibility checks.
- There is no lag compensation beyond the 3 m tolerance. Hits are judged
  against what the shooter saw.
- The host does not check line of sight for hits.

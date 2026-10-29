# Match netcode

This is casual peer-to-peer netcode on top of `PeerNetwork`, the WebRTC star
from `apps/web/src/lobby`. The host's browser is the authority on scores. Each
player's own movement is authoritative in that player's browser.

| File | Role |
| --- | --- |
| `protocol.ts` | Effect Schemas for `PlayerState`, `WorldSnapshot` and `NetEvent`, plus decoders that log and drop bad messages |
| `match.ts` | Pure host logic: roster, hit validation, the score reducer, respawns, snapshot assembly |
| `hit-test.ts` | Ray-vs-capsule intersection and nearest player hit |
| `../projectile.ts` | The pure paintball model: flight, stepping, aim correction, spread, reachability |
| `interpolation.ts` | Converts between `WorldSnapshot` and `@geckos.io/snapshot-interpolation` entities |
| `net-game.ts` | `NetGame` service (network loops), `netGameAtom`, `matchViewAtom`, `endMatchAtom` |
| `session.ts` | Decides whether `/play` is a lobby match or solo practice |
| `practice.ts` | A peerless `PeerNetwork` and `practiceGameAtom`, for practice against bots |

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
- **Shots are paintballs.** A ball leaves the marker's muzzle at the weapon's
  muzzle speed and falls under gravity, with no drag, so its flight is a pure
  function of origin, direction and age. It heads from the muzzle for the
  point the eye ray meets, so it converges on the crosshair, then drops below
  it with range. Every frame `<PaintballFlights>` steps each ball in short
  segments and tests them against the arena (the BVH under drei's `<Bvh>`)
  and every player's capsule but the shooter's. The first impact paints a
  splat or hits a player, and removes the ball.
- **Weapons differ only in how they shoot.** One hit eliminates. Each
  player carries an assault marker, a sniper and a shotgun (`../tuning.ts`)
  with a pod each, driven by the pure loadout in `../loadout.ts`: fire
  interval, magazine, reload, a swap delay, and zoom on the sniper. The
  weapon in hand travels in `PlayerState`, so peers draw it.
- **The shooter detects hits.** On fire, the shooter sends
  `Shot { origin, dir, weapon, seed }` on the reliable `events` channel and
  flies the ball itself. Every peer replays the shot with that weapon's spec,
  and `seed` draws the same pellet spread everywhere. Only that simulation reports hits: when its ball
  reaches a player, it sends `Hit { shooter, target, point, weapon }` to the
  host.
- **The host checks fire rates.** It relays only shots it accepts: per
  shooter and weapon, no faster than the fire interval and no more rounds
  than a pod holds without a pause long enough to reload, both with 250 ms
  of slack for messages that arrive bunched. A respawn refills every pod.
- **The host validates hits and keeps the score.** Before accepting a hit, the
  host checks that the claimed shooter is the sender, that both players are
  alive, that the shooter's last accepted shot of that weapon is recent
  enough for its ball to still be flying, that some ballistic path from the shooter reaches the point within
  the weapon's ball lifetime, and that the point is within 3 m of where the
  host last saw the target. The tolerance covers
  about one round trip of movement. An accepted hit broadcasts `Eliminated`
  and `Scored`. After 3 s the host broadcasts `Respawn` with the spawn point
  furthest from the other living players, and that player teleports there.
- **Shots are relayed and replayed.** Clients cannot reach each other in a
  star, so the host relays each `Shot` to every peer. Each peer flies the
  same ball from the same origin and direction, starting when the shot
  arrives, against its own arena and the players it can see. It paints the
  splat in the shooter's colour but never reports a hit.
- **The host ends the match.** The host broadcasts `MatchEnded` with the
  final scores, then sends the lobby `EndMatch`. When the lobby phase returns
  to `waiting`, `/play` shows the scores briefly and navigates to
  `/lobby/$code`.

Bad messages never fail a loop. The decoders log them with `Effect.logWarning`
and drop them.

## Bots

Bots run on the host. `NetGame` keeps a local slot for `you` and, on the
host, for every bot in the roster. The host folds each slot's state into its
snapshots, and a bot's shots go straight to `hostHandle`, so bots are scored,
eliminated and respawned like anyone else, and pass the same fire-rate
checks. Each bot draws a weapon from its seed at spawn and every respawn,
reloads between fights or when empty, and aims steadier with the sniper as
if zoomed. Each bot is a `<BotPlayer>`: a
rapier capsule driven by `thinkBot` in `../bot-brain.ts`, which turns what the
bot sees into the same `Intent` a human's devices produce. Bots wander the
road graph from `../bot-nav.ts` and fight the nearest player they can see.
The host draws them through `<RemotePlayers>`, from its own snapshots.

Practice (`/play?lat=…&lon=…&bots=3`) needs no lobby server or WebRTC.
`localPeerNetwork` is a host with no links: you and the bots are the whole
roster, and `NetGame.layerWith` runs unchanged on top of it. For now a bot is
any player whose id starts with `bot-`.

## Limits

This design is meant for friends, not for strangers who might cheat:

- A client can lie about its own position.
- A client can claim any hit that passes the plausibility checks, and the
  rate checks allow a reload during another weapon's fire.
- There is no lag compensation beyond the 3 m tolerance. Hits are judged
  against what the shooter saw.
- A ball still in flight when its shooter is eliminated lands, but the host
  rejects its hit.
- The host does not check line of sight for hits.

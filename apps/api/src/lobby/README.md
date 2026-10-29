# Lobby

A host picks a real-world location and opens a lobby. Friends join with a
six-character code. The host starts the match, everyone loads the same arena
(`GET /arenas?lat&lon` with the lobby's location), and the browsers connect to
each other over WebRTC. The server only runs the lobby and relays signaling.
Gameplay traffic never touches it.

## Files

| File | Role |
| --- | --- |
| `protocol.ts` | Effect Schema wire protocol, shared with the web app as `@worldmap-paintball/api/lobby/protocol` |
| `reducer.ts` | Pure lobby logic: `reduce(lobby, from, message)` and `disconnect(lobby, from)` each return `{ lobby, outbox }` |
| `rooms.ts` | `LobbyRooms` service: where lobby sockets live. `layerDurableObject(rooms)` for the Worker, `layerMemory` for the Bun dev server |
| `room.ts` | `LobbyRoom` Durable Object: WebSocket transport, storage, and delivery around the reducer |
| `routes.ts` | `LobbyRoutes`: an `HttpRouter` layer that hands `GET /lobbies/:code/ws` to `LobbyRooms` |
| `apps/web/src/lobby/lobby-client.ts` | `LobbyClient` service: WebSocket client, session state, signal buffer |
| `apps/web/src/lobby/peer-network.ts` | `PeerNetwork` service: WebRTC star with `state` and `events` data channels |
| `apps/web/src/lobby/lobby-atoms.ts` | Atoms for the UI (`effect/reactivity` + `@effect/atom-react`) |

## Protocol

All messages are JSON tagged unions (`ClientMessage`, `ServerMessage`), decoded
with `ClientMessageJson` and `ServerMessageJson`.

Client to server:

| Message | Who | Effect |
| --- | --- | --- |
| `CreateLobby { name, location }` | anyone, empty room | creates the lobby; sender becomes host |
| `JoinLobby { name }` | anyone | adds a player (waiting phase only) |
| `LeaveLobby` | member | same as disconnecting |
| `SetReady { ready }` | member | waiting phase only |
| `SetLocation { location }` | host | waiting phase; clears every ready flag |
| `StartMatch` | host | needs every non-host player ready; phase becomes `playing` |
| `EndMatch` | host | back to `waiting`; clears ready flags |
| `Signal { to, signal }` | member | relayed to `to` as `Signal { from, signal }`; one side must be the host |

Server to client: `Welcome { you, lobby }` (only to the player who just joined
or created), `LobbyUpdated { lobby }`, `MatchStarted { lobby }`,
`LobbyClosed { reason: 'HostLeft' }`, `Signal { from, signal }`, and
`Rejected { reason }`.

`signal` is `Offer { sdp }`, `Answer { sdp }`, or
`IceCandidate { candidate, sdpMid, sdpMLineIndex, usernameFragment }`.

`lobby` is the whole state: `{ phase, hostId, players: [{ id, name, ready }], location: { lat, lon, label? } }`.
Every update sends the full lobby, so clients never apply diffs.

Rules the reducer enforces:

- At most `MAX_PLAYERS` (8) players.
- Names are 1 to 16 characters with no leading or trailing spaces. A name
  already in the lobby is rejected regardless of case (`NameTaken`).
- A socket that has not joined can only send `CreateLobby` or `JoinLobby`;
  anything else gets `NotInLobby`.
- Signals are relayed only between two different members of the same lobby,
  and only between the host and a non-host member (the star topology). A
  target that is the sender or not a member gets `UnknownPeer`, a
  client-to-client signal gets `PeerNotHost`, and a sender outside the lobby
  gets `NotInLobby`. Rejected signals are never delivered.
- Joining is closed while a match is running (`MatchInProgress`).
- The location has the same bounds as `GET /arenas` (lat between -85 and 85).

### Codes and identity

A lobby code is six characters from `A-Z` and `2-9`, leaving out `I`, `O`, `0`
and `1`. The client generates it with `makeLobbyCode` (secure random) and then
sends `CreateLobby`. If that code is already taken, the server answers
`LobbyExists` and the client tries a new code, up to three retries. That is
about 10^9 codes, so collisions are rare. Creating a lobby needs no separate
HTTP endpoint.

The Durable Object gives each socket a random UUID as its player id. It stores
the id as a hibernation tag on the socket. So a player id lasts as long as one
socket, and reconnecting means joining again.

## Host leaves: migrate while waiting, close mid-match

- **Waiting phase:** the earliest joiner who is still present becomes host and
  everyone gets `LobbyUpdated`. Nothing is lost, because the lobby lives on the
  server.
- **Playing phase:** the lobby closes. Remaining players get
  `LobbyClosed { reason: 'HostLeft' }` and the room resets to empty. The host's
  browser runs the game, so when it leaves the match state is gone. Moving a
  live match to another peer would need snapshot handover and a renegotiated
  star, which is out of scope.
- When the last player leaves, the room resets to empty and its code can be
  used again.

## Transports (`rooms.ts`)

`LobbyRoutes` depends only on the `LobbyRooms` service, whose one method is
`connect(code, request)`: answer the WebSocket upgrade for that lobby and own
the socket from then on. Both layers give every socket a random UUID as its
player id and drive the same `reduce` and `disconnect`.

| Layer | Used by | Lobby state |
| --- | --- | --- |
| `LobbyRooms.layerDurableObject(rooms)` | `worker.ts` | one `LobbyRoom` Durable Object per code (below) |
| `LobbyRooms.layerMemory` | `bin.ts` (`bun run --cwd apps/api dev`) | a `Map` of code to `{ lobby, sockets }` in the process |

`layerMemory` upgrades with `HttpServerRequest.upgrade`, so it needs a server
that supports it (`BunHttpServer`). It runs every reducer step under one
semaphore, so each step and its deliveries are atomic. A socket's scope
finalizer runs `disconnect` and drops the room once its last socket closes,
which frees the code. State does not survive a restart and is not shared
between processes, so it is for local development only. A plain HTTP request
gets `426` from both layers.

## Durable Object transport (`room.ts`)

`LobbyRoom` is an inline Effect Durable Object
(`Cloudflare.DurableObject<LobbyRoom>()('LobbyRoom', impl)`). There is one
instance per lobby code (`rooms.getByName(code)`).

- `fetch` accepts the WebSocket with `Cloudflare.upgrade({ tags: [playerId] })`.
  The sockets are hibernatable.
- `webSocketMessage` decodes the message, runs `reduce`, stores the new lobby
  under the storage key `lobby`, then sends each outbox message to
  `state.getWebSockets(to)`. A message that fails to decode gets
  `Rejected { reason: 'InvalidMessage' }`.
- `webSocketClose` and `webSocketError` run `disconnect`.
- When the object wakes, it loads the lobby from storage. It then removes any
  stored member that no longer has a live socket, since sockets that dropped
  during eviction never send a close event.

## Topology (`peer-network.ts`)

The network is a host-authoritative star. The host's browser is the server
peer.

- The host opens one `RTCPeerConnection` per client and creates two data
  channels on it:
  - `state`: unordered, `maxRetransmits: 0`. Use it for snapshots and inputs.
  - `events`: reliable and ordered. Use it for hits and scores.
- Clients only answer the host's offer and accept its channels through
  `datachannel`. A client ignores signals from anyone but the host.
- ICE servers default to `stun:stun.l.google.com:19302`. Use
  `PeerNetwork.layerWith({ iceServers })` to add TURN later.
- Signals are handled one at a time. ICE candidates that arrive before the
  remote description are buffered.
- `LobbyClient` queues incoming `Signal` messages and clears the queue on
  `MatchStarted`. A client that builds its `PeerNetwork` after the host's offer
  has arrived still receives that offer, and signals from an earlier match
  cannot leak into the next one.
- `sendSnapshot(state)` broadcasts `{ id, time, state }` on `state`, with
  `time` taken from `Clock`. That is the snapshot shape
  `@geckos.io/snapshot-interpolation` expects. `snapshots` streams the decoded
  snapshots back out.
- Players who leave mid-match have their connections closed. If the lobby
  closes, every connection is closed.

## Wiring

`worker.ts` yields `LobbyRoom` (which registers the Durable Object export and
binding) and provides `LobbyRooms.layerDurableObject(rooms)`. `bin.ts` provides
`LobbyRooms.layerMemory`. `alchemy.run.ts` needs no changes: `yield* Api`
already deploys whatever the Worker binds.

The web app reaches the API under `/api`, and `LobbyClient.layerWebSocket('/api')`
dials `ws(s)://<origin>/api/lobbies/<code>/ws`. The Vite dev proxy passes
WebSocket upgrades through to the Bun server (`ws: true`). Whatever maps `/api`
to the deployed Worker must do the same.

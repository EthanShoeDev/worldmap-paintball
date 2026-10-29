import '@tanstack/react-start/client-only';
import {
  ClientMessage,
  type Player,
  type PlayerId,
  SignalPayload,
} from '@worldmap-paintball/api-contract/lobby';
import {
  Array,
  Clock,
  Context,
  Effect,
  FiberSet,
  Layer,
  Option,
  PubSub,
  Schema,
  Stream,
  SubscriptionRef,
} from 'effect';

import { matchRoster } from '../game/net/bots.ts';
import { LobbyClient } from './lobby-client.ts';
import { MatchNetwork, type MatchStart } from './match-network.ts';

export const defaultIceServers: ReadonlyArray<RTCIceServer> = [
  { urls: 'stun:stun.l.google.com:19302' },
];

export const Channel = Schema.Literals(['state', 'events']);
export type Channel = typeof Channel.Type;

// The shape @geckos.io/snapshot-interpolation consumes; `time` is Clock ms.
export const Snapshot = Schema.Struct({
  id: Schema.String,
  time: Schema.Finite,
  state: Schema.Unknown,
});
export type Snapshot = typeof Snapshot.Type;

export interface PeerMessage {
  readonly from: PlayerId;
  readonly channel: Channel;
  readonly data: unknown;
}

export class PeerNetworkError extends Schema.TaggedError<
  PeerNetworkError,
  { readonly brand: unique symbol }
>()('PeerNetworkError', {
  reason: Schema.Literals(['UnknownPeer', 'ChannelNotOpen', 'Unserializable']),
}) {}

export class PeerSignalingError extends Schema.TaggedError<
  PeerSignalingError,
  { readonly brand: unique symbol }
>()('PeerSignalingError', { peer: Schema.String, cause: Schema.Defect() }) {}

export interface PeerNetworkOptions {
  readonly iceServers: ReadonlyArray<RTCIceServer>;
}

interface Link {
  readonly connection: RTCPeerConnection;
  readonly channels: Map<Channel, RTCDataChannel>;
}

const defaultOptions: PeerNetworkOptions = { iceServers: defaultIceServers };

const Client = ClientMessage.cases;
const Signal = SignalPayload.cases;
const isChannel = Schema.is(Channel);
const Json = Schema.fromJsonString(Schema.Unknown);
const encodeJson = Schema.encodeEffect(Json);
const decodeJson = Schema.decodeEffect(Json);
const decodeSnapshot = Schema.decodeUnknownEffect(Snapshot);

const candidateSignal = (candidate: RTCIceCandidate) =>
  Signal.IceCandidate.make({
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  });

// Host-authoritative star: the host holds one RTCPeerConnection per client
// and creates both data channels; clients only answer the host's offer.
export class PeerNetwork extends Context.Service<
  PeerNetwork,
  {
    readonly you: PlayerId;
    readonly hostId: PlayerId;
    readonly isHost: boolean;
    // Lobby order when the match started.
    readonly roster: ReadonlyArray<Player>;
    // Who is still in the lobby, in join order.
    readonly players: SubscriptionRef.SubscriptionRef<ReadonlyArray<Player>>;
    readonly peers: SubscriptionRef.SubscriptionRef<
      ReadonlyMap<PlayerId, RTCPeerConnectionState>
    >;
    readonly messages: Stream.Stream<PeerMessage>;
    readonly snapshots: Stream.Stream<Snapshot>;
    readonly send: (
      to: PlayerId,
      channel: Channel,
      data: unknown,
    ) => Effect.Effect<void, PeerNetworkError>;
    // Host: every client. Client: the host.
    readonly broadcast: (
      channel: Channel,
      data: unknown,
    ) => Effect.Effect<void>;
    readonly sendSnapshot: (state: unknown) => Effect.Effect<void>;
  }
>()('@worldmap-paintball/web/lobby/peer-network/PeerNetwork') {
  // Scoped: closing the scope closes every RTCPeerConnection.
  static readonly make = (
    { you, lobby }: MatchStart,
    options: PeerNetworkOptions = defaultOptions,
  ) =>
    Effect.gen(function* () {
      const lobbyClient = yield* LobbyClient;
      const hostId = lobby.hostId;
      const isHost = you === hostId;
      const run = yield* FiberSet.makeRuntime();
      const links = new Map<PlayerId, Link>();
      const pendingIce = new Map<PlayerId, Array<RTCIceCandidateInit>>();
      const peers = yield* SubscriptionRef.make<
        ReadonlyMap<PlayerId, RTCPeerConnectionState>
      >(new Map());
      // Bots count as present for the whole match; only players leave.
      const players = yield* SubscriptionRef.make<ReadonlyArray<Player>>(
        matchRoster(lobby),
      );
      const inbox = yield* PubSub.unbounded<PeerMessage>();

      const signal = (to: PlayerId, payload: SignalPayload) =>
        lobbyClient.send(Client.Signal.make({ to, signal: payload })).pipe(
          Effect.tapError((error) =>
            Effect.logWarning('Signal not sent', error),
          ),
          Effect.ignore,
        );

      const setPeerState = (peer: PlayerId, state: RTCPeerConnectionState) =>
        SubscriptionRef.update(peers, (current) =>
          new Map(current).set(peer, state),
        );

      const attach = (peer: PlayerId, link: Link, channel: RTCDataChannel) => {
        if (!isChannel(channel.label)) return;
        const label = channel.label;
        link.channels.set(label, channel);
        channel.addEventListener('message', (event: MessageEvent<unknown>) => {
          run(
            decodeJson(String(event.data)).pipe(
              Effect.flatMap((data) =>
                PubSub.publish(inbox, { from: peer, channel: label, data }),
              ),
              Effect.ignore,
            ),
          );
        });
      };

      const close = (peer: PlayerId) =>
        Effect.gen(function* () {
          links.get(peer)?.connection.close();
          links.delete(peer);
          pendingIce.delete(peer);
          yield* SubscriptionRef.update(peers, (current) => {
            const next = new Map(current);
            next.delete(peer);
            return next;
          });
        });

      const open = (peer: PlayerId) =>
        Effect.gen(function* () {
          yield* close(peer);
          const connection = new RTCPeerConnection({
            iceServers: [...options.iceServers],
          });
          const link: Link = { connection, channels: new Map() };
          links.set(peer, link);
          connection.addEventListener('icecandidate', ({ candidate }) => {
            if (candidate !== null) {
              run(signal(peer, candidateSignal(candidate)));
            }
          });
          connection.addEventListener('connectionstatechange', () => {
            run(setPeerState(peer, connection.connectionState));
          });
          connection.addEventListener('datachannel', ({ channel }) =>
            attach(peer, link, channel),
          );
          if (isHost) {
            attach(
              peer,
              link,
              connection.createDataChannel('state', {
                ordered: false,
                maxRetransmits: 0,
              }),
            );
            attach(peer, link, connection.createDataChannel('events'));
          }
          yield* setPeerState(peer, connection.connectionState);
          return link;
        });

      const flushIce = (peer: PlayerId, link: Link) =>
        Effect.forEach(
          pendingIce.get(peer) ?? [],
          (candidate) =>
            Effect.promise(() => link.connection.addIceCandidate(candidate)),
          { discard: true },
        ).pipe(Effect.ensuring(Effect.sync(() => pendingIce.delete(peer))));

      const offer = Effect.fn('PeerNetwork.offer')(function* (peer: PlayerId) {
        const { connection } = yield* open(peer);
        const description = yield* Effect.tryPromise({
          try: () => connection.createOffer(),
          catch: (cause) => PeerSignalingError.make({ peer, cause }),
        });
        yield* Effect.tryPromise({
          try: () => connection.setLocalDescription(description),
          catch: (cause) => PeerSignalingError.make({ peer, cause }),
        });
        yield* signal(peer, Signal.Offer.make({ sdp: description.sdp ?? '' }));
      });

      const handleSignal = Effect.fn('PeerNetwork.handleSignal')(
        function* ({
          from,
          signal: payload,
        }: {
          from: PlayerId;
          signal: SignalPayload;
        }) {
          // In a star, clients only ever talk to the host.
          if (!isHost && from !== hostId) return;
          const tryRtc = <A>(promise: () => Promise<A>) =>
            Effect.tryPromise({
              try: promise,
              catch: (cause) => PeerSignalingError.make({ peer: from, cause }),
            });
          yield* SignalPayload.match(payload, {
            Offer: ({ sdp }) =>
              Effect.gen(function* () {
                if (isHost) return;
                const link = yield* open(from);
                yield* tryRtc(() =>
                  link.connection.setRemoteDescription({
                    type: 'offer',
                    sdp,
                  }),
                );
                yield* flushIce(from, link);
                const answer = yield* tryRtc(() =>
                  link.connection.createAnswer(),
                );
                yield* tryRtc(() =>
                  link.connection.setLocalDescription(answer),
                );
                yield* signal(
                  from,
                  Signal.Answer.make({ sdp: answer.sdp ?? '' }),
                );
              }),
            Answer: ({ sdp }) =>
              Effect.gen(function* () {
                const link = links.get(from);
                if (!isHost || link === undefined) return;
                yield* tryRtc(() =>
                  link.connection.setRemoteDescription({
                    type: 'answer',
                    sdp,
                  }),
                );
                yield* flushIce(from, link);
              }),
            IceCandidate: (candidate) =>
              Effect.gen(function* () {
                const link = links.get(from);
                if (link?.connection.remoteDescription) {
                  yield* tryRtc(() =>
                    link.connection.addIceCandidate(candidate),
                  );
                  return;
                }
                pendingIce.set(from, [
                  ...(pendingIce.get(from) ?? []),
                  candidate,
                ]);
              }),
          });
        },
        Effect.catchTag('PeerSignalingError', (error) =>
          Effect.logWarning('WebRTC signaling failed', error),
        ),
      );

      yield* Effect.addFinalizer(() =>
        Effect.forEach([...links.keys()], close, { discard: true }),
      );

      // Signals are handled one at a time so an ICE candidate can never
      // race ahead of the description it belongs to.
      yield* lobbyClient.signals.pipe(
        Stream.runForEach(handleSignal),
        Effect.forkScoped,
      );

      // Drop peers that leave mid-match.
      yield* lobbyClient.lobbies.pipe(
        Stream.runForEach((current) => {
          const members = new Set(
            Array.map(current.players, (player) => player.id),
          );
          return Effect.andThen(
            SubscriptionRef.set(players, matchRoster(current)),
            Effect.forEach(
              Array.filter([...links.keys()], (peer) => !members.has(peer)),
              close,
              { discard: true },
            ),
          );
        }),
        Effect.forkScoped,
      );

      if (isHost) {
        for (const player of lobby.players) {
          if (player.id !== you) yield* offer(player.id).pipe(Effect.ignore);
        }
      }

      const send = Effect.fn('PeerNetwork.send')(function* (
        to: PlayerId,
        channel: Channel,
        data: unknown,
      ) {
        const link = links.get(to);
        if (link === undefined) {
          return yield* PeerNetworkError.make({ reason: 'UnknownPeer' });
        }
        const dataChannel = link.channels.get(channel);
        if (dataChannel?.readyState !== 'open') {
          return yield* PeerNetworkError.make({ reason: 'ChannelNotOpen' });
        }
        const text = yield* encodeJson(data).pipe(
          Effect.mapError(() =>
            PeerNetworkError.make({ reason: 'Unserializable' }),
          ),
        );
        dataChannel.send(text);
      });

      const broadcast = Effect.fn('PeerNetwork.broadcast')(function* (
        channel: Channel,
        data: unknown,
      ) {
        // Unreliable by design: a peer that is not open yet just misses it.
        yield* Effect.forEach(
          [...links.keys()],
          (peer) => send(peer, channel, data).pipe(Effect.ignore),
          { discard: true },
        );
      });

      let nextSnapshotId = 0;
      const sendSnapshot = Effect.fn('PeerNetwork.sendSnapshot')(function* (
        state: unknown,
      ) {
        const time = yield* Clock.currentTimeMillis;
        nextSnapshotId += 1;
        yield* broadcast('state', {
          id: String(nextSnapshotId),
          time,
          state,
        });
      });

      const messages = Stream.fromPubSub(inbox);
      const snapshots = messages.pipe(
        Stream.filter((message) => message.channel === 'state'),
        Stream.mapEffect((message) =>
          Effect.option(decodeSnapshot(message.data)),
        ),
        Stream.filter(Option.isSome),
        Stream.map((snapshot) => snapshot.value),
      );

      return PeerNetwork.of({
        you,
        hostId,
        isHost,
        roster: matchRoster(lobby),
        players,
        peers,
        messages,
        snapshots,
        send,
        broadcast,
        sendSnapshot,
      });
    });
}

export const matchNetworkLayer = Layer.effect(
  MatchNetwork,
  Effect.gen(function* () {
    const lobbyClient = yield* LobbyClient;
    const current = yield* SubscriptionRef.make(
      Option.none<PeerNetwork['Service']>(),
    );
    const play = (match: MatchStart) =>
      Effect.gen(function* () {
        const network = yield* PeerNetwork.make(match);
        yield* SubscriptionRef.set(current, Option.some(network));
        // Runs before the network's own finalizers close its connections.
        yield* Effect.addFinalizer(() =>
          SubscriptionRef.set(current, Option.none()),
        );
        return yield* Effect.never;
      }).pipe(Effect.scoped, Effect.provideService(LobbyClient, lobbyClient));
    return MatchNetwork.of({ play, current });
  }),
);

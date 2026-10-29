import {
  makeDurableObjectBridge,
  makeWorkerBridge,
} from '@alchemy.run/cloudflare/Bridge';
import { DurableObject, env, WorkerEntrypoint } from 'cloudflare:workers';

import Web from './worker.server.ts';

// The entry alchemy generates for an Effect Worker it bundles itself. Vite
// bundles this one, so it is written out here: the default export runs Web's
// Effect, and every Durable Object class Web yields is exported by name.
// Both bridges must get this one object: it keys the isolate's single build of
// Web. The generated entry is untyped; the Worker bridge's parameter type is
// the one that accepts Web's deploy-time requirements.
const meta: Parameters<typeof makeWorkerBridge>[1] = {
  entrypoint: Web,
  stack: { name: env.ALCHEMY_STACK_NAME, stage: env.ALCHEMY_STAGE },
};

export default makeWorkerBridge(WorkerEntrypoint, meta);

const DurableObjectBridge = makeDurableObjectBridge(DurableObject, meta);

export class LobbyRoom extends DurableObjectBridge('LobbyRoom') {}

export class ArenaBaker extends DurableObjectBridge('ArenaBaker') {}

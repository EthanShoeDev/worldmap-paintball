// workerd's built-in module, as far as worker-entry.server.ts uses it.
// @cloudflare/workers-types declares it only alongside the Workers globals,
// which clash with the DOM types this app compiles against.
declare module 'cloudflare:workers' {
  type Base = abstract new (ctx: unknown, env: unknown) => object;
  export const DurableObject: Base;
  export const WorkerEntrypoint: Base;
  export const env: {
    readonly ALCHEMY_STACK_NAME: string;
    readonly ALCHEMY_STAGE: string;
  };
}

import { createHandler, publicKeys, backendKey } from './handler.mjs';

const env = (name: string) => Deno.env.get(name);
Deno.serve(createHandler({
  projectURL: env('SUPABASE_URL') || '', keys: publicKeys(env), serviceKey: backendKey(env),
}));

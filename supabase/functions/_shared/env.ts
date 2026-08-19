/** Returns a required Edge Function secret without ever exposing its value in an error response. */
export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

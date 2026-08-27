import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Fail the production build early if the Supabase environment is missing or malformed,
 * so we never ship a bundle that blanks the screen with "Invalid supabaseUrl" at runtime.
 * Only the variable name is reported — the value is never logged.
 */
function assertSupabaseEnv(env: Record<string, string>): void {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();

  const urlIsValid = (() => {
    if (!url || url.includes('YOUR_PROJECT_ID')) return false;
    try {
      return ['http:', 'https:'].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  })();

  if (!urlIsValid) {
    throw new Error(
      'VITE_SUPABASE_URL is missing or invalid — set it to your Supabase project URL, e.g. https://<project-ref>.supabase.co',
    );
  }
  if (!anonKey) {
    throw new Error('VITE_SUPABASE_ANON_KEY is missing — set it to your Supabase anon/publishable key');
  }
}

export default defineConfig(({ command, mode }) => {
  // Guard only the production build; `vite dev`/`preview` fall back to the in-app setup page.
  if (command === 'build') {
    assertSupabaseEnv(loadEnv(mode, process.cwd(), 'VITE_'));
  }
  return {
    plugins: [react()],
    build: { sourcemap: true },
  };
});

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/**
 * A configured app needs a syntactically valid http(s) Supabase URL *and* a non-empty
 * anon key. Requiring a valid URL here is deliberate: if a bad value is ever built into
 * the bundle (e.g. a key pasted into the URL slot), the app renders the setup page
 * instead of letting `createClient` throw "Invalid supabaseUrl" and blanking the screen.
 */
function isValidHttpUrl(value: string | undefined): boolean {
  if (!value || value.includes('YOUR_PROJECT_ID')) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export const appConfig = { url, anonKey, isSupabaseConfigured: isValidHttpUrl(url) && Boolean(anonKey) };

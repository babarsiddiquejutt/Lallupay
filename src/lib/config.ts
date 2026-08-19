const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const appConfig = { url, anonKey, isSupabaseConfigured: Boolean(url && anonKey && !url.includes('YOUR_PROJECT_ID')) };

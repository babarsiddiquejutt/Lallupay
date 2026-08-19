import { createClient } from '@supabase/supabase-js';
import { appConfig } from './config';
import type { Database } from '../types/database';

/** A single typed client. It is null until public environment values are configured. */
export const supabase = appConfig.isSupabaseConfigured
  ? createClient<Database>(appConfig.url!, appConfig.anonKey!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
  (import.meta.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined);
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  (import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined);

const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : null;

export const createEphemeralSupabaseClient = () => {
  if (!isConfigured) return null;

  return createClient(supabaseUrl as string, supabaseAnonKey as string, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};

export const supabasePublicUrl = isConfigured ? (supabaseUrl as string) : '';
export const supabasePublicAnonKey = isConfigured ? (supabaseAnonKey as string) : '';

export const supabaseConfigError = isConfigured
  ? null
  : 'Supabase ENV fehlt. Setze VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY (oder NEXT_PUBLIC_*).';

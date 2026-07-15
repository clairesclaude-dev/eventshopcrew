import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, IS_CONFIGURED } from "./config.js";

// A single shared client. When not configured yet, we still create a client
// with a placeholder so imports don't crash; calls simply won't be made until
// IS_CONFIGURED is true (the UI guards on that).
export const supabase = createClient(
  SUPABASE_URL,
  IS_CONFIGURED ? SUPABASE_ANON_KEY : "public-anon-placeholder",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

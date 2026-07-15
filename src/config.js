// EventShop Crew Portal — public configuration
// These two values are SAFE to keep in frontend code (that's what they're for).
// The Project URL and the "anon"/publishable key only allow actions your
// database Row-Level Security rules permit. Never put the service_role key here.

export const SUPABASE_URL = "https://ctqsfozjvmvmnnuzucmt.supabase.co";

// Paste your anon / publishable key between the quotes (Supabase ->
// Project Settings -> API -> "anon public"). Until then the app runs in
// a friendly "not configured" mode instead of erroring.
export const SUPABASE_ANON_KEY = "sb_publishable_xZLCiEysWZF_KrrsfyMCww_dccfej3c";

export const IS_CONFIGURED =
  !!SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== "PASTE_ANON_KEY_HERE";

// Brand palette (from the EventShop logos)
export const BRAND = {
  black: "#0B0B0B",
  canary: "#F6D22C",
  forest: "#1F3D2B",
  white: "#FFFFFF",
};

// Where portal notifications / approvals are directed
export const ADMIN_EMAIL = "eventshopknox@gmail.com";

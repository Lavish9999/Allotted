// Copy this file to www/cloud-config.js and fill in your Supabase project values.
// www/cloud-config.js is gitignored and must NEVER be committed.
// The anon key is safe to ship in the app ONLY because Row Level Security
// (docs/supabase-schema.sql) restricts every table. Do not use the service key here.
window.ALLOTTED_CLOUD_CONFIG = {
  url: "",     // Supabase project URL, e.g. your project ref .supabase.co address
  anonKey: ""  // Supabase anon public key (Settings -> API)
};

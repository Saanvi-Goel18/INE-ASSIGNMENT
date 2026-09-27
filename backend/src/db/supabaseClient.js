const { createClient } = require('@supabase/supabase-js');

// Accept the URL with or without the /rest/v1 suffix the dashboard sometimes shows.
const url = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');

module.exports = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

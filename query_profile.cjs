const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kagvxhyvxxypspdxcuxz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthZ3Z4aHl2eHh5cHNwZHhjdXh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NDY4ODAsImV4cCI6MjA3OTIyMjg4MH0.APcy7MarehMnI4fXkFHgWdgdT9PPBYhyunNXzNDJzlw');

async function run() {
  const { data: d1 } = await supabase.from('profiles').select('id, avatar_url, full_name').limit(2);
  console.log('profiles:', d1);

  const { data: d2 } = await supabase.from('client_profiles').select('*').limit(2);
  console.log('client_profiles:', d2);
}
run();

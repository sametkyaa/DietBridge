const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kagvxhyvxxypspdxcuxz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthZ3Z4aHl2eHh5cHNwZHhjdXh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NDY4ODAsImV4cCI6MjA3OTIyMjg4MH0.APcy7MarehMnI4fXkFHgWdgdT9PPBYhyunNXzNDJzlw');

async function run() {
  const { data, error } = await supabase.storage.getBucket('avatars');
  console.log('avatars bucket:', data, error);
  const { data: d2, error: e2 } = await supabase.storage.getBucket('profiles');
  console.log('profiles bucket:', d2, e2);
  const { data: d3, error: e3 } = await supabase.storage.getBucket('profile-photos');
  console.log('profile-photos bucket:', d3, e3);
}
run();

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kagvxhyvxxypspdxcuxz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthZ3Z4aHl2eHh5cHNwZHhjdXh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NDY4ODAsImV4cCI6MjA3OTIyMjg4MH0.APcy7MarehMnI4fXkFHgWdgdT9PPBYhyunNXzNDJzlw');

async function testCol(table, col) {
  const { error } = await supabase.from(table).select(col).limit(1);
  if (error) {
    console.log(`[!] Missing in ${table}: ${col} (${error.message})`);
  } else {
    console.log(`[+] EXISTS in ${table}: ${col}`);
  }
}
async function run() {
  await testCol('client_profiles', 'activity_level');
  await testCol('client_profiles', 'sleep_hours');
  await testCol('client_profiles', 'smoking_status');
  await testCol('client_profiles', 'alcohol_use');
  await testCol('client_profiles', 'alcohol_status');
  await testCol('client_profiles', 'profile_photo_url');
  
  await testCol('profiles', 'avatar_url');
  await testCol('profiles', 'profile_photo_url');
}
run();

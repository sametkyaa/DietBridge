const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kagvxhyvxxypspdxcuxz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthZ3Z4aHl2eHh5cHNwZHhjdXh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NDY4ODAsImV4cCI6MjA3OTIyMjg4MH0.APcy7MarehMnI4fXkFHgWdgdT9PPBYhyunNXzNDJzlw');

async function testCols(cols) {
  for (const col of cols) {
    const { error } = await supabase.from('client_profiles').select(col).limit(1);
    if (!error) {
      console.log(`[+] EXISTS in client_profiles: ${col}`);
    }
  }
}
async function testColsProfiles(cols) {
  for (const col of cols) {
    const { error } = await supabase.from('profiles').select(col).limit(1);
    if (!error) {
      console.log(`[+] EXISTS in profiles: ${col}`);
    }
  }
}
testCols(['avatar_url', 'profile_photo_url', 'photo_url', 'image_url', 'profile_image_url']);
testColsProfiles(['avatar_url', 'profile_photo_url', 'photo_url', 'image_url', 'profile_image_url']);

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://kagvxhyvxxypspdxcuxz.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthZ3Z4aHl2eHh5cHNwZHhjdXh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NDY4ODAsImV4cCI6MjA3OTIyMjg4MH0.APcy7MarehMnI4fXkFHgWdgdT9PPBYhyunNXzNDJzlw');

async function run() {
  const { data, error } = await supabase.from('profiles').select('*').limit(1);
  console.log("profiles keys:", data && data[0] ? Object.keys(data[0]) : "no data", "error:", error);
}
run();

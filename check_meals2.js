import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://kagvxhyvxxypspdxcuxz.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthZ3Z4aHl2eHh5cHNwZHhjdXh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NDY4ODAsImV4cCI6MjA3OTIyMjg4MH0.APcy7MarehMnI4fXkFHgWdgdT9PPBYhyunNXzNDJzlw';

const supabase = createClient(FALLBACK_URL, FALLBACK_KEY);

async function check() {
  const { data, error } = await supabase.from('meals').select('photo_url, recipe_id').limit(1);
  if (error) {
    console.error("Error fetching columns:", error);
  } else {
    console.log("Success! Columns exist.");
  }
}
check();

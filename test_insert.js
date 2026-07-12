import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://kagvxhyvxxypspdxcuxz.supabase.co';
const FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImthZ3Z4aHl2eHh5cHNwZHhjdXh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NDY4ODAsImV4cCI6MjA3OTIyMjg4MH0.APcy7MarehMnI4fXkFHgWdgdT9PPBYhyunNXzNDJzlw';

const supabase = createClient(FALLBACK_URL, FALLBACK_KEY);

async function check() {
  const payload = {
    plan_id: 'b149cd29-a1fc-40d4-a8ab-cf2fbc681b9e', // some random uuid, won't work but we just want to see the error code
    type: 'breakfast',
    title: 'Test',
    calories: 100,
    macros: {},
    photo_url: null,
    is_eaten: false,
    sort_order: 0,
    time: '08:00'
  };

  const { error } = await supabase.from('meals').insert([payload]);
  console.log(error);
}
check();

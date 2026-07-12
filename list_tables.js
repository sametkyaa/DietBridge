import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
async function list() {
  const { data, error } = await supabase.from('client_profiles').select('*').limit(1);
  console.log('client_profiles:', error ? error : 'exists');
  const { data: w, error: we } = await supabase.from('weight_logs').select('*').limit(1);
  console.log('weight_logs:', we ? we : 'exists');
  const { data: wa, error: wae } = await supabase.from('water_logs').select('*').limit(1);
  console.log('water_logs:', wae ? wae : 'exists');
  const { data: d, error: de } = await supabase.from('daily_logs').select('*').limit(1);
  console.log('daily_logs:', de ? de : 'exists');
}
list();

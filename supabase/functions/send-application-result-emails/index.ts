import { createClient } from 'npm:@supabase/supabase-js@2.87.0';
import { handleApplicationResultEmails, type QueuedEmail } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Provider secrets (set with `supabase secrets set`, never committed):
//   RESEND_API_KEY            Resend API key
//   APPLICATION_EMAIL_FROM    verified sender, e.g. "DietBridge <bildirim@dietbridge.com.tr>"
//   DIETBRIDGE_PANEL_URL      public Web panel URL used in the approval e-mail
const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? '';
const emailFrom = Deno.env.get('APPLICATION_EMAIL_FROM') ?? '';
const panelUrl = Deno.env.get('DIETBRIDGE_PANEL_URL') ?? '';

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((request) => handleApplicationResultEmails(request, {
  config: {
    providerConfigured: Boolean(resendApiKey && emailFrom && /^https:\/\//.test(panelUrl)),
    panelUrl,
  },
  authorize: async (authorization) => {
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (token === serviceRoleKey) return 'service';
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await caller.rpc('is_current_user_platform_admin');
    return !error && data === true ? 'admin' : 'denied';
  },
  claim: async (limit) => {
    const { data, error } = await admin.rpc('claim_application_result_emails', { p_limit: limit });
    if (error) throw new Error('claim_failed');
    return (data ?? []) as QueuedEmail[];
  },
  complete: async (id, sent, providerMessageId, failure) => {
    const { error } = await admin.rpc('complete_application_result_email', {
      p_id: id,
      p_sent: sent,
      p_provider_message_id: providerMessageId,
      p_error: failure,
    });
    if (error) throw new Error('complete_failed');
  },
  send: async (message) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    });
    if (!response.ok) throw new Error(`provider_status_${response.status}`);
    const body = await response.json().catch(() => ({}));
    return { id: typeof body?.id === 'string' ? body.id : null };
  },
}));

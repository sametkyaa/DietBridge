import { supabase } from '../../../lib/supabaseClient';
import type {
  ConnectionRequest,
  InquiryClosedReason,
  InquiryMessage,
  InquiryStatus,
  InquirySummary,
  RespondResult,
  SendInquiryResult,
} from '../types';

const GENERIC_ERROR = 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
const FALLBACK_CLIENT_NAME = 'Danışan';

const fail = (scope: string, error: unknown): never => {
  console.error(`[inquiries] ${scope}`, error);
  throw new Error(GENERIC_ERROR);
};

interface InquiryRow {
  id: string;
  client_id: string;
  counterpart_name: string | null;
  status: InquiryStatus;
  closed_reason: InquiryClosedReason;
  last_message_at: string | null;
  last_message_sender_id: string | null;
  last_message_body: string | null;
  unread_count: number | null;
  created_at: string;
}

export const listInquiries = async (currentUserId: string): Promise<InquirySummary[]> => {
  const { data, error } = await supabase.rpc('list_my_dietitian_inquiries');
  if (error || !Array.isArray(data)) return fail('list', error);
  return (data as InquiryRow[]).map((row) => ({
    id: row.id,
    clientId: row.client_id,
    clientName: row.counterpart_name?.trim() || FALLBACK_CLIENT_NAME,
    status: row.status,
    closedReason: row.closed_reason,
    lastMessageAt: row.last_message_at,
    lastMessageFromMe: row.last_message_sender_id === currentUserId,
    lastMessageBody: row.last_message_body,
    unreadCount: Math.max(0, Number(row.unread_count) || 0),
    createdAt: row.created_at,
  }));
};

export const listInquiryMessages = async (inquiryId: string): Promise<InquiryMessage[]> => {
  const { data, error } = await supabase
    .from('dietitian_inquiry_messages')
    .select('id, inquiry_id, sender_id, body, created_at')
    .eq('inquiry_id', inquiryId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error || !Array.isArray(data)) return fail('messages', error);
  return data.map((row) => ({
    id: row.id,
    inquiryId: row.inquiry_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
  }));
};

export const sendInquiryMessage = async (inquiryId: string, body: string, clientMessageId: string): Promise<SendInquiryResult> => {
  const { data, error } = await supabase.rpc('send_dietitian_inquiry_message', {
    p_inquiry_id: inquiryId,
    p_body: body,
    p_client_message_id: clientMessageId,
  });
  const result = (data as { result?: string } | null)?.result;
  if (error || !result) return fail('send', error);
  return result as SendInquiryResult;
};

export const closeInquiry = async (inquiryId: string): Promise<void> => {
  const { data, error } = await supabase.rpc('close_dietitian_inquiry', { p_inquiry_id: inquiryId });
  if (error || (data !== 'closed' && data !== 'not_found')) fail('close', error);
};

export const markInquiryRead = async (inquiryId: string): Promise<void> => {
  const { error } = await supabase.rpc('mark_dietitian_inquiry_read', { p_inquiry_id: inquiryId });
  if (error) console.warn('[inquiries] mark read failed');
};

interface RequestRow {
  id: string;
  client_id: string;
  client_name: string | null;
  note: string | null;
  created_at: string;
  inquiry_id: string | null;
}

export const listConnectionRequests = async (): Promise<ConnectionRequest[]> => {
  const { data, error } = await supabase.rpc('list_my_dietitian_connection_requests');
  if (error || !Array.isArray(data)) return fail('requests', error);
  return (data as RequestRow[]).map((row) => ({
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name?.trim() || FALLBACK_CLIENT_NAME,
    note: row.note,
    createdAt: row.created_at,
    inquiryId: row.inquiry_id,
  }));
};

export const respondConnectionRequest = async (requestId: string, accept: boolean): Promise<RespondResult> => {
  const { data, error } = await supabase.rpc('respond_dietitian_connection_request', {
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error || typeof data !== 'string') return fail('respond', error);
  return data as RespondResult;
};

// Realtime only signals that something changed; callers re-read through the
// RPCs above so names and unread counts stay server-computed.
export const subscribeInquiryChanges = (dietitianId: string, onChange: () => void): (() => void) => {
  const channel = supabase
    .channel(`dietitian-inquiries:${dietitianId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dietitian_inquiries', filter: `dietitian_id=eq.${dietitianId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dietitian_connection_requests', filter: `dietitian_id=eq.${dietitianId}` }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
};

export const subscribeInquiryMessages = (inquiryId: string, onInsert: () => void): (() => void) => {
  const channel = supabase
    .channel(`dietitian-inquiry-messages:${inquiryId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dietitian_inquiry_messages', filter: `inquiry_id=eq.${inquiryId}` }, onInsert)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
};

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listConnectionRequests,
  listInquiries,
  listInquiryMessages,
  markInquiryRead,
  respondConnectionRequest,
  sendInquiryMessage,
  subscribeInquiryChanges,
  subscribeInquiryMessages,
} from '../services/inquiryService';
import type { ConnectionRequest, InquiryMessage, InquirySummary, RespondResult } from '../types';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export const useInquiries = (userId: string | null | undefined) => {
  const [inquiries, setInquiries] = useState<InquirySummary[]>([]);
  const [requests, setRequests] = useState<ConnectionRequest[]>([]);
  const [status, setStatus] = useState<LoadState>('idle');
  const generation = useRef(0);

  const refresh = useCallback(async (silent = false) => {
    if (!userId) return;
    const current = ++generation.current;
    if (!silent) setStatus('loading');
    try {
      const [nextInquiries, nextRequests] = await Promise.all([listInquiries(userId), listConnectionRequests()]);
      if (current !== generation.current) return;
      setInquiries(nextInquiries);
      setRequests(nextRequests);
      setStatus('ready');
    } catch {
      if (current === generation.current && !silent) setStatus('error');
    }
  }, [userId]);

  useEffect(() => {
    void refresh();
    if (!userId) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeInquiryChanges(userId, () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; void refresh(true); }, 200);
    });
    return () => { unsubscribe(); if (timer) clearTimeout(timer); };
  }, [refresh, userId]);

  const respond = useCallback(async (requestId: string, accept: boolean): Promise<RespondResult> => {
    const result = await respondConnectionRequest(requestId, accept);
    await refresh(true);
    return result;
  }, [refresh]);

  return { inquiries, requests, status, refresh, respond };
};

const createClientMessageId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `${Date.now().toString(16).padStart(8, '0').slice(-8)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`);

export const SEND_ERROR_MESSAGES: Record<string, string> = {
  closed: 'Bu ön görüşme kapandı, yeni mesaj gönderilemez.',
  rate_limited: 'Kısa sürede çok fazla mesaj gönderdiniz. Lütfen biraz sonra tekrar deneyin.',
  invalid: 'Mesaj 1 ile 1000 karakter arasında olmalıdır.',
  not_found: 'Bu ön görüşme bulunamadı.',
};

export const useInquiryConversation = (inquiryId: string | null, onActivity: () => void) => {
  const [messages, setMessages] = useState<InquiryMessage[]>([]);
  const [status, setStatus] = useState<LoadState>('idle');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const pendingId = useRef<string | null>(null);
  const pendingBody = useRef<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!inquiryId) { setMessages([]); setStatus('idle'); return; }
    const current = ++generation.current;
    if (!silent) setStatus('loading');
    try {
      const next = await listInquiryMessages(inquiryId);
      if (current !== generation.current) return;
      setMessages(next);
      setStatus('ready');
      await markInquiryRead(inquiryId);
      onActivity();
    } catch {
      if (current === generation.current && !silent) setStatus('error');
    }
  }, [inquiryId, onActivity]);

  useEffect(() => {
    setSendError(null);
    pendingId.current = null;
    void load();
    if (!inquiryId) return undefined;
    return subscribeInquiryMessages(inquiryId, () => { void load(true); });
  }, [inquiryId, load]);

  const send = useCallback(async (body: string): Promise<boolean> => {
    const trimmed = body.trim();
    if (!inquiryId || !trimmed || isSending) return false;
    // The same id is reused when the same text is retried, so a lost response
    // never sends twice. Edited text is a new message.
    if (!pendingId.current || pendingBody.current !== trimmed) {
      pendingId.current = createClientMessageId();
      pendingBody.current = trimmed;
    }
    setIsSending(true);
    setSendError(null);
    try {
      const result = await sendInquiryMessage(inquiryId, trimmed, pendingId.current);
      if (result === 'sent' || result === 'duplicate') {
        pendingId.current = null;
        await load(true);
        return true;
      }
      if (result !== 'rate_limited') pendingId.current = null;
      setSendError(SEND_ERROR_MESSAGES[result] ?? SEND_ERROR_MESSAGES.not_found);
      return false;
    } catch {
      setSendError('Mesaj gönderilemedi. Lütfen tekrar deneyin.');
      return false;
    } finally {
      setIsSending(false);
    }
  }, [inquiryId, isSending, load]);

  return { messages, status, reload: load, send, isSending, sendError };
};

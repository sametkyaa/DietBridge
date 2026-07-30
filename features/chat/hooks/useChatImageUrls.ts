import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types/chat';
import { getReadableChatImagePath, purgeChatImageSignedUrl, resolveChatImageSignedUrls } from '../services/chatImageReadService';

export interface ChatImageUrlState { url: string | null; loading: boolean; error: boolean; }
export type ChatImageUrlStates = Readonly<Record<string, ChatImageUrlState>>;

const EMPTY: ChatImageUrlState = { url: null, loading: false, error: false };

/** Resolves private image URLs without allowing an old conversation to update the new one. */
export const useChatImageUrls = (conversationId: string | null | undefined, messages: readonly ChatMessage[]) => {
  const [states, setStates] = useState<ChatImageUrlStates>({});
  const tokenRef = useRef(0);

  const resolve = useCallback(async (forceRefresh = false): Promise<void> => {
    const token = ++tokenRef.current;
    const imageMessages = messages.filter((message) => message.messageKind === 'image');
    for (const message of imageMessages) {
      if (!getReadableChatImagePath(message)) purgeChatImageSignedUrl(message.attachment?.objectPath);
    }
    setStates(Object.fromEntries(imageMessages.map((message) => [message.id, { url: null, loading: Boolean(getReadableChatImagePath(message)), error: false }])));
    const urls = await resolveChatImageSignedUrls(imageMessages, { forceRefresh });
    if (token !== tokenRef.current) return;
    setStates(Object.fromEntries(imageMessages.map((message) => {
      const path = getReadableChatImagePath(message);
      const url = path ? urls.get(path) ?? null : null;
      return [message.id, { url, loading: false, error: path !== null && url === null }];
    })));
  }, [messages]);

  useEffect(() => {
    void resolve();
    const timer = window.setInterval(() => void resolve(true), 240_000);
    return () => { tokenRef.current += 1; window.clearInterval(timer); };
  }, [conversationId, resolve]);

  const retry = useCallback((message: ChatMessage): void => {
    const path = getReadableChatImagePath(message);
    if (!path) return;
    purgeChatImageSignedUrl(path);
    void resolve(true);
  }, [resolve]);

  return { states, retry, refresh: () => resolve(true), empty: EMPTY };
};

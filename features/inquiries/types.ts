export type InquiryStatus = 'open' | 'closed' | 'connected';
export type InquiryClosedReason = 'client' | 'dietitian' | 'connected_elsewhere' | null;

export interface InquirySummary {
  id: string;
  clientId: string;
  clientName: string;
  status: InquiryStatus;
  closedReason: InquiryClosedReason;
  lastMessageAt: string | null;
  lastMessageFromMe: boolean;
  lastMessageBody: string | null;
  unreadCount: number;
  createdAt: string;
}

export interface InquiryMessage {
  id: string;
  inquiryId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface ConnectionRequest {
  id: string;
  clientId: string;
  clientName: string;
  note: string | null;
  createdAt: string;
  inquiryId: string | null;
}

export type RespondResult = 'accepted' | 'declined' | 'not_found' | 'client_has_dietitian' | 'limit_reached';
export type SendInquiryResult = 'sent' | 'duplicate' | 'not_found' | 'closed' | 'rate_limited' | 'invalid';

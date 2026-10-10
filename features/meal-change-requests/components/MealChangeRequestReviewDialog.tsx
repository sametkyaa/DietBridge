import { useEffect, useState } from 'react';
import { Button, Callout, Modal, Textarea } from '../../../shared/ui';
import {
  MealChangeRequestServiceError,
  MEAL_CHANGE_REQUEST_REVIEW_ERROR,
  reviewMealChangeRequest,
} from '../services/mealChangeRequestService';
import type { MealChangeRequest, MealChangeRequestDecision } from '../types/mealChangeRequest';
import { formatMealChangeSlots } from '../utils/mealChangeRequestContract';

export interface MealChangeRequestReviewDialogProps {
  request: MealChangeRequest | null;
  onClose: () => void;
  /** Called after the server accepted the decision; the caller refreshes its lists. */
  onReviewed: (request: MealChangeRequest) => void;
}

const formatPlanDate = (dateKey: string): string => new Intl.DateTimeFormat('tr-TR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
}).format(new Date(`${dateKey}T00:00:00Z`));

const formatRequestedAt = (value: string): string => new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
}).format(new Date(value));

/**
 * Shows one pending meal change request and lets the assigned dietitian
 * approve or reject it through review_meal_change_request. Approving does not
 * edit the plan; the dietitian updates the plan separately.
 */
export const MealChangeRequestReviewDialog = ({ request, onClose, onReviewed }: MealChangeRequestReviewDialogProps) => {
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<MealChangeRequestDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote('');
    setError(null);
    setPending(null);
  }, [request?.id]);

  const decide = async (decision: MealChangeRequestDecision) => {
    if (!request || pending) return;
    setPending(decision);
    setError(null);
    try {
      const reviewed = await reviewMealChangeRequest(request.id, decision, note.trim() || null);
      onReviewed(reviewed);
    } catch (reviewError) {
      setError(reviewError instanceof MealChangeRequestServiceError ? reviewError.userMessage : MEAL_CHANGE_REQUEST_REVIEW_ERROR);
    } finally {
      setPending(null);
    }
  };

  return (
    <Modal
      open={request !== null}
      onClose={onClose}
      dismissible={pending === null}
      title="Öğün değişikliği talebi"
      description={request ? `${request.clientName} · ${formatRequestedAt(request.createdAt)}` : undefined}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending !== null}>Vazgeç</Button>
          <Button variant="danger" onClick={() => void decide('rejected')} loading={pending === 'rejected'} disabled={pending !== null}>
            Reddet
          </Button>
          <Button variant="primary" onClick={() => void decide('approved')} loading={pending === 'approved'} disabled={pending !== null}>
            Onayla
          </Button>
        </>
      )}
    >
      {request && (
        <>
          <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-db bg-sunk px-3.5 py-3">
              <dt className="text-12 font-medium text-ink-3">Gün</dt>
              <dd className="m-0 mt-0.5 font-semibold capitalize">{formatPlanDate(request.planDate)}</dd>
            </div>
            <div className="rounded-db bg-sunk px-3.5 py-3">
              <dt className="text-12 font-medium text-ink-3">Öğün</dt>
              <dd className="m-0 mt-0.5 font-semibold">{formatMealChangeSlots(request.requestedSlots)}</dd>
            </div>
          </dl>
          <div>
            <p className="m-0 text-13 font-semibold">Danışanın notu</p>
            <p className="m-0 mt-1 whitespace-pre-wrap break-words text-14 text-ink-2">
              {request.notes ?? 'Not eklenmemiş.'}
            </p>
          </div>
          <Textarea
            label="Danışana yanıt (isteğe bağlı)"
            hint="Onayla veya Reddet seçildiğinde yanıtınız danışana sohbet mesajı olarak gönderilir. Boş bırakırsanız mesaj gönderilmez."
            value={note}
            maxLength={1000}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            disabled={pending !== null}
          />
          <Callout tone="mute">
            Onaylamak planı otomatik değiştirmez. Gerekli değişikliği Beslenme planı ekranından yapın.
          </Callout>
          {error && <Callout tone="bad" role="alert">{error}</Callout>}
        </>
      )}
    </Modal>
  );
};

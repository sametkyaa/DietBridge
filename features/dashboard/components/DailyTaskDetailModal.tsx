import { Avatar, Badge, Button, Modal } from '../../../shared/ui';
import type { DailyTask } from '../types/dailyTask';
import { formatTaskDue } from '../utils/taskPresentation';

export interface DailyTaskDetailModalProps {
  task: DailyTask | null;
  clientName: string | null;
  clientPhotoUrl: string | null;
  onClose: () => void;
  onEdit: (task: DailyTask) => void;
}

/** Read-only detail of one persistent task. */
export const DailyTaskDetailModal = ({ task, clientName, clientPhotoUrl, onClose, onEdit }: DailyTaskDetailModalProps) => (
  <Modal
    open={task !== null}
    onClose={onClose}
    title={task?.title ?? ''}
    description="Görev ayrıntısı"
    footer={task && (
      <>
        <Button variant="ghost" onClick={onClose}>Kapat</Button>
        <Button variant="primary" leftIcon="pencil-simple" onClick={() => onEdit(task)}>Düzenle</Button>
      </>
    )}
  >
    {task && (
      <>
        <div className="flex items-center gap-3">
          {task.clientId ? (
            <Avatar name={clientName || task.clientName || 'Danışan'} src={clientPhotoUrl} size="md" />
          ) : null}
          <div>
            <p className="m-0 text-12 font-medium text-ink-3">Atanan</p>
            <p className="m-0 font-semibold">{task.clientId === null ? 'Genel görev' : clientName || task.clientName || 'Danışan'}</p>
          </div>
          <Badge tone={task.status === 'completed' ? 'ok' : 'neutral'} className="ml-auto" dot>
            {task.status === 'completed' ? 'Tamamlandı' : 'Bekliyor'}
          </Badge>
        </div>
        <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-db bg-sunk px-3.5 py-3">
            <dt className="text-12 font-medium text-ink-3">Tarih</dt>
            <dd className="m-0 mt-0.5 font-semibold">{formatTaskDue(task)}</dd>
          </div>
          <div className="rounded-db bg-sunk px-3.5 py-3">
            <dt className="text-12 font-medium text-ink-3">Öncelik</dt>
            <dd className="m-0 mt-0.5 font-semibold">
              {task.priority === 'high' ? 'Yüksek' : task.priority === 'low' ? 'Düşük' : 'Orta'}
            </dd>
          </div>
        </dl>
        <div>
          <p className="m-0 text-13 font-semibold">Açıklama</p>
          <p className="m-0 mt-1 whitespace-pre-wrap break-words text-14 text-ink-2">
            {task.description || 'Açıklama eklenmemiş.'}
          </p>
        </div>
      </>
    )}
  </Modal>
);

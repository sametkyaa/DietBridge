import { useState } from 'react';
import { Button, Card, CardHeader, ErrorState, LoadingState } from '../../../../shared/ui';
import { useNutritionTarget } from '../../hooks/useNutritionTarget';
import { formatNutritionTarget } from '../../services/nutritionTargetService';
import { NutritionTargetEditor } from '../NutritionTargetEditor';

/** Dietitian-owned daily kcal band. Empty until the dietitian sets it; never estimated. */
export const ClientNutritionTargetCard = ({ clientId }: { clientId: string }) => {
  const { state, reload, setTarget } = useNutritionTarget(clientId);
  const [editing, setEditing] = useState(false);
  const target = state.status === 'success' ? state.target : null;
  return (
    <Card as="section" aria-labelledby="client-kcal-target-title">
      <CardHeader
        id="client-kcal-target-title"
        title="Günlük kalori hedefi"
        actions={state.status === 'success' && !editing
          ? <Button variant="ghost" size="sm" leftIcon="pencil-simple" onClick={() => setEditing(true)}>{target ? 'Düzenle' : 'Belirle'}</Button>
          : undefined}
      />
      {state.status === 'loading' || state.status === 'idle' ? (
        <LoadingState label="Kalori hedefi yükleniyor…" className="py-3" />
      ) : state.status === 'error' ? (
        <ErrorState compact description={state.message} onRetry={() => void reload()} />
      ) : editing ? (
        <NutritionTargetEditor
          clientId={clientId}
          target={target}
          onSaved={(saved) => { setTarget(saved); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="m-0 text-14">
          {target ? <b className="text-20 font-semibold tabular-nums">{formatNutritionTarget(target)}</b> : <span className="text-ink-3">Henüz belirlenmedi.</span>}
        </p>
      )}
    </Card>
  );
};

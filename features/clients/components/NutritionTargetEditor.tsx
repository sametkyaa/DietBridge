import { useEffect, useState, type FormEvent } from 'react';
import { Button, Callout, Input } from '../../../shared/ui';
import {
  NUTRITION_TARGET_MAX,
  NUTRITION_TARGET_MIN,
  NUTRITION_TARGET_SAVE_ERROR,
  NutritionTargetServiceError,
  saveNutritionTarget,
  validateNutritionTarget,
  type NutritionTarget,
} from '../services/nutritionTargetService';

export interface NutritionTargetEditorProps {
  clientId: string;
  target: NutritionTarget | null;
  onSaved: (target: NutritionTarget | null) => void;
  onCancel?: () => void;
}

const toInput = (value: number | null): string => (value === null ? '' : String(value));
const parseKcal = (value: string): number | null | 'invalid' => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  return Number(trimmed);
};

/** Edits the dietitian-owned daily kcal band; empty fields stay empty (never estimated). */
export const NutritionTargetEditor = ({ clientId, target, onSaved, onCancel }: NutritionTargetEditorProps) => {
  const [minValue, setMinValue] = useState(toInput(target?.minKcal ?? null));
  const [maxValue, setMaxValue] = useState(toInput(target?.maxKcal ?? null));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMinValue(toInput(target?.minKcal ?? null));
    setMaxValue(toInput(target?.maxKcal ?? null));
  }, [target?.minKcal, target?.maxKcal]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const minKcal = parseKcal(minValue);
    const maxKcal = parseKcal(maxValue);
    if (minKcal === 'invalid' || maxKcal === 'invalid') {
      setError('Kalori hedefi tam sayı olmalı.');
      return;
    }
    const validation = validateNutritionTarget(minKcal, maxKcal);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveNutritionTarget(clientId, minKcal, maxKcal));
    } catch (saveError) {
      setError(saveError instanceof NutritionTargetServiceError ? saveError.userMessage : NUTRITION_TARGET_SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Alt sınır (kcal)"
          inputMode="numeric"
          value={minValue}
          onChange={(event) => setMinValue(event.target.value)}
          placeholder={String(NUTRITION_TARGET_MIN)}
          disabled={saving}
        />
        <Input
          label="Üst sınır (kcal)"
          inputMode="numeric"
          value={maxValue}
          onChange={(event) => setMaxValue(event.target.value)}
          placeholder={String(NUTRITION_TARGET_MAX)}
          disabled={saving}
        />
      </div>
      <p className="m-0 text-12.5 text-ink-3">
        Yalnızca bir sınır girebilirsiniz. İki alanı boşaltıp kaydetmek hedefi kaldırır. Danışan hedefi görebilir, değiştiremez.
      </p>
      {error && <Callout tone="bad" role="alert">{error}</Callout>}
      <div className="flex justify-end gap-2">
        {onCancel && <Button variant="ghost" onClick={onCancel} disabled={saving}>Vazgeç</Button>}
        <Button type="submit" variant="primary" loading={saving}>Hedefi kaydet</Button>
      </div>
    </form>
  );
};

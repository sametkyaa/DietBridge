import { Fragment, type ReactNode } from 'react';
import { Badge, Card, CardHeader } from '../../../../shared/ui';
import type { ActiveClientDetails } from '../../services/clientService';
import { formatDecimal } from '../../utils/clientProfileContract';

const EMPTY = <span className="text-ink-3">Belirtilmemiş</span>;

const listOrEmpty = (values: readonly string[] | undefined, badgeTone?: 'warn') => {
  if (!values || values.length === 0) return EMPTY;
  if (badgeTone) {
    return (
      <span className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <Fragment key={value}>
            <Badge tone={badgeTone} size="sm">{value}</Badge>
          </Fragment>
        ))}
      </span>
    );
  }
  return values.join(', ');
};

const booleanLabel = (value: boolean | null, yes: string, no: string) => (value === null ? null : value ? yes : no);

/**
 * Read-only health and lifestyle facts the client entered in the mobile app.
 * The dietitian cannot edit them here.
 */
export const ClientHealthCard = ({ client }: { client: ActiveClientDetails }) => {
  const smoking = booleanLabel(client.smokingStatus, 'Kullanıyor', 'Kullanmıyor');
  const alcohol = client.alcoholStatus || booleanLabel(client.alcoholUse, 'Tüketiyor', 'Tüketmiyor');
  const rows: Array<[string, ReactNode]> = [
    ['Kronik hastalık', listOrEmpty(client.chronicConditions)],
    ['Kullandığı ilaç', listOrEmpty(client.medications)],
    ['İntolerans', listOrEmpty(client.foodIntolerances, 'warn')],
    ['Sevmedikleri', listOrEmpty(client.dislikedFoods)],
    ['Beslenme tipi', client.nutritionType || EMPTY],
    ['Kan grubu', client.bloodType || EMPTY],
    ['Aktivite', client.activityLevel || EMPTY],
    ['Uyku', client.sleepHoursLabel || EMPTY],
    ['Sigara / alkol', smoking || alcohol ? `${smoking ?? '—'} / ${alcohol ?? '—'}` : EMPTY],
    ['Su hedefi', client.waterGoalLiters ? `${formatDecimal(client.waterGoalLiters)} L` : EMPTY],
    ['Son tahlil', client.lastLabDate || EMPTY],
  ];
  return (
    <Card as="section" aria-labelledby="client-health-title">
      <CardHeader id="client-health-title" title="Sağlık ve yaşam tarzı" description="Danışanın mobil uygulamada girdiği bilgiler." />
      <dl className="m-0 grid grid-cols-[minmax(0,128px)_1fr] gap-x-4 gap-y-[11px] text-13.5">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-ink-3">{label}</dt>
            <dd className="m-0 min-w-0 break-words font-medium [overflow-wrap:anywhere]">{value}</dd>
          </Fragment>
        ))}
      </dl>
    </Card>
  );
};

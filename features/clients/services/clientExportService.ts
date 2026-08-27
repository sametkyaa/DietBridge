import type { Cell } from 'write-excel-file/browser';
import { getDateKeyInTimeZone, REPORTING_TIME_ZONE } from '../../../shared/utils/dateContract';
import type { Client } from '../../../shared/types';
import { CLIENT_EXPORT_HEADERS, mapClientsToExportRows } from '../utils/clientExport';

export const getClientExportFileName = (now: Date = new Date()): string => (
  `DietBridge_Danisanlar_${getDateKeyInTimeZone(now, REPORTING_TIME_ZONE)}.xlsx`
);

const exportHeaderRow: Cell[] = CLIENT_EXPORT_HEADERS.map((value) => ({
  value,
  fontWeight: 'bold',
  backgroundColor: '#0f766e',
  textColor: '#ffffff',
  align: 'center',
  wrap: true,
}));

export const exportClientsToXlsx = async (
  clients: readonly Client[],
  now: Date = new Date(),
): Promise<void> => {
  if (clients.length === 0) return;

  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const sheetData: Cell[][] = [exportHeaderRow, ...mapClientsToExportRows(clients)];
  await writeXlsxFile(sheetData, {
    sheet: 'Danışanlar',
    columns: [
      { width: 24 },
      { width: 30 },
      { width: 18 },
      { width: 24 },
      { width: 18 },
      { width: 18 },
      { width: 24 },
      { width: 24 },
    ],
    orientation: 'landscape',
    stickyRowsCount: 1,
    showGridLines: false,
  }).toFile(getClientExportFileName(now));
};

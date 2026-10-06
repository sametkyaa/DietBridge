import type { Cell } from 'write-excel-file/browser';
import { getDateKeyInTimeZone, REPORTING_TIME_ZONE } from '../../../shared/utils/dateContract';
import type { ExportSheet } from '../utils/analyticsInsights';

const safeFileSegment = (value: string): string => (
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'Danisan'
);

export const getAnalyticsExportFileName = (clientName: string, now: Date = new Date()): string => (
  `DietBridge_Analiz_${safeFileSegment(clientName)}_${getDateKeyInTimeZone(now, REPORTING_TIME_ZONE)}.xlsx`
);

const toCell = (value: string | number | null, header: boolean): Cell => (
  header
    ? { value: value ?? '', fontWeight: 'bold', backgroundColor: '#1F5C3F', textColor: '#ffffff', wrap: true }
    : { value: value ?? '', wrap: true }
);

/** Writes the already-formatted screen values; nothing is recalculated here. */
export const exportAnalyticsToXlsx = async (
  clientName: string,
  sheets: readonly ExportSheet[],
  now: Date = new Date(),
): Promise<void> => {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  await writeXlsxFile(sheets.map((sheet) => ({
    sheet: sheet.name,
    data: sheet.rows.map((row, index) => row.map((cell) => toCell(cell, sheet.name === 'Özet' ? index === 3 : index === 0))),
    columns: Array.from({ length: Math.max(...sheet.rows.map((row) => row.length), 1) }, (_, index) => ({ width: index === 0 ? 30 : 16 })),
    showGridLines: false,
  }))).toFile(getAnalyticsExportFileName(clientName, now));
};

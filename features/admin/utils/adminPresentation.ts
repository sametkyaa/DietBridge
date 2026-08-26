export const formatAdminDate = (value: string | null): string => {
  if (!value) return 'Belirtilmemiş';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Belirtilmemiş';
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

export const formatAdminNumber = (value: number): string => new Intl.NumberFormat('tr-TR').format(value);

export type ClassValue = string | false | null | undefined;

/** Birleştirilen sınıf adlarından boş/false değerleri ayıklar. */
export const cx = (...values: ClassValue[]): string => values.filter(Boolean).join(' ');

/**
 * Minimal, safe note formatting. Notes are stored as plain text; this parser
 * only recognises "**bold**", "- item" / "• item" bullets and "1. item"
 * numbered lines. The result is rendered as React text nodes, so HTML in a
 * note is shown literally and never executed.
 */
export type NoteInline = { text: string; bold: boolean };
export type NoteBlock =
  | { kind: 'paragraph'; lines: NoteInline[][] }
  | { kind: 'bullets'; items: NoteInline[][] }
  | { kind: 'numbers'; items: NoteInline[][] };

export const parseNoteInline = (line: string): NoteInline[] => {
  const parts: NoteInline[] = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) parts.push({ text: line.slice(last, match.index), bold: false });
    parts.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last), bold: false });
  return parts.length ? parts : [{ text: '', bold: false }];
};

const BULLET = /^\s*[-•*]\s+(.*)$/;
const NUMBER = /^\s*\d{1,3}[.)]\s+(.*)$/;

export const parseNoteContent = (content: string): NoteBlock[] => {
  const blocks: NoteBlock[] = [];
  const push = (kind: NoteBlock['kind'], value: NoteInline[]) => {
    const last = blocks[blocks.length - 1];
    if (kind === 'paragraph') {
      if (last?.kind === 'paragraph') last.lines.push(value);
      else blocks.push({ kind, lines: [value] });
      return;
    }
    if (last?.kind === kind) last.items.push(value);
    else blocks.push({ kind, items: [value] } as NoteBlock);
  };
  let previousBlank = true;
  for (const rawLine of content.replace(/\r\n?/g, '\n').split('\n')) {
    if (!rawLine.trim()) { previousBlank = true; continue; }
    const bullet = BULLET.exec(rawLine);
    const number = bullet ? null : NUMBER.exec(rawLine);
    if (bullet) push('bullets', parseNoteInline(bullet[1]));
    else if (number) push('numbers', parseNoteInline(number[1]));
    else if (previousBlank) blocks.push({ kind: 'paragraph', lines: [parseNoteInline(rawLine)] });
    else push('paragraph', parseNoteInline(rawLine));
    previousBlank = false;
  }
  return blocks;
};

/** Plain preview without markers, for list cards. */
export const stripNoteFormatting = (content: string): string => (
  content.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^\s*(?:[-•*]|\d{1,3}[.)])\s+/gm, '')
);

import { Fragment } from 'react';
import { parseNoteContent, type NoteInline } from '../utils/noteFormat';

const Inline = ({ parts }: { parts: NoteInline[] }) => (
  <>
    {parts.map((part, index) => (
      <Fragment key={index}>{part.bold ? <strong className="font-semibold text-ink">{part.text}</strong> : part.text}</Fragment>
    ))}
  </>
);

/** Renders a note's plain text with the safe formatting subset; never injects HTML. */
export const NoteContent = ({ content }: { content: string }) => (
  <div className="flex flex-col gap-3 break-words text-15 leading-7 text-ink-2">
    {parseNoteContent(content).map((block, index) => (
      <Fragment key={index}>
        {block.kind === 'paragraph' ? (
          <p className="m-0">
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>{lineIndex > 0 && <br />}<Inline parts={line} /></Fragment>
            ))}
          </p>
        ) : block.kind === 'bullets' ? (
          <ul className="m-0 list-disc space-y-1 pl-5">
            {block.items.map((item, itemIndex) => <li key={itemIndex}><Inline parts={item} /></li>)}
          </ul>
        ) : (
          <ol className="m-0 list-decimal space-y-1 pl-5">
            {block.items.map((item, itemIndex) => <li key={itemIndex}><Inline parts={item} /></li>)}
          </ol>
        )}
      </Fragment>
    ))}
  </div>
);

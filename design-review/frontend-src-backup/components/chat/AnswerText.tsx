import { Fragment } from "react";

/** Job codes are how people refer to work out loud ("what's happening on
 * KM-1052"), so the bot is told to quote them — and here they become
 * clickable, opening the same inspector the pipeline table opens. An answer
 * you can act on beats an answer you have to go and look up. */
const JOB_CODE = /\b(KM-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\b/g;

interface AnswerTextProps {
  text: string;
  onJobCode?: (code: string) => void;
}

export function AnswerText({ text, onJobCode }: AnswerTextProps) {
  return (
    <>
      {text.split("\n").map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {lineIndex > 0 && <br />}
          {renderLine(line, onJobCode)}
        </Fragment>
      ))}
    </>
  );
}

function renderLine(line: string, onJobCode?: (code: string) => void) {
  if (!onJobCode) return line;

  const parts = line.split(JOB_CODE);
  return parts.map((part, index) =>
    // split() with one capture group puts the matches at odd indexes.
    index % 2 === 1 ? (
      <button
        key={index}
        type="button"
        onClick={() => onJobCode(part)}
        className="mx-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-pill)] px-1 font-mono text-[0.9em] font-semibold text-[var(--primary-light)] hover:border-[var(--primary)]"
      >
        {part}
      </button>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

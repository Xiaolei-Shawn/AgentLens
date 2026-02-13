import { useEffect, useCallback } from "react";
import { createTwoFilesPatch } from "diff";
import { getRevisionsForFile } from "../lib/fileEvolution";
import type { Session } from "../types/session";

import "./FileEvolutionView.css";

interface FileEvolutionViewProps {
  session: Session;
  path: string;
  revisionIndex: number;
  onRevisionChange: (index: number) => void;
}

function StaticDiff({
  oldContent,
  newContent,
  path,
  animate = false,
}: {
  oldContent: string;
  newContent: string;
  path: string;
  animate?: boolean;
}) {
  const patch = createTwoFilesPatch(path, path, oldContent || "", newContent || "", "before", "after");
  const lines = patch.split("\n").slice(5);

  return (
    <pre className={`evolution-diff-block ${animate ? "evolution-diff-animate" : ""}`}>
      {lines.map((line, i) => {
        const isAdd = line.startsWith("+") && !line.startsWith("+++");
        const isRemove = line.startsWith("-") && !line.startsWith("---");
        const className = isAdd ? "diff-add" : isRemove ? "diff-remove" : "";
        return (
          <div key={i} className={className ? `evolution-diff-line ${className}` : "evolution-diff-line"}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function FileEvolutionView({
  session,
  path,
  revisionIndex,
  onRevisionChange,
}: FileEvolutionViewProps) {
  const revisions = getRevisionsForFile(session, path);
  const total = revisions.length;
  const prevRevision = revisionIndex > 0 ? revisions[revisionIndex - 1] : null;

  const goPrev = useCallback(() => {
    if (revisionIndex > 0) onRevisionChange(revisionIndex - 1);
  }, [revisionIndex, onRevisionChange]);

  const goNext = useCallback(() => {
    if (revisionIndex < total - 1) onRevisionChange(revisionIndex + 1);
  }, [revisionIndex, total, onRevisionChange]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goPrev, goNext]);

  if (total === 0) {
    return (
      <div className="file-evolution-view">
        <p className="evolution-empty">No revisions for this file.</p>
      </div>
    );
  }

  const safeIndex = Math.max(0, Math.min(revisionIndex, total - 1));
  const current = revisions[safeIndex];

  return (
    <div className="file-evolution-view">
      <header className="evolution-header">
        <h2 className="evolution-path">{path}</h2>
        <div className="evolution-nav">
          <button
            type="button"
            className="evolution-nav-btn"
            onClick={goPrev}
            disabled={safeIndex === 0}
            aria-label="Previous revision"
          >
            ← Prev
          </button>
          <span className="evolution-index">
            Revision {safeIndex + 1} / {total}
          </span>
          <button
            type="button"
            className="evolution-nav-btn"
            onClick={goNext}
            disabled={safeIndex === total - 1}
            aria-label="Next revision"
          >
            Next →
          </button>
        </div>
      </header>

      <div className="evolution-content">
        {current.type === "delete" ? (
          <div className="evolution-deleted">
            <p>File was deleted at this revision.</p>
            {current.oldContent != null && (
              <pre className="evolution-code-block">{current.oldContent}</pre>
            )}
          </div>
        ) : (
          <>
            {prevRevision != null && current.content !== undefined && (
              <section className="evolution-diff-section">
                <h3 className="evolution-section-title">Diff from previous</h3>
                <StaticDiff
                  oldContent={
                    current.type === "edit" ? (current.oldContent ?? "") : ""
                  }
                  newContent={current.content}
                  path={path}
                  animate
                />
              </section>
            )}
            <section className="evolution-code-section">
              <h3 className="evolution-section-title">Content at this revision</h3>
              <pre className="evolution-code-block evolution-code-animate">
                {current.content ?? ""}
              </pre>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

import { getChangedFiles } from "../lib/fileEvolution";
import type { Session } from "../types/session";

import "./ChangedFilesList.css";

interface ChangedFilesListProps {
  session: Session;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

export function ChangedFilesList({
  session,
  selectedPath,
  onSelectFile,
}: ChangedFilesListProps) {
  const paths = getChangedFiles(session);

  if (paths.length === 0) {
    return (
      <div className="changed-files-list">
        <h2 className="panel-title">Changed files</h2>
        <p className="panel-empty">No file changes in this session.</p>
      </div>
    );
  }

  return (
    <div className="changed-files-list">
      <h2 className="panel-title">Changed files</h2>
      <ul className="changed-files-ul" role="list">
        {paths.map((path) => (
          <li key={path}>
            <button
              type="button"
              className={`changed-file-btn ${selectedPath === path ? "selected" : ""}`}
              onClick={() => onSelectFile(path)}
              title={path}
            >
              <span className="changed-file-name">{path.split("/").pop() ?? path}</span>
              <span className="changed-file-path">{path}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { isPinned, useStore } from '../store';

// In-session board switcher. Click a name to switch to it. The active board's name is an
// input, so renaming happens in place, except on the gallery's pinned boards. Hover a board
// to delete it, or start a new one.
export function BoardBar() {
  const boards = useStore((s) => s.boards);
  const activeId = useStore((s) => s.activeBoardId);
  const boardName = useStore((s) => s.boardName);
  const setBoardName = useStore((s) => s.setBoardName);
  const switchBoard = useStore((s) => s.switchBoard);
  const newBoard = useStore((s) => s.newBoard);
  const deleteBoard = useStore((s) => s.deleteBoard);

  return (
    <div className="boardbar">
      {boards.map((b) => {
        const active = b.id === activeId;
        const label = b.name.trim() || 'Untitled';
        return (
          <span key={b.id} className={`board-item ${active ? 'active' : ''}`}>
            {active && isPinned(b.id) ? (
              // Pinned boards keep their names, so the active one is a label, not a field.
              <span className="board-name board-name-fixed">{label}</span>
            ) : active ? (
              <input
                className="board-name"
                type="text"
                value={boardName}
                placeholder="Untitled"
                aria-label="Board name"
                title="Rename board"
                // Fallback width for browsers without field-sizing: content.
                size={Math.max(6, (boardName || 'Untitled').length)}
                onChange={(e) => setBoardName(e.target.value)}
              />
            ) : (
              <button className="board-link" onClick={() => switchBoard(b.id)}>
                {label}
              </button>
            )}
            {boards.length > 1 && !isPinned(b.id) && (
              // A corner badge over the board, so it takes no space until it's needed.
              <button
                className="board-del"
                onClick={() => deleteBoard(b.id)}
                title="Delete board"
                aria-label={`Delete ${label}`}
              >
                ×
              </button>
            )}
          </span>
        );
      })}
      <button className="board-new" onClick={newBoard} title="New board" aria-label="New board">
        +
      </button>
    </div>
  );
}

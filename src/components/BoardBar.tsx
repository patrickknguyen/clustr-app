import { useStore } from '../store';

// In-session board switcher: click a name to switch, delete a board, or start a new one.
export function BoardBar() {
  const boards = useStore((s) => s.boards);
  const activeId = useStore((s) => s.activeBoardId);
  const switchBoard = useStore((s) => s.switchBoard);
  const newBoard = useStore((s) => s.newBoard);
  const deleteBoard = useStore((s) => s.deleteBoard);

  return (
    <div className="boardbar">
      {boards.map((b) => {
        const label = b.name.trim() || 'Untitled';
        return (
          <span key={b.id} className={`board-item ${b.id === activeId ? 'active' : ''}`}>
            <button
              className={`board-link ${b.id === activeId ? 'active' : ''}`}
              onClick={() => switchBoard(b.id)}
            >
              {label}
            </button>
            {boards.length > 1 && (
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

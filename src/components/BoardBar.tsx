import { useStore } from '../store';

/** In-session board switcher: click to switch, "+ new" to start a fresh board. */
export function BoardBar() {
  const boards = useStore((s) => s.boards);
  const activeId = useStore((s) => s.activeBoardId);
  const switchBoard = useStore((s) => s.switchBoard);
  const newBoard = useStore((s) => s.newBoard);

  return (
    <div className="boardbar">
      <span className="boardbar-label">boards:</span>
      {boards.map((b) => (
        <button
          key={b.id}
          className={`board-link ${b.id === activeId ? 'active' : ''}`}
          onClick={() => switchBoard(b.id)}
        >
          {b.name.trim() || 'untitled'}
        </button>
      ))}
      <button className="board-new" onClick={newBoard} title="New board">
        + new
      </button>
    </div>
  );
}

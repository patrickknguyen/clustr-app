import { useStore } from '../store';

export function SampleBar() {
  const samples = useStore((s) => s.samples);
  const loadSample = useStore((s) => s.loadSample);

  if (samples.length === 0) return null;

  // Board ids follow a "theme[-curator]" convention; show just the theme.
  const label = (id: string) => id.split('-')[0];

  return (
    <div className="samplebar">
      <span className="samplebar-label">samples:</span>
      {samples.map((id) => (
        <button key={id} className="sample-link" onClick={() => loadSample(id)}>
          {label(id)}
        </button>
      ))}
    </div>
  );
}

// The sidebar's update icon: shown only when a newer Penumbra is out (and not skipped), or while the
// Updates tab is open. Clicking it opens the Updates tab.
import { ArrowUpCircle } from './icons';
import { updateWaiting, useUpdates } from '../updates';

export function UpdateButton({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const s = useUpdates();
  const waiting = updateWaiting(s);
  if (!waiting && !active) return null;
  return (
    <button className={`rail-btn rail-update ${active ? 'active' : ''}`} onClick={onOpen} title={waiting ? `Penumbra ${s.info?.version} is available` : 'Updates'}>
      <ArrowUpCircle size={19} />
      {waiting && <span className="rail-dot still" />}
    </button>
  );
}

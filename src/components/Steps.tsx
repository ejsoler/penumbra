import { useState } from 'react';
import type { Step } from '../agents/engine';
import { Ban, ChevronRight, CircleAlert, CircleCheck, Loader2, Wrench } from './icons';

/** A skill shows up only once it has actually loaded: not while the model is asking, and not if it was turned down. */
export const visibleSteps = (steps: Step[]) => steps.filter((s) => s.tool !== 'load_skill' || s.status === 'done' || s.status === 'error');

/** The tools a reply used, in order. Each one opens to show what it returned. */
export function Steps({ steps }: { steps: Step[] }) {
  const shown = visibleSteps(steps);
  if (!shown.length) return null;
  return (
    <div className="steps">
      {shown.map((s) => <StepRow key={s.id} step={s} />)}
    </div>
  );
}

function StepRow({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const Icon = step.status === 'running' ? Loader2 : step.status === 'error' ? CircleAlert : step.status === 'declined' ? Ban : CircleCheck;
  return (
    <div className={`step ${step.status} ${open ? 'open' : ''}`}>
      <button className="step-head" onClick={() => setOpen(!open)} disabled={step.status === 'running'}>
        <Icon size={13} className={step.status === 'running' ? 'spin' : ''} />
        <Wrench size={12} className="muted" />
        <span className="step-label">{step.label}</span>
        {step.summary && <span className="step-summary mono">{step.summary}</span>}
        {step.status === 'declined' && <span className="step-tag">declined</span>}
        {step.status !== 'running' && <ChevronRight size={13} className="chev" />}
      </button>
      {open && (
        <div className="step-body">
          {Object.keys(step.args).length > 0 && <pre className="step-args">{JSON.stringify(step.args, null, 2)}</pre>}
          <pre className="step-result">{step.result}</pre>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import ScenarioSelector from './ScenarioSelector.jsx';
import SchedulerSelector from './SchedulerSelector.jsx';

const SPEEDS = ['0.5×', '1×', '2×', '5×'];

function Button({ children, onClick, primary }) {
  return (
    <button
      onClick={onClick}
      className={`text-[13px] font-medium px-3.5 py-1.5 rounded-lg cursor-pointer ${
        primary
          ? 'border-none bg-blue-500 text-white'
          : 'border border-slate-200 bg-transparent text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}

export default function SimulationControls({ running, scenario, setScenario, scenarioOptions, selectedSchedulerId, setSelectedSchedulerId, schedulerOptions, actions }) {
  const [speed, setSpeed] = useState('1×');
  const [seed, setSeed] = useState(42);

  return (
    <aside className="flex flex-col gap-4 h-full">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">⚙️</span>
          <h3 className="text-[13px] font-semibold m-0 uppercase tracking-[0.5px] text-slate-600">
            Simulation Controls
          </h3>
        </div>
        
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">Scenario</label>
            <ScenarioSelector 
              scenario={scenario} 
              onChange={(newScenario) => {
                setScenario(newScenario);
                actions.restart(newScenario, selectedSchedulerId, seed, speed.replace('×', 'x'), running);
              }} 
              options={scenarioOptions} 
            />
          </div>
          
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">Algorithm</label>
            <SchedulerSelector 
              selectedId={selectedSchedulerId} 
              onChange={(newSchedulerId) => {
                setSelectedSchedulerId(newSchedulerId);
                actions.restart(scenario, newSchedulerId, seed, speed.replace('×', 'x'), running);
              }} 
              options={schedulerOptions} 
            />
          </div>
          
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500">Seed</label>
            <input 
              type="number" 
              value={seed} 
              onChange={e => setSeed(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-lg bg-slate-50 text-slate-900 text-[13px] w-full box-border focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-2 gap-2">
          {!running ? (
            <Button primary onClick={() => actions.start(speed.replace('×', 'x'), Number(seed))}>▶ Start</Button>
          ) : (
            <Button onClick={actions.pause}>⏸ Pause</Button>
          )}
          <Button onClick={actions.reset}>↺ Reset</Button>
          <Button onClick={actions.stop}>⏹ Stop</Button>
          <Button onClick={actions.step}>⏭ Step</Button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-500 mt-1">Execution Speed</label>
          <div className="flex border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-0.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSpeed(s);
                  if (actions.setSpeed) actions.setSpeed(s.replace('×', 'x'));
                }}
                className={`flex-1 text-[12px] py-1 border-none rounded-md cursor-pointer transition-colors ${
                  speed === s
                    ? 'bg-white text-blue-600 font-semibold shadow-sm'
                    : 'bg-transparent text-slate-500 font-medium hover:text-slate-900 hover:bg-slate-200/50'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

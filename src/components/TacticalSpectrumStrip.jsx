import React from 'react';

export default function TacticalSpectrumStrip({ state }) {
  // Hardcoded to 110 to 690 MHz as requested
  const bands = Array.from({ length: 30 }, (_, i) => 110 + i * 20);

  // Get the most recent scan to determine if there was a hit
  const lastScan = state.scanHistory && state.scanHistory.length > 0
    ? state.scanHistory[state.scanHistory.length - 1]
    : null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-4 md:px-5 py-3 flex flex-col gap-2.5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[18px] shrink-0">📡</span>
          <span className="text-sm md:text-[15px] font-bold text-slate-600 tracking-[0.5px] uppercase leading-none mt-0.5">
            TACTICAL SPECTRUM STRIP <span className="hidden sm:inline">({bands.length} CHANNELS • {Math.min(...bands)} MHz — {Math.max(...bands)} MHz)</span>
          </span>
        </div>

        {/* Legends */}
        <div className="flex flex-wrap gap-3 md:gap-4 text-xs text-slate-600">
          <div className="flex items-center gap-1.5 text-[12px] md:text-[13px] font-medium">
            <div className="w-3.5 h-3.5 bg-blue-500 rounded-[3px] shadow-[0_0_6px_rgba(59,130,246,0.5)] shrink-0"></div>
            Tuned
          </div>
          <div className="flex items-center gap-1.5 text-[12px] md:text-[13px] font-medium">
            <div className="w-3.5 h-3.5 border-2 border-dashed border-amber-500 rounded-[3px] shrink-0"></div>
            Next Target
          </div>
          <div className="flex items-center gap-1.5 text-[12px] md:text-[13px] font-medium">
            <div className="w-3.5 h-3.5 bg-green-500 rounded-[3px] shadow-[0_0_6px_rgba(16,185,129,0.5)] shrink-0"></div>
            Signal Hit
          </div>
          <div className="flex items-center gap-1.5 text-[12px] md:text-[13px] font-medium">
            <div className="w-3.5 h-3.5 bg-red-500 rounded-[3px] shadow-[0_0_6px_rgba(239,68,68,0.5)] shrink-0"></div>
            Truth
          </div>
        </div>
      </div>

      {/* Strip */}
      <div className="flex gap-1 overflow-x-auto overflow-y-hidden pb-2 hide-scrollbar">
        {bands.map((freq, i) => {
          const isTuned = state.currentFrequency === freq;
          const isNext = state.predictedFrequency === freq;
          const isHit = lastScan && lastScan.freq === freq && lastScan.result === 'hit';

          // Emitter truth is not explicitly in state for the frontend, but we support rendering it
          // if it ever gets added. (Mocking for B10 / 310 MHz as seen in the original screenshot if it's the demo)
          const isTruth = state.emitterTruths?.includes(freq) || (state.source === 'demo' && freq === 310);

          let borderClass = 'border border-slate-400';
          let bgClass = 'bg-slate-50';
          let numColorClass = 'text-slate-400';
          let shadowClass = '';

          if (isHit) {
            bgClass = 'bg-green-500/15';
            borderClass = 'border-2 border-solid border-green-500';
            numColorClass = 'text-green-500';
            shadowClass = 'shadow-[0_0_12px_rgba(16,185,129,0.2)]';
          } else if (isTuned) {
            bgClass = 'bg-blue-500/15';
            borderClass = 'border-2 border-solid border-blue-500';
            numColorClass = 'text-blue-500';
            shadowClass = 'shadow-[0_0_12px_rgba(59,130,246,0.2)]';
          }

          // Next target outline overlaps the existing background
          if (isNext) {
            borderClass = 'border-2 border-dashed border-amber-500';
            numColorClass = 'text-amber-500';
          }

          return (
            <div key={i} className={`box-border flex-1 min-w-0 h-[44px] rounded flex flex-col justify-center items-center gap-0.5 relative ${borderClass} ${bgClass} ${shadowClass}`}>
              <span className="text-[9px] font-semibold text-slate-600 leading-none mt-0.5">B{i}</span>
              <span className={`mono text-xs font-bold tracking-[-0.5px] ${numColorClass}`}>{freq}</span>

              {/* Emitter Truth Dot */}
              {isTruth && (
                <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-red-500 rounded-full shadow-[0_0_0_3px_#FFFFFF,0_0_8px_rgba(239,68,68,0.8)]" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

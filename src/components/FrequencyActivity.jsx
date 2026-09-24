import { useEffect, useRef, useState, useCallback } from 'react';
import { FREQ_BIN_TABLE } from '../utils/demoData.js';

const COLORS = {
  grid: '#EEF2F7',
  axis: '#CBD5E1',
  axisText: '#64748B',
  trajectory: '#94A3B8',
  hit: '#16A34A',
  miss: '#94A3B8',
  falseAlarm: '#DC2626',
  predicted: '#D97706',
  truth: '#EF4444',
};

function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 800, height: 320 });
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setSize({ width, height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

export default function FrequencyActivity({ scanHistory, predictedFrequency, bandsMhz }) {
  const [containerRef, size] = useElementSize();
  const canvasRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [showTruth, setShowTruth] = useState(false);

  // Use dynamic bands but cap the graph at 790MHz max
  let freqValues = bandsMhz && bandsMhz.length > 0 ? bandsMhz : FREQ_BIN_TABLE.map((b) => b.freq);
  freqValues = freqValues.filter(f => f <= 790);
  const minFreq = Math.min(...freqValues);
  const maxFreq = Math.max(...freqValues);

  const padding = { top: 16, right: 24, bottom: 28, left: 52 };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = size;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const plotH = height - padding.top - padding.bottom;

    const history = scanHistory || [];
    let tMin = history.length > 0 ? history[0].t : 0;
    let tMax = history.length > 0 ? history[history.length - 1].t + 1 : 10;

    // Enforce a minimum time window so points don't stretch across the whole graph on restart
    const MIN_WINDOW = 40;
    if (tMax - tMin < MIN_WINDOW) {
      tMax = tMin + MIN_WINDOW;
    }

    const pixelsPerStep = 15;
    const computedWidth = Math.max(width, (tMax - tMin) * pixelsPerStep + padding.left + padding.right);
    
    canvas.width = computedWidth * dpr;
    canvas.style.width = `${computedWidth}px`;
    const plotW = computedWidth - padding.left - padding.right;

    const xForT = (t) => padding.left + ((t - tMin) / (tMax - tMin)) * plotW;
    const yForFreq = (f) => padding.top + (1 - (f - minFreq) / (maxFreq - minFreq)) * plotH;

    const labelStep = Math.max(1, Math.ceil(freqValues.length / 8));

    // grid lines (frequency bins)
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    freqValues.forEach((f, i) => {
      // Draw grid line on the step, OR the first/last item
      if (i % labelStep !== 0 && i !== freqValues.length - 1 && i !== 0) return;
      
      // If it's the last item, don't draw it if it's too close to the previous step (e.g. index 44 and 42)
      if (i === freqValues.length - 1 && (i % labelStep) < 3) return;

      const y = yForFreq(f);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(computedWidth - padding.right, y);
      ctx.stroke();
    });

    // baseline axis
    ctx.strokeStyle = COLORS.axis;
    ctx.beginPath();
    ctx.moveTo(padding.left, height - padding.bottom);
    ctx.lineTo(computedWidth - padding.right, height - padding.bottom);
    ctx.stroke();

    if (history.length > 0) {
      // emitter truth (drawn first so it stays behind scan markers)
      if (showTruth) {
        ctx.fillStyle = COLORS.truth;
        history.forEach((pt) => {
          if (pt.groundTruth && pt.groundTruth.length > 0) {
            const x = xForT(pt.t);
            pt.groundTruth.forEach((emitter) => {
              const y = yForFreq(emitter.frequency_mhz);
              ctx.beginPath();
              // small distinct marker
              ctx.arc(x, y, 4.0, 0, Math.PI * 2);
              ctx.shadowColor = COLORS.truth;
              ctx.shadowBlur = 6;
              ctx.fill();
              ctx.shadowBlur = 0;
            });
          }
        });
      }

      // trajectory line
      ctx.strokeStyle = COLORS.trajectory;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      history.forEach((pt, i) => {
        const x = xForT(pt.t);
        const y = yForFreq(pt.freq);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // scan markers
      history.forEach((pt) => {
        const x = xForT(pt.t);
        const y = yForFreq(pt.freq);
        const color =
          pt.result === 'hit' ? COLORS.hit : pt.result === 'false_alarm' ? COLORS.falseAlarm : COLORS.miss;
        ctx.beginPath();
        ctx.arc(x, y, pt.result === 'hit' ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        if (pt.result === 'hit') {
          ctx.shadowColor = COLORS.hit;
          ctx.shadowBlur = 8;
        } else if (pt.result === 'false_alarm') {
          ctx.shadowColor = COLORS.falseAlarm;
          ctx.shadowBlur = 6;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // predicted next marker — placed one step ahead of the last scan
      if (predictedFrequency !== undefined && predictedFrequency !== null) {
        const lastT = history[history.length - 1].t;
        const x = xForT(lastT + 1);
        const y = yForFreq(predictedFrequency);
        ctx.beginPath();
        ctx.moveTo(x, y - 7);
        ctx.lineTo(x + 7, y);
        ctx.lineTo(x, y + 7);
        ctx.lineTo(x - 7, y);
        ctx.closePath();
        ctx.fillStyle = COLORS.predicted;
        ctx.shadowColor = COLORS.predicted;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;

        // dashed connector from last actual point to prediction
        const lastX = xForT(lastT);
        const lastY = yForFreq(history[history.length - 1].freq);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = COLORS.predicted;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }, [scanHistory, predictedFrequency, bandsMhz, size, showTruth]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    if (containerRef.current) {
      const el = containerRef.current;
      const isScrolledToRight = el.scrollWidth - el.clientWidth - el.scrollLeft < 100;
      if (isScrolledToRight || !scanHistory || scanHistory.length <= 1) {
        requestAnimationFrame(() => {
          el.scrollLeft = el.scrollWidth;
        });
      }
    }
  }, [scanHistory]);

  const handleMouseMove = (e) => {
    if (!scanHistory?.length) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const history = scanHistory || [];
    let tMin = history[0].t;
    let tMax = history[history.length - 1].t + 1;
    
    const MIN_WINDOW = 40;
    if (tMax - tMin < MIN_WINDOW) {
      tMax = tMin + MIN_WINDOW;
    }
    
    const pixelsPerStep = 15;
    const computedWidth = Math.max(rect.width, (tMax - tMin) * pixelsPerStep + padding.left + padding.right);

    const plotW = computedWidth - padding.left - padding.right;
    const plotH = rect.height - padding.top - padding.bottom;
    const xForT = (t) => padding.left + ((t - tMin) / (tMax - tMin)) * plotW;
    const yForFreq = (f) => padding.top + (1 - (f - minFreq) / (maxFreq - minFreq)) * plotH;

    let closest = null;
    let closestDist = Infinity;
    history.forEach((pt) => {
      const x = xForT(pt.t);
      const y = yForFreq(pt.freq);
      const d = Math.hypot(x - mx, y - my);
      if (d < closestDist) {
        closestDist = d;
        closest = { ...pt, x, y };
      }
    });

    if (closest && closestDist < 14) {
      setHover({ ...closest, mx, my });
    } else {
      setHover(null);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-1">
        <div>
          <h2 className="text-[14.5px] font-semibold m-0">Frequency activity</h2>
          <p className="text-[12.5px] text-slate-600 mt-[2px] mb-0 mx-0 hidden sm:block">
            Receiver scan history and detected transmissions
          </p>
        </div>
        <div className="flex flex-wrap gap-3 md:gap-3.5 text-xs text-slate-600">
          <LegendDot color={COLORS.hit} label="Intercepted" />
          <LegendDot color={COLORS.miss} label="Miss" />
          <LegendDot color={COLORS.falseAlarm} label="False alarm" />
          <LegendDiamond color={COLORS.predicted} label="Predicted" />
          <Toggle 
            checked={showTruth} 
            onChange={setShowTruth} 
            label="Emitter Truth" 
          />
        </div>
      </div>

      <div className="relative flex-1 min-h-0 flex">
        
        {/* Fixed Y-Axis Overlay */}
        <div className="absolute left-0 top-0 bottom-0 bg-white border-r border-slate-200 pointer-events-none z-10" style={{ width: padding.left }}>
          {freqValues.map((f, i) => {
            const labelStep = Math.max(1, Math.ceil(freqValues.length / 8));
            if (i % labelStep !== 0 && i !== freqValues.length - 1 && i !== 0) return null;
            if (i === freqValues.length - 1 && (i % labelStep) < 3) return null;

            const plotH = size.height - padding.top - padding.bottom;
            const y = padding.top + (1 - (f - minFreq) / (maxFreq - minFreq)) * plotH;
            return (
              <span key={f} className="absolute right-2.5 text-[11px] font-medium text-slate-600" style={{ top: y, transform: 'translateY(-50%)' }}>
                {f}
              </span>
            );
          })}
        </div>

        {/* Scrollable Container */}
        <div ref={containerRef} className="hide-scrollbar flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none]">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHover(null)}
          className="block w-full h-full"
        />
        {hover && (
          <div
            className="absolute bg-slate-900 text-white text-xs rounded-md px-[9px] py-[6px] pointer-events-none leading-snug whitespace-nowrap"
            style={{
              left: Math.min(hover.mx + 12, Math.max(size.width, canvasRef.current.width / (window.devicePixelRatio || 1)) - 130),
              top: Math.max(hover.my - 46, 0),
            }}
          >
            <div className="mono">{hover.freq} MHz · t={hover.t}</div>
            <div className="text-white/75 capitalize">
              {hover.result.replace('_', ' ')}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color, boxShadow: `0 0 6px ${color}80` }} />
      {label}
    </span>
  );
}

function LegendDiamond({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
      <span
        className="w-2.5 h-2.5 inline-block rotate-45"
        style={{
          background: color,
          boxShadow: `0 0 6px ${color}80`
        }}
      />
      {label}
    </span>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer ml-2">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="hidden" />
      <div className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 ${checked ? 'bg-blue-500' : 'bg-slate-400'}`}>
        <div className={`absolute top-[2px] w-3.5 h-3.5 rounded-full bg-white transition-[left] duration-200 shadow-sm ${checked ? 'left-[16px]' : 'left-[2px]'}`} />
      </div>
      {label && <span className={checked ? 'text-slate-900' : 'text-slate-600'}>{label}</span>}
    </label>
  );
}

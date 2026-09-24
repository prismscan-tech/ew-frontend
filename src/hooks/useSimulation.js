import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { useWebSocket } from './useWebSocket.js';
import {
  demoState,
  demoMetrics,
  demoEmitters,
  demoReceiver,
  demoScheduler,
  demoBenchmarks,
} from '../utils/demoData.js';
import { confidenceLabel as computeConfidenceLabel } from '../utils/formatters.js';

const HISTORY_WINDOW = 500;
const RECENT_SCANS_WINDOW = 7;

/**
 * Maps the ML API's real, nested Telemetry payload (see
 * ew-scheduler-backend/src/types/domain.ts for the authoritative shape)
 * onto the flat `state` shape every component in this dashboard already
 * expects. This is the ONLY function that needs to change if their
 * telemetry contract changes - components never see raw telemetry.
 *
 * `prevState` supplies scanHistory/recentScans to append to, since a single
 * telemetry snapshot only carries the CURRENT scan, not the trajectory -
 * that's accumulated client-side across ticks (mirrors how the original
 * demo/event-driven version built up scanHistory incrementally).
 */
function telemetryToState(telemetry, prevState) {
  const pred = telemetry.primary_prediction;
  const detector = telemetry.detector;
  const sys = telemetry.system_status;

  const currentFreq = pred?.current_scan_mhz ?? prevState.currentFrequency;
  const currentBin = pred?.current_scan_bin ?? prevState.currentBin;

  // Determine this tick's scan result for history/timeline purposes.
  // "hit" = detected on the band we were actually scanning; a detection
  // reported at a different frequency than what we scanned would be a
  // false alarm, but their detector only reports one detection per tick
  // tied to the current scan, so any `detected: true` here is a hit.
  const result = detector?.detected ? 'hit' : 'miss';

  const step = sys?.step ?? prevState.timestep;
  const alreadyRecorded = prevState.scanHistory?.length > 0 && prevState.scanHistory[prevState.scanHistory.length - 1]?.t === step;

  const events = telemetry.waterfall_events || [];
  // The ML API might send an array where the latest is at the end. Find the matching step.
  const matchedWaterfall = events.find(e => e.step === step) || events[events.length - 1];
  const groundTruth = matchedWaterfall?.ground_truth || [];

  const baseHistory = prevState.source === 'demo' ? [] : (prevState.scanHistory ?? []);
  let scanHistory;
  if (alreadyRecorded) {
    scanHistory = [...prevState.scanHistory];
    scanHistory[scanHistory.length - 1] = {
      ...scanHistory[scanHistory.length - 1],
      groundTruth: groundTruth.length > 0 ? groundTruth : scanHistory[scanHistory.length - 1].groundTruth
    };
  } else {
    scanHistory = [...baseHistory, { t: step, freq: currentFreq, result, groundTruth }].slice(-HISTORY_WINDOW);
  }

  const baseRecent = prevState.source === 'demo' ? [] : (prevState.recentScans ?? []);
  const recentScans = alreadyRecorded
    ? prevState.recentScans
    : [...baseRecent, { freq: currentFreq, result }].slice(-RECENT_SCANS_WINDOW);

  const confidence = pred ? pred.confidence_pct / 100 : prevState.confidence;

  return {
    source: 'live',
    timestep: step,
    currentFrequency: currentFreq,
    currentBin,
    predictedFrequency: pred?.predicted_next_mhz ?? prevState.predictedFrequency,
    predictedBin: pred?.predicted_next_bin ?? prevState.predictedBin,
    confidence,
    confidenceLabel: pred?.confidence_level
      ? confidenceLevelToLabel(pred.confidence_level)
      : computeConfidenceLabel(confidence ?? 0),
    pattern: telemetry.arbitration?.mode ?? prevState.pattern,
    dwell: prevState.dwell, // not provided by telemetry - retained from prior state
    explanation: telemetry.arbitration?.explanation ?? prevState.explanation,
    // decisionMix: their arbitration reports DDQN vs. Context-Aware weights,
    // not "LSTM vs Context-Aware" as the UI's demo data models it - mapped
    // onto the same {lstm, contextAware} shape the UI already expects since
    // DDQN is the primary learned policy in their production scheduler.
    decisionMix: telemetry.arbitration
      ? { lstm: telemetry.arbitration.ddqn_weight_pct / 100, contextAware: telemetry.arbitration.ca_weight_pct / 100 }
      : prevState.decisionMix,
    qValue: lookupQValue(pred, prevState.qValue),
    scanHistory,
    recentScans,
    activeScenario: telemetry.system_status?.scenario_name ?? prevState.activeScenario,
    bandsMhz: telemetry.bands_mhz ?? prevState.bandsMhz,
  };
}

function confidenceLevelToLabel(level) {
  if (level === 'HIGH') return 'High confidence';
  if (level === 'MEDIUM') return 'Moderate confidence';
  return 'Low confidence';
}

// Prefers the explicit {bin, q_value} pairs in top_predictions (unambiguous)
// over indexing the flat q_values array by bin number, which only works if
// bin IDs happen to equal array positions - true for their current 30-band
// setup, but top_predictions doesn't depend on that assumption holding.
function lookupQValue(pred, fallback) {
  if (!pred) return fallback;
  const match = pred.top_predictions?.find((p) => p.bin === pred.predicted_next_bin);
  if (match) return match.q_value;
  return pred.q_values?.[pred.predicted_next_bin] ?? fallback;
}

/**
 * Maps telemetry.performance (their real, already-computed figures of
 * merit) onto the flat `metrics` shape every component expects.
 * interceptionRateHistory is accumulated client-side, same reasoning as
 * scanHistory above - a single snapshot only has the current rate.
 */
function telemetryToMetrics(telemetry, prevMetrics) {
  const perf = telemetry.performance;
  const arb = telemetry.arbitration;
  const outcome = telemetry.outcome;
  if (!perf) return prevMetrics;

  const step = telemetry.system_status?.step ?? prevMetrics.totalScans;
  const rate = perf.interception_ratio_pct / 100;

  const alreadyRecorded =
    prevMetrics.interceptionRateHistory?.length > 0 &&
    prevMetrics.interceptionRateHistory[prevMetrics.interceptionRateHistory.length - 1]?.t === step;

  const baseIrHistory = prevMetrics.source === 'demo' ? [] : (prevMetrics.interceptionRateHistory ?? []);
  const interceptionRateHistory = alreadyRecorded
    ? prevMetrics.interceptionRateHistory
    : [...baseIrHistory, { t: step, rate }].slice(-HISTORY_WINDOW);

  const baseDecisionHistory = prevMetrics.source === 'demo' ? [] : (prevMetrics.decisionModeHistory ?? []);
  const decisionModeHistory = alreadyRecorded
    ? prevMetrics.decisionModeHistory
    : [
        ...baseDecisionHistory,
        {
          t: step,
          lstm: arb ? arb.ddqn_weight_pct / 100 : 0,
          contextAware: arb ? arb.ca_weight_pct / 100 : 0,
        },
      ].slice(-HISTORY_WINDOW);

  return {
    source: 'live',
    interceptionRate: rate,
    detectionProbability: perf.detection_rate_pct / 100,
    // Not directly provided by telemetry.performance - retained from prior
    // value (or demo fallback) until/unless the ML API exposes it.
    predictionAccuracy: perf.prediction_accuracy ?? prevMetrics.predictionAccuracy,
    averageInterceptTime: perf.average_intercept_time ?? prevMetrics.averageInterceptTime,
    averageReward: perf.average_reward ?? outcome?.reward ?? prevMetrics.averageReward,
    falseAlarmProbability: telemetry.detector?.pfa ?? prevMetrics.falseAlarmProbability,
    sensitivityDbm: telemetry.detector?.sensitivity_dbm ?? prevMetrics.sensitivityDbm ?? -90,
    totalScans: perf.total_scans,
    uniqueEmittersDetected: prevMetrics.uniqueEmittersDetected,
    timeToFirstIntercept: prevMetrics.timeToFirstIntercept,
    interceptionRateHistory,
    decisionModeHistory: prevMetrics.decisionModeHistory,
  };
}

function telemetryToScheduler(telemetry, prevScheduler) {
  const model = telemetry.neural_model;
  const arb = telemetry.arbitration;
  return {
    version: telemetry.system_status?.scheduler_name ?? prevScheduler.version,
    decisionMode: arb?.mode ?? prevScheduler.decisionMode,
    qValues: prevScheduler.qValues, // not in this shape from telemetry; retained
    confidence: telemetry.primary_prediction ? telemetry.primary_prediction.confidence_pct / 100 : prevScheduler.confidence,
    // LSTM internals aren't part of this backend's confirmed telemetry
    // contract - retained from prior/demo value. If/when exposed, wire here.
    hiddenStateEnergy: prevScheduler.hiddenStateEnergy,
    cellStateEnergy: prevScheduler.cellStateEnergy,
    architecture: model?.architecture,
    modelStatus: model?.status,
  };
}

function telemetryToReceiver(telemetry, prevReceiver) {
  const detector = telemetry.detector;
  if (!detector) return prevReceiver;
  return {
    ...prevReceiver,
    centerFrequency: prevReceiver.centerFrequency,
    instantaneousBandwidth: detector.receiver_bandwidth_mhz ?? prevReceiver.instantaneousBandwidth,
    sensitivity: detector.sensitivity_dbm ?? prevReceiver.sensitivity,
    // Pd/Pfa at the receiver level aren't separately exposed - the
    // performance-level detection_rate_pct is the closest analogue and is
    // already surfaced via metrics.detectionProbability in Technical mode's
    // "Scheduler" section; receiver.pd/pfa are left as-is (demo/prior).
  };
}

export function useSimulation() {
  const [state, setState] = useState(demoState);
  const [metrics, setMetrics] = useState(demoMetrics);
  const [emitters, setEmitters] = useState(demoEmitters);
  const [receiver, setReceiver] = useState(demoReceiver);
  const [scheduler, setScheduler] = useState(demoScheduler);
  const [isDemo, setIsDemo] = useState(true);
  const [running, setRunning] = useState(false);
  const [scenario, setScenario] = useState(null);
  const [scenarioOptions, setScenarioOptions] = useState([]);
  const [schedulerOptions, setSchedulerOptions] = useState([]);
  const [selectedSchedulerId, setSelectedSchedulerId] = useState('hybrid_v4');
  const [benchmarks, setBenchmarks] = useState(demoBenchmarks);
  const [realTimeElapsed, setRealTimeElapsed] = useState(0);
  const lastTickRef = useRef(null);
  const sessionIdRef = useRef(null);
  const bootstrapped = useRef(false);

  useEffect(() => {
    let animationFrameId;
    
    const updateTime = () => {
      if (running && sessionIdRef.current) {
        const now = performance.now();
        if (lastTickRef.current) {
          const delta = (now - lastTickRef.current) / 1000;
          setRealTimeElapsed(prev => prev + delta);
        }
        lastTickRef.current = now;
      }
      animationFrameId = requestAnimationFrame(updateTime);
    };
    
    if (running) {
      lastTickRef.current = performance.now();
      animationFrameId = requestAnimationFrame(updateTime);
    } else {
      lastTickRef.current = null;
    }
    
    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [running]);

  // Applies one telemetry payload (from WS relay or a manual step response)
  // to all the derived state slices.
  const applyTelemetry = useCallback((telemetry) => {
    setIsDemo(false);
    setState((prev) => telemetryToState(telemetry, prev));
    setMetrics((prev) => telemetryToMetrics(telemetry, prev));
    setScheduler((prev) => telemetryToScheduler(telemetry, prev));
    setReceiver((prev) => telemetryToReceiver(telemetry, prev));
    if (telemetry.system_status?.state) {
      setRunning(telemetry.system_status.state === 'RUNNING');
    }
  }, []);

  // Relay events from our backend's WebSocket: telemetry ticks plus our
  // own session lifecycle events (session_started/paused/resumed/completed).
  const handleRelayEvent = useCallback(
    (event) => {
      if (!event || !event.type) return;
      switch (event.type) {
        case 'telemetry': {
          // Only apply telemetry for the session we're currently tracking,
          // or any telemetry if we aren't tracking one yet (e.g. someone
          // else on the team started a session from another tab).
          if (!sessionIdRef.current || event.sessionId === sessionIdRef.current || event.sessionId === null) {
            applyTelemetry(event.payload);
          }
          break;
        }
        case 'session_started':
          sessionIdRef.current = event.sessionId;
          setRunning(event.payload?.status !== 'paused');
          break;
        case 'session_paused':
          setRunning(false);
          break;
        case 'session_resumed':
          setRunning(true);
          break;
        case 'session_completed':
          setRunning(false);
          break;
        default:
          break;
      }
    },
    [applyTelemetry]
  );

  const { status } = useWebSocket(handleRelayEvent);

  // Initial bootstrap: load scenario/scheduler catalogs and current
  // telemetry (if a session is already running from elsewhere). If
  // everything fails, we simply keep demo data.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      const [scenarios, schedulers, benchmarkData, telemetry, sessions] = await Promise.all([
        api.getScenarios(),
        api.getSchedulers(),
        api.getBenchmark(),
        api.getCurrentTelemetry(),
        api.listSessions(),
      ]);

      if (Array.isArray(scenarios) && scenarios.length > 0) {
        setScenarioOptions(scenarios.map((s) => ({ id: s.id, name: s.name })));
        setScenario((prev) => prev ?? scenarios[0].id);
      }
      if (Array.isArray(schedulers) && schedulers.length > 0) {
        setSchedulerOptions(schedulers);
      }
      if (benchmarkData && Array.isArray(benchmarkData.scenario_breakdown) && benchmarkData.scenario_breakdown.length > 0) {
        // Left as demoBenchmarks unless/until BenchmarkPanel's expected
        // {scenarios: [{name, values}]} shape is confirmed against the real
        // /api/benchmark response - see README note in the backend repo.
      }

      const activeSession = Array.isArray(sessions)
        ? sessions.find((s) => s.status === 'running' || s.status === 'paused')
        : null;
      // If there is any lingering session from a previous page, clean it up so the UI starts fresh.
      if (activeSession) {
        // End the session to avoid stuck paused state.
        await api.completeSession(activeSession.sessionId);
        sessionIdRef.current = null;
        setRunning(false);
        // Clear accumulated UI state.
        setState((prev) => ({ ...prev, scanHistory: [], recentScans: [] }));
        setMetrics((prev) => ({ ...prev, interceptionRateHistory: [], decisionModeHistory: [] }));
        setRealTimeElapsed(0);
      }

      // Do NOT apply stale telemetry; start from a clean slate.
      // If you need an initial snapshot, it will be received after the new session starts.

    })();
  }, [applyTelemetry]);

  const actions = {
    start: async (initialSpeed = '1x', seed = 42) => {
      if (sessionIdRef.current) {
        const res = await api.resumeSession(sessionIdRef.current);
        if (res) {
          setRunning(true);
          return;
        }
      }
      const schedulerName = selectedSchedulerId;
      const session = await api.startSession(scenario, schedulerName, seed);
      if (session) {
        sessionIdRef.current = session.sessionId;
        setState(prev => ({ ...prev, timestep: 0, scanHistory: [], recentScans: [] }));
        setMetrics(prev => ({ ...prev, totalScans: 0, interceptionRateHistory: [], decisionModeHistory: [] }));
        setRealTimeElapsed(0);
        setRunning(true);
        setIsDemo(false);
        await api.setSpeed(session.sessionId, initialSpeed);
      } else {
        setIsDemo(true);
      }
    },
    pause: async () => {
      setRunning(false);
      if (sessionIdRef.current) await api.pauseSession(sessionIdRef.current);
    },
    stop: async () => {
      setRunning(false);
      if (sessionIdRef.current) await api.completeSession(sessionIdRef.current);
    },
    reset: async () => {
      setRunning(false);
      if (sessionIdRef.current) {
        await api.completeSession(sessionIdRef.current);
        sessionIdRef.current = null;
      }
      setState(prev => ({ ...prev, timestep: 0, scanHistory: [], recentScans: [] }));
      setMetrics(prev => ({ ...prev, totalScans: 0, interceptionRateHistory: [], decisionModeHistory: [] }));
      setRealTimeElapsed(0);
      if (isDemo) {
        setState(demoState);
        setMetrics(demoMetrics);
      }
    },
    step: async () => {
      if (!sessionIdRef.current) return;
      const telemetry = await api.stepSession(sessionIdRef.current, 1);
      if (telemetry) applyTelemetry(telemetry);
    },
    restart: async (newScenario, newScheduler, seed, initialSpeed = '1x', wasRunning = true) => {
      setRunning(false);
      if (sessionIdRef.current) {
        await api.completeSession(sessionIdRef.current);
        sessionIdRef.current = null;
      }
      const startPaused = !wasRunning;
      const session = await api.startSession(newScenario, newScheduler, seed, startPaused);
      if (session) {
        sessionIdRef.current = session.sessionId;
        setState(prev => ({ ...prev, timestep: 0, scanHistory: [], recentScans: [] }));
        setMetrics(prev => ({ ...prev, totalScans: 0, interceptionRateHistory: [], decisionModeHistory: [] }));
        setRealTimeElapsed(0);
        setIsDemo(false);
        await api.setSpeed(session.sessionId, initialSpeed);
        
        setRunning(wasRunning);
      } else {
        setIsDemo(true);
      }
    },
    setSpeed: async (speed) => {
      if (!sessionIdRef.current) return;
      await api.setSpeed(sessionIdRef.current, speed);
    },
  };

  return {
    connectionStatus: status,
    isDemo,
    running,
    state: { ...state, simulationTimeS: isDemo ? state.simulationTimeS : realTimeElapsed },
    metrics,
    emitters,
    receiver,
    scheduler,
    selectedSchedulerId,
    setSelectedSchedulerId,
    schedulerOptions,
    benchmarks,
    scenario,
    setScenario,
    scenarioOptions,
    actions,
  };
}

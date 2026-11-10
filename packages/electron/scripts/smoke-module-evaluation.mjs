export const MODULE_EVALUATION_GLOBAL = '__SKYNEX_SMOKE_MODULES__';

export function instrumentModuleEvaluation(code, name) {
  const record = (phase) => `if (typeof window !== 'undefined' && window === window.top) { const key = ${JSON.stringify(MODULE_EVALUATION_GLOBAL)}; const state = window[key] ||= { started: {}, finished: {} }; state.${phase}[${JSON.stringify(name)}] = performance.now(); }`;
  return `${record('started')}\n${code}\n${record('finished')}\n`;
}

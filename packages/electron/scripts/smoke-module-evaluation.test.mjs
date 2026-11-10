import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { instrumentModuleEvaluation, MODULE_EVALUATION_GLOBAL } from './smoke-module-evaluation.mjs';

test('records completed module execution without changing its result', () => {
  const window = {};
  window.top = window;
  const context = vm.createContext({ window, performance: { now: () => 12 } });
  vm.runInContext(instrumentModuleEvaluation('window.answer = 42;', 'ui/main'), context);
  assert.equal(window.answer, 42);
  assert.equal(window[MODULE_EVALUATION_GLOBAL].started['ui/main'], 12);
  assert.equal(window[MODULE_EVALUATION_GLOBAL].finished['ui/main'], 12);
});

test('retains an unfinished module and propagates its original exception', () => {
  const window = {};
  window.top = window;
  const context = vm.createContext({ window, performance: { now: () => 12 } });
  assert.throws(() => vm.runInContext(instrumentModuleEvaluation('throw new Error("module failed");', 'ui/broken'), context), /module failed/);
  assert.equal(window[MODULE_EVALUATION_GLOBAL].started['ui/broken'], 12);
  assert.equal(window[MODULE_EVALUATION_GLOBAL].finished['ui/broken'], undefined);
});

test('leaves workers and child frames uninstrumented', () => {
  vm.runInNewContext(instrumentModuleEvaluation('globalThis.answer = 42;', 'worker'));
  const window = { top: {} };
  vm.runInNewContext(instrumentModuleEvaluation('window.answer = 42;', 'frame'), { window });
  assert.equal(window.answer, 42);
  assert.equal(window[MODULE_EVALUATION_GLOBAL], undefined);
});

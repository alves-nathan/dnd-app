const {
  createChecklist,
  evaluatePerformance,
  parseAndroidAmStart,
  parseAndroidGfxInfo,
  parseAndroidMeminfo,
  parseJUnitSummary,
  validateChecklist
} = require('../../scripts/lib/mobile-test-session');
const { parseAdbDevices } = require('../../scripts/lib/mobile-tools');

describe('mobile beta session tooling', () => {
  it('parses Maestro JUnit summaries without accepting failed flows', () => {
    const passed = parseJUnitSummary('<testsuites><testsuite tests="7" failures="0" errors="0" skipped="0" /></testsuites>');
    const failed = parseJUnitSummary('<testsuite tests="7" failures="1" errors="0" skipped="0" />');
    expect(passed).toMatchObject({ tests: 7, passed: true });
    expect(failed.passed).toBe(false);
  });

  it('requires explicit manual completion of every checklist entry', () => {
    const checklist = createChecklist('accessibility', 'android', '2026-07-14T12:00:00.000Z');
    expect(validateChecklist(checklist, 'accessibility', 'android').passed).toBe(false);

    const completed = {
      ...checklist,
      status: 'pass',
      reviewer: 'QA local',
      device: 'Pixel 7',
      reviewedAt: '2026-07-14T13:00:00.000Z',
      checks: Object.fromEntries(Object.keys(checklist.checks).map((key) => [key, true]))
    };
    expect(validateChecklist(completed, 'accessibility', 'android')).toEqual({ passed: true, issues: [] });
  });

  it('parses Android start, memory and frame metrics and evaluates limits', () => {
    const start = parseAndroidAmStart('ThisTime: 720\nTotalTime: 940\nWaitTime: 960');
    const memory = parseAndroidMeminfo('TOTAL PSS: 204800\nTOTAL RSS: 250000');
    const frames = parseAndroidGfxInfo('Total frames rendered: 1000\nJanky frames: 20 (2.00%)');
    const result = evaluatePerformance({
      coldStartMs: start.totalTimeMs,
      peakMemoryMb: memory.peakMemoryMb,
      droppedFramesPercent: frames.droppedFramesPercent
    });

    expect(start.totalTimeMs).toBe(940);
    expect(memory.peakMemoryMb).toBe(200);
    expect(frames.droppedFramesPercent).toBe(2);
    expect(result.status).toBe('pass');
  });

  it('recognizes authorized and unauthorized adb devices', () => {
    const devices = parseAdbDevices('List of devices attached\nemulator-5554 device product:sdk\nABC unauthorized usb:1-1\n');
    expect(devices).toEqual([
      { serial: 'emulator-5554', status: 'device', details: 'product:sdk' },
      { serial: 'ABC', status: 'unauthorized', details: 'usb:1-1' }
    ]);
  });
});

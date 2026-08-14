import { describe, expect, it } from "vitest";
import { EscalationCalibration, CALIBRATION_SAMPLE_SIZE } from "../../../src/detection/calibration";

describe("EscalationCalibration", () => {
  it("does not kill before the sample size is reached, even with all no-gain so far", () => {
    const cal = new EscalationCalibration();
    for (let i = 0; i < CALIBRATION_SAMPLE_SIZE - 1; i++) {
      expect(cal.record(false)).toBe(false);
    }
    expect(cal.isKilled).toBe(false);
    expect(cal.stats.samplesRecorded).toBe(CALIBRATION_SAMPLE_SIZE - 1);
  });

  it("kills on exactly the sample-size-th call when the no-gain rate clears 90%", () => {
    const cal = new EscalationCalibration();
    for (let i = 0; i < CALIBRATION_SAMPLE_SIZE - 1; i++) cal.record(false);
    expect(cal.isKilled).toBe(false);
    const tipped = cal.record(false); // 10th sample, 100% no-gain
    expect(tipped).toBe(true);
    expect(cal.isKilled).toBe(true);
    expect(cal.stats).toEqual({ samplesRecorded: CALIBRATION_SAMPLE_SIZE, gainedCount: 0, killed: true });
  });

  it("kills at exactly 90% no-gain (9 of 10 no-gain, 1 gained)", () => {
    const cal = new EscalationCalibration();
    for (let i = 0; i < 9; i++) cal.record(false);
    const tipped = cal.record(true); // 10th sample: 9 no-gain / 10 = 90%
    expect(tipped).toBe(true);
    expect(cal.isKilled).toBe(true);
  });

  it("does NOT kill when the no-gain rate is just under 90% (2 of 10 gained = 80% no-gain)", () => {
    const cal = new EscalationCalibration();
    for (let i = 0; i < 8; i++) cal.record(false);
    cal.record(true);
    const tipped = cal.record(true); // 10th sample: 8 no-gain / 10 = 80%
    expect(tipped).toBe(false);
    expect(cal.isKilled).toBe(false);
  });

  it("ignores further record() calls once killed — stays killed, sample count frozen", () => {
    const cal = new EscalationCalibration();
    for (let i = 0; i < CALIBRATION_SAMPLE_SIZE; i++) cal.record(false);
    expect(cal.isKilled).toBe(true);
    cal.record(true);
    cal.record(true);
    expect(cal.stats.samplesRecorded).toBe(CALIBRATION_SAMPLE_SIZE);
    expect(cal.isKilled).toBe(true);
  });

  it("never kills when every sample gains something", () => {
    const cal = new EscalationCalibration();
    for (let i = 0; i < CALIBRATION_SAMPLE_SIZE; i++) cal.record(true);
    expect(cal.isKilled).toBe(false);
  });
});

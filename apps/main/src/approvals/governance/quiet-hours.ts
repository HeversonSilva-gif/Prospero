import type { QuietHoursSchedule } from "@prospero/shared";

// Pure — no DB, no IPC, no Electron. Time is passed in.
export const isInQuietHours = (now: Date, schedule: QuietHoursSchedule): boolean => {
  if (schedule.windows.length === 0) return false;
  const day = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const w of schedule.windows) {
    if (!w.daysOfWeek.includes(day)) continue;
    if (w.startMinute === w.endMinute) continue;
    if (w.startMinute < w.endMinute) {
      if (nowMin >= w.startMinute && nowMin < w.endMinute) return true;
    } else {
      if (nowMin >= w.startMinute || nowMin < w.endMinute) return true;
    }
  }
  return false;
};

package com.smartclean.app.security;

import android.content.Context;
import android.content.SharedPreferences;

import com.smartclean.app.BuildConfig;

// Enforces the 14-day hard deadline on the `debugbetatest` flavor (BuildConfig.
// IS_TIME_LIMITED_BUILD) — see android/app/build.gradle for how TRIAL_EXPIRY_TIMESTAMP_MS
// is computed (build time + 14 days, baked in at compile time so every tester who gets the
// same APK shares the same deadline instead of it drifting with each install date).
//
// Checked natively (MainActivity), not just from JS: a tester poking the WebView console
// can't extend their own trial by patching app.js.
//
// Clock-rollback guard: a tester could otherwise "reset" the trial by turning the device
// clock back before the expiry date. We remember the highest wall-clock time we've ever
// observed on this install; if the current time is ever meaningfully behind that high-water
// mark, we treat it as tampering and expire immediately rather than trusting the rolled-back
// clock.
public class TrialGuard {

    private static final String PREFS_NAME = "sc_trial";
    private static final String KEY_MAX_SEEN_TIME_MS = "max_seen_time_ms";
    private static final long CLOCK_ROLLBACK_TOLERANCE_MS = 60L * 60 * 1000; // 1 hour slack for timezone/NTP jitter

    private TrialGuard() {}

    public static boolean isTimeLimited() {
        return BuildConfig.IS_TIME_LIMITED_BUILD;
    }

    public static long expiryTimestampMs() {
        return BuildConfig.TRIAL_EXPIRY_TIMESTAMP_MS;
    }

    public static boolean isExpired(Context context) {
        if (!isTimeLimited()) return false;
        long now = System.currentTimeMillis();
        if (clockWasRolledBack(context, now)) return true;
        return now >= BuildConfig.TRIAL_EXPIRY_TIMESTAMP_MS;
    }

    public static long daysRemaining(Context context) {
        if (!isTimeLimited() || isExpired(context)) return 0;
        long msLeft = BuildConfig.TRIAL_EXPIRY_TIMESTAMP_MS - System.currentTimeMillis();
        return Math.max(0, (long) Math.ceil(msLeft / (24.0 * 3600 * 1000)));
    }

    private static boolean clockWasRolledBack(Context context, long now) {
        SharedPreferences prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long maxSeen = prefs.getLong(KEY_MAX_SEEN_TIME_MS, 0L);
        if (now > maxSeen) {
            prefs.edit().putLong(KEY_MAX_SEEN_TIME_MS, now).apply();
            return false;
        }
        return (maxSeen - now) > CLOCK_ROLLBACK_TOLERANCE_MS;
    }
}

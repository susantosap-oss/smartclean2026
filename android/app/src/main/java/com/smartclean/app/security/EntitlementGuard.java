package com.smartclean.app.security;

import android.content.Context;
import android.content.SharedPreferences;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

// Native-side mirror of the Free/Pro rules already enforced in src/js/app.js
// (requirePro()/checkDailyLimit()/PRO_LOCKED_CARDS — see DEVELOP.md Phase 2 for the
// authoritative table). This exists because the JS layer runs inside a WebView a modder
// can patch or hook without ever touching the APK itself — every FileCleanerPlugin/
// AppManagerPlugin method that performs a Pro-gated action re-checks the SAME rule here,
// backed by its own SharedPreferences file (not the WebView's storage), so bypassing the
// JS check alone no longer unlocks anything.
//
// This does not replace real server-verified purchase state (there is no real Google Play
// Billing wired into this branch yet — see DEVELOP.md); it mirrors whatever isPro value JS
// last reported via Security.setEntitlement(). Once real Billing lands, setPro() is the
// natural place to instead require a LicenseVerifier-verified purchase before flipping true.
public class EntitlementGuard {

    private static final String PREFS_NAME = "sc_security";
    private static final String KEY_IS_PRO = "is_pro";
    private static final String KEY_USED_PREFIX = "used_";

    private final SharedPreferences prefs;

    public EntitlementGuard(Context context) {
        this.prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public boolean isPro() {
        return prefs.getBoolean(KEY_IS_PRO, false);
    }

    public void setPro(boolean pro) {
        prefs.edit().putBoolean(KEY_IS_PRO, pro).apply();
    }

    private static String today() {
        // Matches new Date().toISOString().slice(0,10) used on the JS side — not shared
        // storage, just kept in the same format for consistency when comparing logs.
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    public boolean isFeatureUsedToday(String featureKey) {
        return today().equals(prefs.getString(KEY_USED_PREFIX + featureKey, null));
    }

    public void markFeatureUsedToday(String featureKey) {
        prefs.edit().putString(KEY_USED_PREFIX + featureKey, today()).apply();
    }

    // WA subfolder naming convention (see FileCleanerPlugin.getWASubfolder()): "<App>
    // Documents" / "<App> Audio" are Pro-only types (Video/Images stay free) — checked
    // against the actual paths being deleted rather than a client-supplied "type" so a
    // modder can't just lie about which WA tab the files came from.
    private static boolean pathLooksLikeWaDocOrAudio(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        return p.contains("documents/") || p.contains("audio/")
                || p.endsWith("documents") || p.endsWith("audio");
    }

    /**
     * The single decision point every Pro-gated native action must consult before doing
     * anything irreversible. {@code paths} may be null for callers that don't need the
     * WA-specific per-path check (e.g. a scan-gate with no file list yet).
     */
    public boolean isFeatureAllowed(String featureKey, int itemCount, List<String> paths) {
        if (isPro()) return true;

        switch (featureKey) {
            case "telegram":
            case "camera":
            case "unused":
            case "recentlyDeleted":
            case "apk":
            case "screenrec":
                // Hard Pro locks regardless of item count — DEVELOP.md Phase 2 Free table
                // gives these no free-tier delete allowance at all (Telegram has no free
                // tier whatsoever, the rest are free-scan/Pro-delete or fully Pro-locked).
                return false;

            case "bigfile":
            case "download":
                // Free tier: exactly 1 item, once per day.
                return itemCount <= 1 && !isFeatureUsedToday(featureKey);

            case "wa":
                // Free tier: Video/Foto unlimited; Documents/Audio require Pro. Inspect the
                // actual paths rather than trusting a caller-supplied media type.
                if (paths == null) return true;
                for (String p : paths) {
                    if (pathLooksLikeWaDocOrAudio(p)) return false;
                }
                return true;

            default:
                // Not a Pro-gated feature at all (e.g. plain junk/tmp cleanup) — allow.
                return true;
        }
    }
}

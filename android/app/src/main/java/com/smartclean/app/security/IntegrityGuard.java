package com.smartclean.app.security;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.os.Debug;
import android.util.Log;

import java.io.File;
import java.security.MessageDigest;
import java.util.Locale;

// Client-only tamper signals: none of these are a real security boundary on their own (a
// determined reverse engineer can patch around any single check), but together they raise
// the cost of casually cracking the app well above "just decompile and flip a boolean".
// Reporting-only by design here — see SecurityPlugin.runIntegrityChecks() and app.js for
// where (and whether) any of this actually blocks something; these methods only OBSERVE.
public final class IntegrityGuard {

    private static final String TAG = "IntegrityGuard";

    private IntegrityGuard() {}

    public static boolean isDebuggerAttached() {
        return Debug.isDebuggerConnected() || Debug.waitingForDebugger();
    }

    public static boolean isRunningInEmulator() {
        String fingerprint = safe(Build.FINGERPRINT);
        String model = safe(Build.MODEL);
        String manufacturer = safe(Build.MANUFACTURER);
        String hardware = safe(Build.HARDWARE);
        String product = safe(Build.PRODUCT);

        boolean looksLikeEmulator =
                fingerprint.contains("generic") || fingerprint.contains("unknown")
                || model.contains("emulator") || model.contains("android sdk built for")
                || manufacturer.contains("genymotion")
                || hardware.contains("goldfish") || hardware.contains("ranchu") || hardware.contains("vbox")
                || product.contains("sdk") || product.contains("emulator") || product.contains("genymotion");

        if (looksLikeEmulator) return true;

        String[] qemuFiles = { "/dev/socket/qemud", "/dev/qemu_pipe" };
        for (String path : qemuFiles) {
            if (new File(path).exists()) return true;
        }
        return false;
    }

    // Best-effort common-case detection, not exhaustive (root hiding via Magisk Hide/
    // Zygisk can defeat this) — intentionally simple per the scope of this pass.
    public static boolean isDeviceRooted() {
        String[] suPaths = {
                "/system/bin/su", "/system/xbin/su", "/sbin/su",
                "/system/app/Superuser.apk", "/system/app/SuperSU.apk",
                "/system/xbin/daemonsu", "/system/bin/failsafe/su",
                "/data/local/xbin/su", "/data/local/bin/su", "/data/local/su",
        };
        for (String path : suPaths) {
            if (new File(path).exists()) return true;
        }
        if (safe(Build.TAGS).contains("test-keys")) return true;
        return new File("/system").canWrite();
    }

    /**
     * Compares this install's actual signing certificate SHA-256 against the expected
     * value. IMPORTANT: {@code expectedSha256Hex} here is the DEBUG keystore's hash as a
     * PLACEHOLDER (see SecurityPlugin) — it MUST be swapped for the real Play Console
     * "App signing key certificate" SHA-256 before any release build, since Play App
     * Signing re-signs the APK with a different key than your local upload keystore.
     */
    public static boolean verifyAppSignature(Context context, String expectedSha256Hex) {
        try {
            String actual = currentSignatureSha256(context);
            return actual != null && actual.equalsIgnoreCase(expectedSha256Hex.replace(":", ""));
        } catch (Exception e) {
            Log.e(TAG, "verifyAppSignature", e);
            return false;
        }
    }

    private static String currentSignatureSha256(Context context) throws Exception {
        PackageManager pm = context.getPackageManager();
        String pkg = context.getPackageName();
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
            signatures = info.signingInfo.hasMultipleSigners()
                    ? info.signingInfo.getApkContentsSigners()
                    : info.signingInfo.getSigningCertificateHistory();
        } else {
            @SuppressWarnings("deprecation")
            PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES);
            @SuppressWarnings("deprecation")
            Signature[] legacy = info.signatures;
            signatures = legacy;
        }
        if (signatures == null || signatures.length == 0) return null;

        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(signatures[0].toByteArray());
        StringBuilder sb = new StringBuilder(hash.length * 2);
        for (byte b : hash) sb.append(String.format(Locale.US, "%02x", b));
        return sb.toString();
    }

    private static String safe(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT);
    }
}

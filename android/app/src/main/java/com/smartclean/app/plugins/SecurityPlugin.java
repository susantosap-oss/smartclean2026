package com.smartclean.app.plugins;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.smartclean.app.BuildConfig;
import com.smartclean.app.security.EntitlementGuard;
import com.smartclean.app.security.IntegrityGuard;
import com.smartclean.app.security.LicenseVerifier;
import com.smartclean.app.security.Obfuscated;

@CapacitorPlugin(name = "Security")
public class SecurityPlugin extends Plugin {

    // Obfuscated (see Obfuscated.java — a speed bump, not cryptography) placeholder
    // constants. NEITHER is real yet:
    //  - the signature hash is THIS PROJECT'S DEBUG KEYSTORE's cert hash, not a release key
    //    (there is no release keystore yet — see DEVELOP.md Phase 1 checklist).
    //  - the license key is an obviously-fake string, not a real Play Console license key.
    // Both must be replaced before this protects anything in a real release build.
    private static final String SIG_XOR_KEY = "obf_sig_key_2026";
    private static final String OBF_EXPECTED_SIGNATURE_SHA256_DEBUG =
            "XVBQbkpbBmteUkg6UwcFAA1VVmZBDF46CQZAPgMFAQIJWgdsQV4FbFMESjoBCQcOVldfPkYIX2pZBEptB1EGUA==";

    private static final String LICENSE_XOR_KEY = "obf_lic_key_2026";
    private static final String OBF_PLACEHOLDER_LICENSE_PUBLIC_KEY =
            "PSc2Ey0qJgA8LC0XbWJ3dyM9JB4/LFVrNCkwHHd+YXMwKSMGMy8xECY6KRNzaW11ICw1ECAsPBIkKzwLe2pzYiYtKAA/LDcKOzo1FnF1fGUmLCE=";

    // ─── Entitlement mirror (see EntitlementGuard) ────────────────────────────
    @PluginMethod
    public void setEntitlement(PluginCall call) {
        boolean isPro = Boolean.TRUE.equals(call.getBoolean("isPro", false));
        new EntitlementGuard(getContext()).setPro(isPro);
        call.resolve();
    }

    @PluginMethod
    public void markFeatureUsed(PluginCall call) {
        String feature = call.getString("feature");
        if (feature != null) new EntitlementGuard(getContext()).markFeatureUsedToday(feature);
        call.resolve();
    }

    // ─── Tamper signals (see IntegrityGuard) ──────────────────────────────────
    // Reporting only — this plugin does not decide what happens with a "true" result here,
    // the caller does (and per this pass's scope, nothing in app.js currently acts on it
    // destructively; see DEVELOP.md for the enforcement-policy discussion). isDebugBuild/
    // isUnlockedTestBuild are included specifically so any future enforcement logic on the
    // JS side can trivially no-op during development instead of accidentally blocking it.
    @PluginMethod
    public void runIntegrityChecks(PluginCall call) {
        JSObject res = new JSObject();
        res.put("debuggerAttached", IntegrityGuard.isDebuggerAttached());
        res.put("emulator", IntegrityGuard.isRunningInEmulator());
        res.put("rooted", IntegrityGuard.isDeviceRooted());
        res.put("signatureValid", IntegrityGuard.verifyAppSignature(
                getContext(), Obfuscated.decode(OBF_EXPECTED_SIGNATURE_SHA256_DEBUG, SIG_XOR_KEY)));
        res.put("isDebugBuild", BuildConfig.DEBUG);
        res.put("isUnlockedTestBuild", BuildConfig.IS_UNLOCKED_TEST_BUILD);
        call.resolve(res);
    }

    // ─── Local Play Billing purchase signature verification (see LicenseVerifier) ─────
    // Not wired to any real purchase flow yet (no Billing library in this branch) — exists
    // so the utility is ready once one lands. Uses the (fake) placeholder license key above.
    @PluginMethod
    public void verifyPurchaseSignature(PluginCall call) {
        String signedData = call.getString("signedData");
        String signature = call.getString("signature");
        boolean valid = LicenseVerifier.verifyPurchaseSignature(
                signedData, signature, Obfuscated.decode(OBF_PLACEHOLDER_LICENSE_PUBLIC_KEY, LICENSE_XOR_KEY));
        JSObject res = new JSObject();
        res.put("valid", valid);
        call.resolve(res);
    }
}

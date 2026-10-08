package com.smartclean.app.security;

import android.util.Base64;
import android.util.Log;

import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.nio.charset.StandardCharsets;

// Standard local verification of a Google Play Billing Purchase's signature against the
// app's RSA license public key (Play Console → Monetization setup → Licensing) — the same
// pattern Google's own classic Billing sample apps ship (their Security.verifyPurchase()).
//
// NOT WIRED UP TO ANYTHING YET: there is no real Google Play Billing in this branch (see
// DEVELOP.md Phase 2 — isPro is a local test flag, purchasePro() in app.js just flips it
// directly, no BillingManager plugin exists here). This class is preparatory infrastructure
// so that once real Billing lands, verifying a Purchase's signature is a one-line call
// instead of a new feature — it is deliberately not invoked from any live code path.
//
// A local check like this is real, standard protection against a forged/replayed purchase
// object being fed to the app (the public key can only verify, not forge, a signature made
// with Google's private key) — but it is not equivalent to server-side verification via the
// Play Developer API, since a sufficiently determined attacker can in principle extract the
// public key from a decompiled APK (ProGuard + Obfuscated.decode() raise that bar, they
// don't remove it). Treat this as one layer, not the whole story.
public final class LicenseVerifier {

    private static final String TAG = "LicenseVerifier";

    private LicenseVerifier() {}

    public static boolean verifyPurchaseSignature(String signedData, String signature, String base64PublicKey) {
        if (signedData == null || signature == null || base64PublicKey == null) return false;
        try {
            PublicKey key = loadPublicKey(base64PublicKey);
            Signature sig = Signature.getInstance("SHA1withRSA");
            sig.initVerify(key);
            sig.update(signedData.getBytes(StandardCharsets.UTF_8));
            return sig.verify(Base64.decode(signature, Base64.DEFAULT));
        } catch (Exception e) {
            Log.e(TAG, "verifyPurchaseSignature failed", e);
            return false;
        }
    }

    private static PublicKey loadPublicKey(String base64PublicKey) throws Exception {
        byte[] decoded = Base64.decode(base64PublicKey, Base64.DEFAULT);
        KeyFactory keyFactory = KeyFactory.getInstance("RSA");
        return keyFactory.generatePublic(new X509EncodedKeySpec(decoded));
    }
}

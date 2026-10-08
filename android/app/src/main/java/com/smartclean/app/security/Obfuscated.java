package com.smartclean.app.security;

import android.util.Base64;

import java.nio.charset.StandardCharsets;

// Speed bump against casual `strings`/grep static analysis on the compiled DEX — this is
// NOT cryptography and does not resist a determined reverse engineer with a debugger or a
// decompiler that traces the call site; it just stops a sensitive constant (a signature
// hash, a placeholder license key) from sitting as plain, greppable text in the APK.
public final class Obfuscated {

    private Obfuscated() {}

    private static byte[] xor(byte[] data, String key) {
        byte[] keyBytes = key.getBytes(StandardCharsets.UTF_8);
        byte[] out = new byte[data.length];
        for (int i = 0; i < data.length; i++) {
            out[i] = (byte) (data[i] ^ keyBytes[i % keyBytes.length]);
        }
        return out;
    }

    /** Encode a plaintext string at build time (e.g. via a scratch main()/REPL) into the
     *  Base64 blob that gets committed as the source constant. */
    public static String encode(String plaintext, String key) {
        return Base64.encodeToString(xor(plaintext.getBytes(StandardCharsets.UTF_8), key), Base64.NO_WRAP);
    }

    /** Decode at runtime — this is the call every consumer of an obfuscated constant uses. */
    public static String decode(String encodedBase64, String key) {
        byte[] decoded = Base64.decode(encodedBase64, Base64.NO_WRAP);
        return new String(xor(decoded, key), StandardCharsets.UTF_8);
    }
}

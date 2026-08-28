package com.smartclean.app;

import android.Manifest;
import android.app.AppOpsManager;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.view.View;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.smartclean.app.plugins.FileCleanerPlugin;
import com.smartclean.app.plugins.MemoryBoosterPlugin;
import com.smartclean.app.plugins.DuplicateFinderPlugin;
import com.smartclean.app.plugins.AppManagerPlugin;
import com.smartclean.app.plugins.BillingManagerPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FileCleanerPlugin.class);
        registerPlugin(MemoryBoosterPlugin.class);
        registerPlugin(DuplicateFinderPlugin.class);
        registerPlugin(AppManagerPlugin.class);
        registerPlugin(BillingManagerPlugin.class);
        super.onCreate(savedInstanceState);
        requestLegacyStoragePermission();
        setupBackButton();
        setupEdgeToEdgeInsets();
    }

    // targetSdk 35+ forces edge-to-edge — the WebView draws under the status/nav
    // bars by default, so fixed UI (header, bottom-nav) ends up unreachable behind
    // the system nav bar. Padding the content root by the system bar insets restores
    // the pre-35 "boxed" layout; windowBackground (@color/bg) already matches the
    // app's CSS --bg so the reserved strips blend in with no visible seam.
    private void setupEdgeToEdgeInsets() {
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return windowInsets;
        });
    }

    // Each special-access Settings screen is attempted at most ONCE per app process
    // (tracked by these flags), not re-launched on every resume — otherwise a user who
    // opens the screen and presses back without granting would get bounced straight back
    // into it forever. onResume() (rather than onCreate()) is what lets the two prompts
    // run in sequence: the first attempt below returns before touching the second, so
    // the second one only fires on the NEXT resume — i.e. after the user has actually
    // come back from the first Settings screen — instead of both launching back-to-back
    // from onCreate() with no time for the first to appear (confirmed on-device:
    // AppManageExternalStorageActivity took over UsageAccessSettingsActivity ~80ms after
    // it started, fighting for focus).
    private boolean manageStoragePromptShown = false;
    private boolean usageAccessPromptShown   = false;

    @Override
    public void onResume() {
        super.onResume();
        if (!manageStoragePromptShown) {
            manageStoragePromptShown = true;
            if (!requestManageStoragePermission()) return; // Settings screen just launched — sequence the next one on the following resume
        }
        if (!usageAccessPromptShown) {
            usageAccessPromptShown = true;
            requestUsageAccessPermission();
        }
    }

    // Android 6-10 (API 23-29) gate raw filesystem access (Environment.getExternalStorageDirectory())
    // behind the dangerous READ/WRITE_EXTERNAL_STORAGE runtime permission. Without this request the
    // permission stays denied by default, so every scan under external storage (temp files, WhatsApp
    // database backups, junk/ads, orphaned app data) silently returns 0 and "Clean Now" can't delete
    // anything either. Android 11+ uses MANAGE_EXTERNAL_STORAGE instead (requestManageStoragePermission).
    private static final int STORAGE_PERMISSION_REQUEST_CODE = 1001;

    private void requestLegacyStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return;
        boolean readGranted = ContextCompat.checkSelfPermission(this,
                Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
        boolean writeGranted = ContextCompat.checkSelfPermission(this,
                Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
        if (!readGranted || !writeGranted) {
            ActivityCompat.requestPermissions(this, new String[]{
                    Manifest.permission.READ_EXTERNAL_STORAGE,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE
            }, STORAGE_PERMISSION_REQUEST_CODE);
        }
    }

    private void setupBackButton() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                        "window.handleBackButton && window.handleBackButton()", null);
                }
            }
        });
    }

    // Returns true once granted (or not applicable below API 30) so onResume() knows it's
    // safe to move on to the next permission check instead of firing both at once.
    private boolean requestManageStoragePermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return true;
        if (android.os.Environment.isExternalStorageManager()) return true;
        Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
        intent.setData(Uri.parse("package:" + getPackageName()));
        try { startActivity(intent); } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
        }
        return false;
    }

    private void requestUsageAccessPermission() {
        try {
            AppOpsManager aom = (AppOpsManager) getSystemService(APP_OPS_SERVICE);
            int mode = aom.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,
                    android.os.Process.myUid(), getPackageName());
            if (mode != AppOpsManager.MODE_ALLOWED) {
                startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));
            }
        } catch (Exception ignored) {}
    }
}

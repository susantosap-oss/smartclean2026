package com.smartclean.app;

import android.Manifest;
import android.app.AppOpsManager;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebView;
import android.widget.LinearLayout;
import android.widget.TextView;
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
import com.smartclean.app.plugins.SecurityPlugin;
import com.smartclean.app.security.TrialGuard;
import com.smartclean.app.service.NotificationService;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FileCleanerPlugin.class);
        registerPlugin(MemoryBoosterPlugin.class);
        registerPlugin(DuplicateFinderPlugin.class);
        registerPlugin(AppManagerPlugin.class);
        registerPlugin(SecurityPlugin.class);
        super.onCreate(savedInstanceState);

        if (TrialGuard.isExpired(this)) {
            blockExpiredTrial();
            return;
        }

        requestLegacyStoragePermission();
        setupBackButton();
        setupEdgeToEdgeInsets();
    }

    // Android 15+ (targetSdk 36) forces edge-to-edge, and CSS env(safe-area-inset-*)
    // isn't reliably supported by every OEM's System WebView (seen bottom-nav still
    // colliding with the gesture bar on ColorOS/Oppo even with viewport-fit=cover set).
    // Reading the real inset in px straight from the platform and pushing it into the
    // page as CSS custom properties works regardless of the WebView's own safe-area
    // support — this is the source of truth; env() in style.css is just a fallback for
    // the brief moment before this first fires.
    private void setupEdgeToEdgeInsets() {
        View root = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            float density = getResources().getDisplayMetrics().density;
            int topPx = Math.round(bars.top / density);
            int bottomPx = Math.round(bars.bottom / density);
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                String js = "document.documentElement.style.setProperty('--safe-top', '" + topPx + "px');"
                          + "document.documentElement.style.setProperty('--safe-bottom', '" + bottomPx + "px');";
                webView.post(() -> webView.evaluateJavascript(js, null));
            }
            return insets;
        });
        ViewCompat.requestApplyInsets(root);
    }

    // ─── 14-day beta-test trial enforcement (debugbetatest flavor only) ───────
    // Replaces the loaded webview with a plain native "expired" screen (no app
    // functionality reachable from here) and immediately requests the app's own
    // uninstall via the system confirmation dialog — the closest a normal signed APK can
    // get to "auto-delete" on a non-rooted device without being a device-owner/MDM app,
    // since Android never lets an app silently uninstall itself without that one user tap.
    // Re-checked on every onResume() too, so an already-running app gets shut out the
    // moment the deadline passes, not just on a fresh launch.
    // onCreate() and the onResume() that immediately follows it both call this before
    // finishAffinity() actually tears the activity down — guard so the uninstall dialog
    // isn't requested twice back-to-back on a single launch.
    private boolean trialBlockHandled = false;

    private void blockExpiredTrial() {
        if (trialBlockHandled) return;
        trialBlockHandled = true;
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().stopLoading();
            getBridge().getWebView().loadUrl("about:blank");
        }

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setBackgroundColor(Color.parseColor("#1a1a1a"));
        int pad = (int) (32 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("Masa uji coba telah berakhir");
        title.setTextColor(Color.WHITE);
        title.setTextSize(20);
        title.setGravity(Gravity.CENTER);

        TextView body = new TextView(this);
        body.setText("Beta test build ini sudah melewati batas 14 hari dan tidak dapat "
                + "digunakan lagi. Aplikasi akan meminta untuk dihapus dari perangkat ini.");
        body.setTextColor(Color.LTGRAY);
        body.setTextSize(14);
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, pad / 2, 0, 0);

        layout.addView(title);
        layout.addView(body);
        setContentView(layout);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                finishAffinity();
            }
        });

        requestSelfUninstall();
    }

    private void requestSelfUninstall() {
        try {
            Intent intent = new Intent(Intent.ACTION_DELETE);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        } catch (Exception ignored) {
            // No Package Installer available to handle ACTION_DELETE — the block screen
            // above still keeps the app unusable even if the uninstall prompt can't show.
        }
        // Whether the tester confirms or cancels that system dialog, this process should
        // not keep running as a usable app — finish so the next launch re-triggers the
        // exact same block+prompt instead of leaving anything interactive on screen.
        finishAffinity();
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
        if (TrialGuard.isExpired(this)) {
            blockExpiredTrial();
            return;
        }
        NotificationService.requestRebindAsync(this);
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

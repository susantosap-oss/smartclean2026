package com.smartclean.app;

import android.app.AppOpsManager;
import android.os.Build;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.smartclean.app.plugins.FileCleanerPlugin;
import com.smartclean.app.plugins.MemoryBoosterPlugin;
import com.smartclean.app.plugins.DuplicateFinderPlugin;
import com.smartclean.app.plugins.AppManagerPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FileCleanerPlugin.class);
        registerPlugin(MemoryBoosterPlugin.class);
        registerPlugin(DuplicateFinderPlugin.class);
        registerPlugin(AppManagerPlugin.class);
        super.onCreate(savedInstanceState);
        requestManageStoragePermission();
        requestUsageAccessPermission();
        setupBackButton();
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

    private void requestManageStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (!android.os.Environment.isExternalStorageManager()) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                intent.setData(Uri.parse("package:" + getPackageName()));
                try { startActivity(intent); } catch (Exception e) {
                    startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                }
            }
        }
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

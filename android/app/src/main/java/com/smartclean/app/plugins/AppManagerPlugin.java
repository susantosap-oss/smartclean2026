package com.smartclean.app.plugins;

import android.app.usage.StorageStats;
import android.app.usage.StorageStatsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.os.UserHandle;
import android.os.storage.StorageManager;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@CapacitorPlugin(name = "AppManager")
public class AppManagerPlugin extends Plugin {

    private static final String TAG = "AppManagerPlugin";
    private static final long SIX_MONTHS_MS  = 180L * 24 * 3600 * 1000;
    private static final long SEVEN_DAYS_MS  = 7L   * 24 * 3600 * 1000;
    private static final long LOOKBACK_MS    = 2L * 365 * 24 * 3600 * 1000; // how far back to query usage stats

    // ─── Scan apps unused for 6+ months ───────────────────────────────────────
    @PluginMethod
    public void scanUnusedApps(PluginCall call) {
        new Thread(() -> {
            try {
                PackageManager pm = getContext().getPackageManager();
                String selfPkg = getContext().getPackageName();
                long now = System.currentTimeMillis();

                Map<String, Long> lastUsedMap = buildLastUsedMap(now);

                StorageStatsManager ssm = null;
                StorageManager sm = null;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ssm = (StorageStatsManager) getContext().getSystemService(Context.STORAGE_STATS_SERVICE);
                    sm  = (StorageManager) getContext().getSystemService(Context.STORAGE_SERVICE);
                }

                List<ApplicationInfo> installed = pm.getInstalledApplications(PackageManager.GET_META_DATA);
                JSArray apps = new JSArray();

                for (ApplicationInfo app : installed) {
                    if (app.packageName.equals(selfPkg)) continue;
                    if ((app.flags & ApplicationInfo.FLAG_SYSTEM) != 0) continue;
                    if (pm.getLaunchIntentForPackage(app.packageName) == null) continue; // skip non-launchable components

                    long installedMs = 0;
                    try { installedMs = pm.getPackageInfo(app.packageName, 0).firstInstallTime; } catch (Exception ignored) {}
                    if (installedMs > 0 && (now - installedMs) < SEVEN_DAYS_MS) continue; // give freshly installed apps a chance

                    Long lastUsed = lastUsedMap.get(app.packageName);
                    boolean neverUsed = (lastUsed == null || lastUsed == 0);
                    long sinceUse = neverUsed ? (now - installedMs) : (now - lastUsed);
                    if (sinceUse < SIX_MONTHS_MS) continue;

                    long size = getAppSize(app, ssm, sm);

                    JSObject item = new JSObject();
                    item.put("pkg",         app.packageName);
                    item.put("name",        pm.getApplicationLabel(app).toString());
                    item.put("iconBase64",  getAppIconBase64(pm, app));
                    item.put("sizeBytes",   size);
                    item.put("lastUsedMs",  neverUsed ? 0 : lastUsed);
                    item.put("installedMs", installedMs);
                    item.put("neverUsed",   neverUsed);
                    apps.put(item);
                }

                JSObject res = new JSObject();
                res.put("apps", apps);
                call.resolve(res);
            } catch (Exception e) {
                Log.e(TAG, "scanUnusedApps", e);
                call.reject("scanUnusedApps error: " + e.getMessage());
            }
        }).start();
    }

    // ─── Uninstall a single app (system confirmation dialog) ─────────────────
    @PluginMethod
    public void uninstallApp(PluginCall call) {
        String pkg = call.getString("packageName");
        if (pkg == null || pkg.isEmpty()) {
            call.reject("packageName is required");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_DELETE);
            intent.setData(Uri.parse("package:" + pkg));
            startActivityForResult(call, intent, "uninstallResult");
        } catch (Exception e) {
            call.reject("Uninstall error: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void uninstallResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject res = new JSObject();
        res.put("resultCode", result.getResultCode());
        // ACTION_DELETE reports RESULT_OK when the app was actually uninstalled.
        res.put("success", result.getResultCode() == android.app.Activity.RESULT_OK);
        call.resolve(res);
    }

    // ─── Open network settings (for Private DNS ad-block setup) ──────────────
    @PluginMethod
    public void openNetworkSettings(PluginCall call) {
        try {
            getContext().startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception e) {
            try {
                getContext().startActivity(new Intent(Settings.ACTION_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                call.resolve();
            } catch (Exception e2) {
                call.reject("Could not open settings: " + e2.getMessage());
            }
        }
    }

    // ─── Open Settings → Storage (so user can clear all-app cache via OS) ────
    @PluginMethod
    public void openStorageSettings(PluginCall call) {
        try {
            getContext().startActivity(new Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception e) {
            try {
                getContext().startActivity(new Intent(Settings.ACTION_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                call.resolve();
            } catch (Exception e2) {
                call.reject("Could not open storage settings: " + e2.getMessage());
            }
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private Map<String, Long> buildLastUsedMap(long now) {
        Map<String, Long> map = new HashMap<>();
        try {
            UsageStatsManager usm = (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
            long begin = now - LOOKBACK_MS;
            List<UsageStats> statsList = usm.queryUsageStats(UsageStatsManager.INTERVAL_BEST, begin, now);
            if (statsList != null) {
                for (UsageStats us : statsList) {
                    Long prev = map.get(us.getPackageName());
                    if (prev == null || us.getLastTimeUsed() > prev) {
                        map.put(us.getPackageName(), us.getLastTimeUsed());
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "buildLastUsedMap (Usage Access permission likely not granted)", e);
        }
        return map;
    }

    private long getAppSize(ApplicationInfo app, StorageStatsManager ssm, StorageManager sm) {
        if (ssm != null && sm != null) {
            try {
                UUID uuid = sm.getUuidForPath(new File(app.sourceDir));
                UserHandle user = Process.myUserHandle();
                StorageStats stats = ssm.queryStatsForPackage(uuid, app.packageName, user);
                return stats.getAppBytes() + stats.getDataBytes() + stats.getCacheBytes();
            } catch (Exception ignored) {}
        }
        try { return new File(app.sourceDir).length(); } catch (Exception e) { return 0; }
    }

    private String getAppIconBase64(PackageManager pm, ApplicationInfo app) {
        try {
            Drawable d = pm.getApplicationIcon(app);
            int size = 96;
            Bitmap bmp;
            if (d instanceof BitmapDrawable && ((BitmapDrawable) d).getBitmap() != null) {
                bmp = Bitmap.createScaledBitmap(((BitmapDrawable) d).getBitmap(), size, size, true);
            } else {
                bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(bmp);
                d.setBounds(0, 0, size, size);
                d.draw(canvas);
            }
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 90, baos);
            return "data:image/png;base64," + Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }
}

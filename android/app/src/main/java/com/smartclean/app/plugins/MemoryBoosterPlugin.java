package com.smartclean.app.plugins;

import android.app.ActivityManager;
import android.app.usage.StorageStats;
import android.app.usage.StorageStatsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.List;
import java.util.UUID;

@CapacitorPlugin(name = "MemoryBooster")
public class MemoryBoosterPlugin extends Plugin {

    private static final String TAG = "MemoryBoosterPlugin";

    // ─── Storage Stats ────────────────────────────────────────────────────────
    @PluginMethod
    public void getStorageStats(PluginCall call) {
        new Thread(() -> {
            try {
                Log.e(TAG, "getStorageStats ENTERED");
                long intTotal = 0, intAvail = 0;

                // Method A: java.io.File.getTotalSpace / getUsableSpace
                // Uses statvfs() internally — different from StatFs class (statfs()).
                // getCacheDir() is guaranteed non-null and always exists.
                File cacheDir = getContext().getCacheDir();
                intTotal = cacheDir.getTotalSpace();
                intAvail = cacheDir.getUsableSpace();
                Log.e(TAG, "File.space cacheDir=" + cacheDir.getAbsolutePath()
                        + " total=" + intTotal + " avail=" + intAvail);

                // Method B: StatFs fallback if File.space returned 0.
                if (intTotal == 0) {
                    java.util.ArrayList<String> paths = new java.util.ArrayList<>();
                    paths.add(cacheDir.getAbsolutePath());
                    try { paths.add(getContext().getFilesDir().getAbsolutePath()); } catch (Exception ignored) {}
                    paths.add("/data/user/0");
                    paths.add(Environment.getDataDirectory().getAbsolutePath());
                    File extDir = Environment.getExternalStorageDirectory();
                    if (extDir != null) paths.add(extDir.getAbsolutePath());

                    for (String path : paths) {
                        try {
                            StatFs stat = new StatFs(path);
                            long tot = stat.getBlockCountLong() * stat.getBlockSizeLong();
                            long av  = stat.getAvailableBlocksLong() * stat.getBlockSizeLong();
                            Log.e(TAG, "StatFs " + path + ": total=" + tot + " avail=" + av);
                            if (tot > intTotal) { intTotal = tot; intAvail = av; }
                        } catch (Exception e) {
                            Log.e(TAG, "StatFs FAIL " + path + ": " + e.getMessage());
                        }
                    }
                }

                Log.e(TAG, "RESULT total=" + intTotal + " avail=" + intAvail
                        + " used=" + (intTotal - intAvail));

                long intUsed = intTotal - intAvail;

                // SD card
                long sdTotal = 0, sdUsed = 0;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    StorageManager sm2 = (StorageManager) getContext().getSystemService(Context.STORAGE_SERVICE);
                    for (StorageVolume vol : sm2.getStorageVolumes()) {
                        if (vol.isRemovable()) {
                            File dir = vol.getDirectory();
                            if (dir != null && dir.exists()) {
                                StatFs sdStat = new StatFs(dir.getPath());
                                sdTotal = sdStat.getBlockCountLong() * sdStat.getBlockSizeLong();
                                long sdAvail = sdStat.getAvailableBlocksLong() * sdStat.getBlockSizeLong();
                                sdUsed = sdTotal - sdAvail;
                            }
                            break;
                        }
                    }
                }

                ActivityManager.MemoryInfo memInfo = new ActivityManager.MemoryInfo();
                ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                am.getMemoryInfo(memInfo);

                JSObject res = new JSObject();
                res.put("internalTotal", intTotal);
                res.put("internalUsed",  intUsed);
                res.put("internalFree",  intAvail);
                res.put("sdTotal",       sdTotal);
                res.put("sdUsed",        sdUsed);
                res.put("ramTotal",      memInfo.totalMem);
                res.put("ramUsed",       memInfo.totalMem - memInfo.availMem);
                res.put("ramFree",       memInfo.availMem);
                call.resolve(res);
            } catch (Exception e) {
                Log.e(TAG, "getStorageStats", e);
                call.reject("Storage stats error: " + e.getMessage());
            }
        }).start();
    }

    // ─── Memory Stats ─────────────────────────────────────────────────────────
    @PluginMethod
    public void getMemoryStats(PluginCall call) {
        new Thread(() -> {
            try {
                ActivityManager.MemoryInfo memInfo = new ActivityManager.MemoryInfo();
                ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                am.getMemoryInfo(memInfo);

                long cacheTotal = getCacheTotal();

                JSObject res = new JSObject();
                res.put("total",      memInfo.totalMem);
                res.put("used",       memInfo.totalMem - memInfo.availMem);
                res.put("free",       memInfo.availMem);
                res.put("threshold",  memInfo.threshold);
                res.put("lowMemory",  memInfo.lowMemory);
                res.put("cacheTotal", cacheTotal);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Memory stats error: " + e.getMessage());
            }
        }).start();
    }

    // ─── Boost Memory ─────────────────────────────────────────────────────────
    @PluginMethod
    public void boostMemory(PluginCall call) {
        new Thread(() -> {
            try {
                ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                ActivityManager.MemoryInfo memBefore = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(memBefore);
                long beforeFree = memBefore.availMem;

                // Request GC first
                Runtime.getRuntime().gc();

                // Kill via all installed packages (bypasses Android 11+ getRunningAppProcesses restriction)
                PackageManager pm = getContext().getPackageManager();
                List<ApplicationInfo> installed = pm.getInstalledApplications(PackageManager.GET_META_DATA);
                String self = getContext().getPackageName();
                int killed = 0;
                for (ApplicationInfo app : installed) {
                    if (app.packageName.equals(self)) continue;
                    if ((app.flags & ApplicationInfo.FLAG_SYSTEM) != 0) continue; // skip system apps
                    try {
                        am.killBackgroundProcesses(app.packageName);
                        killed++;
                    } catch (Exception ignored) {}
                }

                // Also kill from visible process list (catches services not in installed list)
                List<ActivityManager.RunningAppProcessInfo> procs = am.getRunningAppProcesses();
                if (procs != null) {
                    for (ActivityManager.RunningAppProcessInfo proc : procs) {
                        if (proc.importance >= ActivityManager.RunningAppProcessInfo.IMPORTANCE_CACHED
                                && !proc.processName.equals(self)) {
                            try { am.killBackgroundProcesses(proc.processName); } catch (Exception ignored) {}
                        }
                    }
                }

                Thread.sleep(800);
                Runtime.getRuntime().gc();

                ActivityManager.MemoryInfo memAfter = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(memAfter);
                long freed = Math.max(0, memAfter.availMem - beforeFree);

                JSObject res = new JSObject();
                res.put("freedBytes",  freed);
                res.put("killedApps", killed);
                res.put("ramFreeNow",  memAfter.availMem);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Boost error: " + e.getMessage());
            }
        }).start();
    }

    // ─── Optimize Storage (TRIM) ──────────────────────────────────────────────
    @PluginMethod
    public void optimizeStorage(PluginCall call) {
        new Thread(() -> {
            try {
                long trimmed = 0;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    StorageManager sm = (StorageManager) getContext().getSystemService(Context.STORAGE_SERVICE);
                    File extDir = Environment.getExternalStorageDirectory();
                    UUID uuid = sm.getUuidForPath(extDir != null && extDir.exists() ? extDir : Environment.getDataDirectory());
                    long cacheDiff = getContext().getCacheDir().getTotalSpace()
                                   - getContext().getCacheDir().getFreeSpace();
                    try {
                        sm.allocateBytes(uuid, Math.max(0, cacheDiff));
                        trimmed = cacheDiff;
                    } catch (Exception ignored) {}
                }

                // Clear own app cache
                File cache = getContext().getCacheDir();
                trimmed += clearDir(cache);
                if (getContext().getExternalCacheDir() != null) {
                    trimmed += clearDir(getContext().getExternalCacheDir());
                }

                JSObject res = new JSObject();
                res.put("trimmedBytes", trimmed);
                res.put("success", true);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Optimize error: " + e.getMessage());
            }
        }).start();
    }

    // ─── Get Running Background Apps ──────────────────────────────────────────
    @PluginMethod
    public void getRunningApps(PluginCall call) {
        new Thread(() -> {
            try {
                JSArray apps = new JSArray();
                PackageManager pm = getContext().getPackageManager();
                String self = getContext().getPackageName();

                // Android 5.1+: use UsageStatsManager — the only reliable way on Android 11+
                // because getRunningAppProcesses() only returns our own process since API 30.
                UsageStatsManager usm = (UsageStatsManager)
                    getContext().getSystemService(Context.USAGE_STATS_SERVICE);
                long now    = System.currentTimeMillis();
                long cutoff = now - 30 * 60 * 1000L; // apps active in last 30 min
                List<UsageStats> statsList = usm.queryUsageStats(
                    UsageStatsManager.INTERVAL_DAILY, cutoff, now);

                if (statsList != null && !statsList.isEmpty()) {
                    statsList.sort((a, b) -> Long.compare(b.getLastTimeUsed(), a.getLastTimeUsed()));
                    for (UsageStats stat : statsList) {
                        String pkg = stat.getPackageName();
                        if (pkg.equals(self)) continue;
                        if (stat.getLastTimeUsed() < cutoff) continue;
                        try {
                            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                            if ((ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0) continue;
                            String label = pm.getApplicationLabel(ai).toString();
                            long memKb = estimateMemKb(pkg);
                            JSObject app = new JSObject();
                            app.put("name",  label);
                            app.put("pkg",   pkg);
                            app.put("pid",   0);
                            app.put("memKb", memKb);
                            app.put("icon",  getAppEmoji(pkg));
                            apps.put(app);
                        } catch (PackageManager.NameNotFoundException ignored) {}
                    }
                }

                // Fallback for older Android or when UsageStats empty/permission denied
                if (apps.length() == 0) {
                    ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                    List<ActivityManager.RunningAppProcessInfo> procs = am.getRunningAppProcesses();
                    if (procs != null) {
                        for (ActivityManager.RunningAppProcessInfo proc : procs) {
                            if (proc.importance < ActivityManager.RunningAppProcessInfo.IMPORTANCE_SERVICE) continue;
                            if (proc.processName.equals(self)) continue;
                            int[] pids = { proc.pid };
                            android.os.Debug.MemoryInfo[] memArr = am.getProcessMemoryInfo(pids);
                            long memKb = memArr != null && memArr.length > 0 ? memArr[0].getTotalPss() : 0;
                            String label = proc.processName;
                            try {
                                ApplicationInfo ai = pm.getApplicationInfo(proc.processName, 0);
                                label = pm.getApplicationLabel(ai).toString();
                            } catch (Exception ignored) {}
                            JSObject app = new JSObject();
                            app.put("name",  label);
                            app.put("pkg",   proc.processName);
                            app.put("pid",   proc.pid);
                            app.put("memKb", memKb);
                            app.put("icon",  getAppEmoji(proc.processName));
                            apps.put(app);
                        }
                    }
                }

                JSObject res = new JSObject();
                res.put("apps", apps);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("GetRunningApps error: " + e.getMessage());
            }
        }).start();
    }

    private long estimateMemKb(String pkg) {
        // Estimate memory footprint via StorageStats cache as proxy (actual RSS not accessible on Android 11+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                StorageStatsManager ssm = (StorageStatsManager) getContext().getSystemService(Context.STORAGE_STATS_SERVICE);
                StorageManager sm = (StorageManager) getContext().getSystemService(Context.STORAGE_SERVICE);
                UUID uuid = sm.getUuidForPath(Environment.getDataDirectory());
                StorageStats stats = ssm.queryStatsForPackage(uuid, pkg, android.os.Process.myUserHandle());
                long kb = (stats.getCacheBytes() + stats.getDataBytes()) / 8192; // rough proxy
                return Math.max(32768, Math.min(kb, 512000)); // clamp 32MB–500MB
            } catch (Exception ignored) {}
        }
        return 51200; // default 50 MB
    }

    // ─── Stop specific apps ───────────────────────────────────────────────────
    @PluginMethod
    public void stopApps(PluginCall call) {
        com.getcapacitor.JSArray pkgsArr = call.getArray("packages");
        new Thread(() -> {
            try {
                ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                int stopped = 0;
                if (pkgsArr != null) {
                    for (int i = 0; i < pkgsArr.length(); i++) {
                        try {
                            am.killBackgroundProcesses(pkgsArr.getString(i));
                            stopped++;
                        } catch (Exception ignored) {}
                    }
                }
                JSObject res = new JSObject();
                res.put("stoppedCount", stopped);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("StopApps error: " + e.getMessage());
            }
        }).start();
    }

    // ─── Battery Info ─────────────────────────────────────────────────────────
    @PluginMethod
    public void getBatteryInfo(PluginCall call) {
        try {
            android.content.IntentFilter ifilter = new android.content.IntentFilter(
                android.content.Intent.ACTION_BATTERY_CHANGED);
            android.content.Intent batteryStatus = getContext().registerReceiver(null, ifilter);

            int level   = batteryStatus != null ? batteryStatus.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1) : -1;
            int scale   = batteryStatus != null ? batteryStatus.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1) : 100;
            int status  = batteryStatus != null ? batteryStatus.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1) : -1;
            int temp    = batteryStatus != null ? batteryStatus.getIntExtra(android.os.BatteryManager.EXTRA_TEMPERATURE, 0) : 0;
            boolean charging = status == android.os.BatteryManager.BATTERY_STATUS_CHARGING
                            || status == android.os.BatteryManager.BATTERY_STATUS_FULL;
            int pct = scale > 0 ? (int)((level / (float) scale) * 100) : level;

            JSObject res = new JSObject();
            res.put("level",    pct);
            res.put("charging", charging);
            res.put("tempC",    temp / 10.0);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Battery error: " + e.getMessage());
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    private long getCacheTotal() {
        long total = 0;
        try {
            PackageManager pm = getContext().getPackageManager();
            List<ApplicationInfo> apps = pm.getInstalledApplications(PackageManager.GET_META_DATA);
            for (ApplicationInfo app : apps) {
                File extData = new File(Environment.getExternalStorageDirectory(), "Android/data/" + app.packageName + "/cache");
                if (extData.exists()) total += getFolderSize(extData);
            }
            File myCache = getContext().getCacheDir();
            if (myCache != null) total += getFolderSize(myCache);
        } catch (Exception ignored) {}
        return total;
    }

    private long clearDir(File dir) {
        if (dir == null || !dir.exists()) return 0;
        long freed = 0;
        File[] files = dir.listFiles();
        if (files == null) return 0;
        for (File f : files) {
            if (f.isDirectory()) { freed += getFolderSize(f); deleteRecursive(f); }
            else { freed += f.length(); f.delete(); }
        }
        return freed;
    }

    private void deleteRecursive(File dir) {
        File[] files = dir.listFiles();
        if (files != null) for (File f : files) {
            if (f.isDirectory()) deleteRecursive(f);
            else f.delete();
        }
        dir.delete();
    }

    private long getFolderSize(File dir) {
        if (dir == null || !dir.exists()) return 0;
        long size = 0;
        File[] files = dir.listFiles();
        if (files == null) return 0;
        for (File f : files) {
            if (f.isDirectory()) size += getFolderSize(f);
            else size += f.length();
        }
        return size;
    }

    private String getAppEmoji(String pkg) {
        if (pkg.contains("youtube")) return "▶️";
        if (pkg.contains("instagram")) return "📷";
        if (pkg.contains("facebook")) return "📘";
        if (pkg.contains("maps")) return "🗺️";
        if (pkg.contains("chrome")) return "🌐";
        if (pkg.contains("whatsapp")) return "💬";
        if (pkg.contains("tiktok")) return "🎵";
        if (pkg.contains("twitter") || pkg.contains("x.")) return "🐦";
        if (pkg.contains("spotify")) return "🎧";
        if (pkg.contains("telegram")) return "✈️";
        return "📱";
    }
}

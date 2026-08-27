package com.smartclean.app.plugins;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.Settings;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import android.app.usage.StorageStats;
import android.app.usage.StorageStatsManager;
import android.os.storage.StorageManager;

import com.smartclean.app.service.NotificationService;

@CapacitorPlugin(name = "FileCleaner")
public class FileCleanerPlugin extends Plugin {

    private static final String TAG = "FileCleanerPlugin";

    // Recursion cap for storage traversal. Real-device WhatsApp / WhatsApp Business
    // paths (esp. scoped-storage layout under Android/media/<pkg>/.../Shared) can
    // nest deeper than a shallow cap allows, silently hiding files below it.
    private static final int MAX_SCAN_DEPTH = 14;

    // ─── Extensions ───────────────────────────────────────────────────────────
    private static final List<String> TMP_EXT = Arrays.asList(
        ".tmp", ".temp", ".bak", ".old", ".dmp", ".swp", "~"
    );
    private static final List<String> THUMB_DIRS = Arrays.asList(
        ".thumbnails", "thumbnails", "thumbnail", "thumbs", "thumb", ".thumb"
    );
    private static final List<String> JUNK_EXT = Arrays.asList(
        ".log", ".trace", ".crash", ".ads", ".nomedia_tmp",
        ".dmp", ".hprof", ".err", ".stackdump",
        ".DS_Store", "thumbs.db", "desktop.ini"
    );
    private static final List<String> BROWSER_PKGS = Arrays.asList(
        "com.android.chrome", "org.mozilla.firefox", "com.opera.browser",
        "com.microsoft.emmx", "com.brave.browser", "com.UCMobile.intl",
        "com.sec.android.app.sbrowser", "com.android.browser"
    );
    private static final List<String> GAME_KEYWORDS = Arrays.asList(
        "game", "games", "gaming",
        "pubg", "mlbb", "freefire", "codm", "clash",
        "roblox", "minecraft", "genshin", "honkai", "among",
        "supercell", "gameloft", "king", "zynga", "nexon",
        "bandai", "capcom", "squareenix", "ubisoft", "activision",
        "garena", "moonton", "netease", "mihoyo", "hoyoverse"
    );
    // WhatsApp / WhatsApp Business media roots. On Android 11+ (scoped storage)
    // both apps write under Android/media/<pkg>/..., not the legacy top-level
    // "WhatsApp/Media" path — devices can have either layout depending on the
    // OS version / WA version, so both are checked. Each entry is
    // { mediaRootRelativeToExternalStorage, subfolderNamePrefix, sourceLabel }.
    private static final String[][] WA_APPS = {
        { "WhatsApp/Media",                                          "WhatsApp",          "whatsapp" },
        { "Whatsapp/Media",                                          "WhatsApp",          "whatsapp" },
        { "Android/media/com.whatsapp/WhatsApp/Media",               "WhatsApp",          "whatsapp" },
        { "WhatsApp Business/Media",                                 "WhatsApp Business", "whatsapp_business" },
        { "Android/media/com.whatsapp.w4b/WhatsApp Business/Media",  "WhatsApp Business", "whatsapp_business" },
    };
    // WhatsApp / WhatsApp Business encrypted DB backups (WhatsApp/Database(s) &
    // WhatsApp Business/Database(s)), e.g. "msgstore-2026-08-25.1.db.crypt14".
    private static final String DB_BACKUP_EXT = ".db.crypt14";

    // ─── Scan All Junk ────────────────────────────────────────────────────────
    @PluginMethod
    public void scanJunkFiles(PluginCall call) {
        getActivity().runOnUiThread(() -> {});
        new Thread(() -> {
            try {
                long tmpSize    = scanTmpFiles();
                long msgSize    = scanDbFiles();
                long junkSize   = scanJunkDir();
                long appCache   = getAppCacheSize();
                long browserSz  = getBrowserCacheSize();
                long gameCache  = getGameCacheSize();
                int  notifCount = getNotifCount();

                Log.e(TAG, "SCAN RESULT: tmp="     + tmpSize   + " msg=" + msgSize
                    + " junk=" + junkSize + " appcache=" + appCache);
                boolean notifGranted = NotificationService.instance != null;
                Log.e(TAG, "SCAN RESULT: browser=" + browserSz + " game=" + gameCache
                    + " notif=" + notifCount
                    + " notifSvcConnected=" + notifGranted);

                JSObject result = new JSObject();
                JSObject data = new JSObject();
                data.put("tmp",              tmpSize);
                data.put("msg",              msgSize);
                data.put("junk",             junkSize);
                data.put("appcache",         appCache);
                data.put("browser",          browserSz);
                data.put("notif",            notifCount * 1024L);
                data.put("game",             gameCache);
                data.put("notifAccessGranted", notifGranted);
                result.put("data", data);
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "scanJunkFiles", e);
                call.reject("Scan failed: " + e.getMessage());
            }
        }).start();
    }

    // ─── Clean selected types ─────────────────────────────────────────────────
    @PluginMethod
    public void cleanJunkFiles(PluginCall call) {
        JSArray typesArr = call.getArray("types");
        new Thread(() -> {
            try {
                long freed = 0;
                List<String> types = new ArrayList<>();
                if (typesArr != null) {
                    for (int i = 0; i < typesArr.length(); i++) {
                        types.add(typesArr.getString(i));
                    }
                }

                Log.e(TAG, "cleanJunkFiles types=" + types);
                if (types.contains("tmp"))     { freed += cleanTmpFiles();                                          Log.e(TAG, "tmp done freed="+freed); }
                if (types.contains("msg"))     { freed += cleanDbFiles();                                           Log.e(TAG, "msg done freed="+freed); }
                if (types.contains("junk"))    { freed += deleteRecursive(getExternalRoot(), f -> matchesJunk(f)); freed += cleanOrphanedAppData(); Log.e(TAG, "junk done freed="+freed); }
                if (types.contains("appcache")){ freed += clearOwnCache();                                          Log.e(TAG, "appcache done freed="+freed); }
                if (types.contains("browser")) { freed += clearBrowserCacheFiles();                                 Log.e(TAG, "browser done freed="+freed); }
                if (types.contains("notif"))   { dismissAllNotifications();                                         Log.e(TAG, "notif done"); }
                if (types.contains("game"))    { freed += clearGameCache();                                         Log.e(TAG, "game done freed="+freed); }
                Log.e(TAG, "cleanJunkFiles DONE freed=" + freed);

                JSObject res = new JSObject();
                res.put("freedBytes", freed);
                call.resolve(res);
            } catch (Exception e) {
                Log.e(TAG, "cleanJunkFiles ERROR", e);
                call.reject("Clean failed: " + e.getMessage());
            }
        }).start();
    }

    // ─── Delete specific file list ────────────────────────────────────────────
    @PluginMethod
    public void deleteFiles(PluginCall call) {
        JSArray pathsArr = call.getArray("paths");
        new Thread(() -> {
            try {
                long freed = 0;
                if (pathsArr != null) {
                    for (int i = 0; i < pathsArr.length(); i++) {
                        File f = new File(pathsArr.getString(i));
                        if (f.exists()) {
                            freed += f.length();
                            f.delete();
                        }
                    }
                }
                JSObject res = new JSObject();
                res.put("freedBytes", freed);
                res.put("deletedCount", pathsArr != null ? pathsArr.length() : 0);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Delete failed: " + e.getMessage());
            }
        }).start();
    }

    // ─── Scan WhatsApp Media ──────────────────────────────────────────────────
    @PluginMethod
    public void scanWAMedia(PluginCall call) {
        String type   = call.getString("type", "video");
        long cutoffMs = call.getLong("cutoffMs", 0L);

        new Thread(() -> {
            try {
                JSArray files = new JSArray();
                File ext = Environment.getExternalStorageDirectory();
                // De-dupe: legacy and scoped-storage roots can both resolve to the
                // same real folder (symlinked by the OS), so track paths already added.
                java.util.Set<String> seenPaths = new java.util.HashSet<>();

                for (String[] app : WA_APPS) {
                    String mediaRoot = app[0];
                    String prefix    = app[1];
                    String source    = app[2];
                    String subFolder = getWASubfolder(prefix, type);
                    File dir = new File(ext, mediaRoot + "/" + subFolder);
                    if (!dir.exists()) continue;

                    File[] listed = dir.listFiles();
                    if (listed == null) continue;

                    for (File f : listed) {
                        if (!f.isFile()) continue;
                        if (cutoffMs > 0 && f.lastModified() >= cutoffMs) continue;
                        if (!matchesMediaType(f.getName(), type)) continue;
                        if (!seenPaths.add(f.getAbsolutePath())) continue;

                        JSObject item = new JSObject();
                        item.put("name",   f.getName());
                        item.put("path",   f.getAbsolutePath());
                        item.put("size",   f.length());
                        item.put("dateMs", f.lastModified());
                        item.put("source", source);
                        files.put(item);
                    }
                }

                JSObject res = new JSObject();
                res.put("files", files);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("WA scan error: " + e.getMessage());
            }
        }).start();
    }

    // ─── Scan Camera/Gallery Media ────────────────────────────────────────────
    @PluginMethod
    public void scanCameraMedia(PluginCall call) {
        String type   = call.getString("type", "image");
        long cutoffMs = call.getLong("cutoffMs", 0L);

        new Thread(() -> {
            try {
                JSArray files = new JSArray();
                List<String> camDirs = Arrays.asList("DCIM/Camera", "DCIM", "Pictures", "Movies", "Download");
                if ("screenshot".equals(type)) {
                    camDirs = Arrays.asList("Pictures/Screenshots", "DCIM/Screenshots", "Screenshots");
                }

                for (String dirPath : camDirs) {
                    File dir = new File(Environment.getExternalStorageDirectory(), dirPath);
                    if (!dir.exists()) continue;
                    scanMediaDir(dir, type, cutoffMs, files, 0);
                }

                JSObject res = new JSObject();
                res.put("files", files);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Camera scan error: " + e.getMessage());
            }
        }).start();
    }

    private void scanMediaDir(File dir, String type, long cutoffMs, JSArray out, int depth) throws JSONException {
        if (depth > 2) return;
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.isDirectory()) { scanMediaDir(f, type, cutoffMs, out, depth+1); continue; }
            if (cutoffMs > 0 && f.lastModified() >= cutoffMs) continue;
            if (!matchesMediaType(f.getName(), type)) continue;
            JSObject item = new JSObject();
            item.put("name",   f.getName());
            item.put("path",   f.getAbsolutePath());
            item.put("size",   f.length());
            item.put("dateMs", f.lastModified());
            out.put(item);
        }
    }

    // ─── Scan Browser Cache ───────────────────────────────────────────────────
    @PluginMethod
    public void scanBrowserCache(PluginCall call) {
        new Thread(() -> {
            try {
                JSArray browsers = new JSArray();
                PackageManager pm = getContext().getPackageManager();
                String[] icons = {"🟡","🦊","🔵","🔴","🦁","🌐","🌐","🌐"};
                int ic = 0;

                StorageStatsManager ssm = null;
                UUID storageUuid = null;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    try {
                        ssm = (StorageStatsManager) getContext().getSystemService(Context.STORAGE_STATS_SERVICE);
                        StorageManager smgr = (StorageManager) getContext().getSystemService(Context.STORAGE_SERVICE);
                        storageUuid = smgr.getUuidForPath(Environment.getDataDirectory());
                    } catch (Exception e) { ssm = null; }
                }

                for (String pkg : BROWSER_PKGS) {
                    try {
                        ApplicationInfo info = pm.getApplicationInfo(pkg, 0);
                        long cacheSize = 0;
                        File cacheDir = new File(Environment.getExternalStorageDirectory(), "Android/data/" + pkg + "/cache");

                        if (ssm != null && storageUuid != null) {
                            try {
                                StorageStats stats = ssm.queryStatsForPackage(storageUuid, pkg, android.os.Process.myUserHandle());
                                cacheSize = stats.getCacheBytes();
                            } catch (Exception ignored) {}
                        }
                        if (cacheSize == 0) cacheSize = getFolderSize(cacheDir);

                        JSObject b = new JSObject();
                        b.put("name", pm.getApplicationLabel(info).toString());
                        b.put("pkg",  pkg);
                        b.put("icon", icons[Math.min(ic++, icons.length-1)]);
                        b.put("cacheBytes", cacheSize);
                        b.put("cachePath",  cacheDir.getAbsolutePath());
                        browsers.put(b);
                    } catch (PackageManager.NameNotFoundException ignored) {}
                }

                JSObject res = new JSObject();
                res.put("browsers", browsers);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Browser scan error: " + e.getMessage());
            }
        }).start();
    }

    // ─── Clear Browser Cache ──────────────────────────────────────────────────
    @PluginMethod
    public void clearBrowserCache(PluginCall call) {
        new Thread(() -> {
            long freed = clearBrowserCacheFiles();
            JSObject res = new JSObject();
            res.put("freedBytes", freed);
            call.resolve(res);
        }).start();
    }

    // ─── Clear Notifications ──────────────────────────────────────────────────
    @PluginMethod
    public void clearNotifications(PluginCall call) {
        dismissAllNotifications();
        call.resolve(new JSObject());
    }

    // ─── Open Notification Access Settings ────────────────────────────────────
    @PluginMethod
    public void requestNotificationAccess(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "requestNotificationAccess", e);
        }
        call.resolve(new JSObject());
    }

    // ─── Scan Recently Deleted (MediaStore IS_TRASHED) ────────────────────────
    @PluginMethod
    public void scanRecentlyDeleted(PluginCall call) {
        new Thread(() -> {
            try {
                long size = 0; int count = 0;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    android.net.Uri uri = android.provider.MediaStore.Files.getContentUri(
                        android.provider.MediaStore.VOLUME_EXTERNAL);
                    String[] projection = { android.provider.MediaStore.Files.FileColumns.SIZE };
                    android.database.Cursor cursor;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        android.os.Bundle args = new android.os.Bundle();
                        args.putInt(android.provider.MediaStore.QUERY_ARG_MATCH_TRASHED,
                            android.provider.MediaStore.MATCH_ONLY);
                        cursor = getContext().getContentResolver().query(uri, projection, args, null);
                    } else {
                        cursor = getContext().getContentResolver().query(uri, projection,
                            android.provider.MediaStore.Files.FileColumns.IS_TRASHED + " = 1", null, null);
                    }
                    if (cursor != null) {
                        try { while (cursor.moveToNext()) { size += cursor.getLong(0); count++; } }
                        finally { cursor.close(); }
                    }
                }
                JSObject res = new JSObject();
                res.put("sizeBytes", size);
                res.put("count", count);
                call.resolve(res);
            } catch (Exception e) {
                Log.e(TAG, "scanRecentlyDeleted", e);
                call.reject("Scan error: " + e.getMessage());
            }
        }).start();
    }

    // ─── Clean Recently Deleted ────────────────────────────────────────────────
    @PluginMethod
    public void cleanRecentlyDeleted(PluginCall call) {
        new Thread(() -> {
            try {
                long freed = 0; int deleted = 0;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    android.net.Uri baseUri = android.provider.MediaStore.Files.getContentUri(
                        android.provider.MediaStore.VOLUME_EXTERNAL);
                    String[] projection = {
                        android.provider.MediaStore.Files.FileColumns._ID,
                        android.provider.MediaStore.Files.FileColumns.SIZE
                    };
                    android.database.Cursor cursor;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        android.os.Bundle args = new android.os.Bundle();
                        args.putInt(android.provider.MediaStore.QUERY_ARG_MATCH_TRASHED,
                            android.provider.MediaStore.MATCH_ONLY);
                        cursor = getContext().getContentResolver().query(baseUri, projection, args, null);
                    } else {
                        cursor = getContext().getContentResolver().query(baseUri, projection,
                            android.provider.MediaStore.Files.FileColumns.IS_TRASHED + " = 1", null, null);
                    }
                    if (cursor != null) {
                        try {
                            int idCol   = cursor.getColumnIndexOrThrow(android.provider.MediaStore.Files.FileColumns._ID);
                            int sizeCol = cursor.getColumnIndexOrThrow(android.provider.MediaStore.Files.FileColumns.SIZE);
                            while (cursor.moveToNext()) {
                                long id = cursor.getLong(idCol);
                                long sz = cursor.getLong(sizeCol);
                                android.net.Uri itemUri = android.content.ContentUris.withAppendedId(baseUri, id);
                                try {
                                    int rows = getContext().getContentResolver().delete(itemUri, null, null);
                                    if (rows > 0) { freed += sz; deleted++; }
                                } catch (Exception ignored) {}
                            }
                        } finally { cursor.close(); }
                    }
                }
                JSObject res = new JSObject();
                res.put("freedBytes", freed);
                res.put("deletedCount", deleted);
                call.resolve(res);
            } catch (Exception e) {
                Log.e(TAG, "cleanRecentlyDeleted", e);
                call.reject("Clean error: " + e.getMessage());
            }
        }).start();
    }

    // ─── Request Permissions ──────────────────────────────────────────────────
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        requestPermissionForAlias("readStorage", call, "permissionCallback");
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void permissionCallback(PluginCall call) {
        call.resolve(new JSObject());
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  Private helpers
    // ═══════════════════════════════════════════════════════════════════════════

    private File getExternalRoot() {
        return Environment.getExternalStorageDirectory();
    }

    private long scanTmpFiles() {
        long size = 0;
        File root = getExternalRoot();
        size += scanForExtensions(root, TMP_EXT, 0);
        for (String thumbDir : THUMB_DIRS) {
            size += findDirSize(root, thumbDir, 0);
        }
        return size;
    }

    // Deletes both loose *.tmp-style files AND the contents of thumbnail-cache
    // directories, mirroring scanTmpFiles() exactly. Previously only the
    // extension-matched files were deleted while thumbnail directories (which are
    // mostly non-.tmp cached images) were left untouched, so a re-scan right after
    // cleaning kept reporting the same size.
    private long cleanTmpFiles() {
        long freed = 0;
        File root = getExternalRoot();
        freed += deleteRecursive(root, f -> matchesTmp(f));
        for (String thumbDir : THUMB_DIRS) {
            freed += deleteDirNamed(root, thumbDir, 0);
        }
        return freed;
    }

    // WhatsApp / WhatsApp Business encrypted DB backups (*.db.crypt14). Files are
    // grouped by their containing folder so WhatsApp's and WhatsApp Business's
    // backups are kept/pruned independently instead of one app's newer backup
    // wiping out the other app's only backup.
    private long scanDbFiles() {
        List<File> dbFiles = new ArrayList<>();
        findByExtension(getExternalRoot(), DB_BACKUP_EXT, dbFiles, 0);
        long size = 0;
        for (List<File> group : groupByParent(dbFiles).values()) {
            if (group.size() <= 1) continue;
            group.sort((a, b) -> Long.compare(b.lastModified(), a.lastModified()));
            for (int i = 1; i < group.size(); i++) size += group.get(i).length();
        }
        return size;
    }

    private long cleanDbFiles() {
        List<File> dbFiles = new ArrayList<>();
        findByExtension(getExternalRoot(), DB_BACKUP_EXT, dbFiles, 0);
        long freed = 0;
        for (List<File> group : groupByParent(dbFiles).values()) {
            if (group.size() <= 1) continue;
            group.sort((a, b) -> Long.compare(b.lastModified(), a.lastModified()));
            for (int i = 1; i < group.size(); i++) {
                freed += group.get(i).length();
                group.get(i).delete();
            }
        }
        return freed;
    }

    private Map<File, List<File>> groupByParent(List<File> files) {
        Map<File, List<File>> byParent = new HashMap<>();
        for (File f : files) {
            File parent = f.getParentFile();
            List<File> group = byParent.get(parent);
            if (group == null) { group = new ArrayList<>(); byParent.put(parent, group); }
            group.add(f);
        }
        return byParent;
    }

    private long scanJunkDir() {
        long size = scanForExtensions(getExternalRoot(), JUNK_EXT, 0);
        size += scanOrphanedAppData();
        return size;
    }

    private long getAppCacheSize() {
        long size = 0;
        File cacheDir = getContext().getCacheDir();
        if (cacheDir != null) size += getFolderSize(cacheDir);
        File extCache = getContext().getExternalCacheDir();
        if (extCache != null) size += getFolderSize(extCache);
        return size;
    }

    private long clearOwnCache() {
        long freed = getFolderSize(getContext().getCacheDir());
        deleteRecursiveDir(getContext().getCacheDir());
        if (getContext().getExternalCacheDir() != null) {
            freed += getFolderSize(getContext().getExternalCacheDir());
            deleteRecursiveDir(getContext().getExternalCacheDir());
        }
        return freed;
    }

    private long getBrowserCacheSize() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            long size = 0;
            try {
                StorageStatsManager ssm = (StorageStatsManager) getContext().getSystemService(Context.STORAGE_STATS_SERVICE);
                StorageManager smgr = (StorageManager) getContext().getSystemService(Context.STORAGE_SERVICE);
                UUID uuid = smgr.getUuidForPath(Environment.getDataDirectory());
                PackageManager pm = getContext().getPackageManager();
                for (String pkg : BROWSER_PKGS) {
                    try {
                        pm.getApplicationInfo(pkg, 0);
                        StorageStats stats = ssm.queryStatsForPackage(uuid, pkg, android.os.Process.myUserHandle());
                        size += stats.getCacheBytes();
                    } catch (Exception ignored) {}
                }
            } catch (Exception e) { Log.e(TAG, "getBrowserCacheSize", e); }
            return size;
        }
        long size = 0;
        for (String pkg : BROWSER_PKGS) {
            File cache = new File(Environment.getExternalStorageDirectory(), "Android/data/" + pkg + "/cache");
            size += getFolderSize(cache);
        }
        return size;
    }

    private long clearBrowserCacheFiles() {
        long freed = 0;
        for (String pkg : BROWSER_PKGS) {
            File cache = new File(Environment.getExternalStorageDirectory(), "Android/data/" + pkg + "/cache");
            if (cache.exists()) { freed += getFolderSize(cache); deleteRecursiveDir(cache); }
            File cache2 = new File(new File(getContext().getCacheDir().getParentFile().getParentFile(), pkg), "cache");
            if (cache2.exists()) { freed += getFolderSize(cache2); deleteRecursiveDir(cache2); }
        }
        return freed;
    }

    private boolean isGameApp(ApplicationInfo app) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && app.category == ApplicationInfo.CATEGORY_GAME) return true;
        String pkg = app.packageName.toLowerCase();
        for (String kw : GAME_KEYWORDS) { if (pkg.contains(kw)) return true; }
        return false;
    }

    private long getGameCacheSize() {
        PackageManager pm = getContext().getPackageManager();
        List<ApplicationInfo> apps;
        try { apps = pm.getInstalledApplications(PackageManager.GET_META_DATA); }
        catch (Exception e) { return 0; }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            long size = 0;
            try {
                StorageStatsManager ssm = (StorageStatsManager) getContext().getSystemService(Context.STORAGE_STATS_SERVICE);
                StorageManager smgr = (StorageManager) getContext().getSystemService(Context.STORAGE_SERVICE);
                UUID uuid = smgr.getUuidForPath(Environment.getDataDirectory());
                for (ApplicationInfo app : apps) {
                    if (!isGameApp(app)) continue;
                    try {
                        StorageStats stats = ssm.queryStatsForPackage(uuid, app.packageName, android.os.Process.myUserHandle());
                        size += stats.getCacheBytes();
                    } catch (Exception ignored) {}
                }
            } catch (Exception e) { Log.e(TAG, "getGameCacheSize", e); }
            return size;
        }

        long size = 0;
        for (ApplicationInfo app : apps) {
            if (!isGameApp(app)) continue;
            File extData = new File(Environment.getExternalStorageDirectory(), "Android/data/" + app.packageName);
            size += getFolderSize(extData);
        }
        return size;
    }

    private long clearGameCache() {
        long freed = 0;
        PackageManager pm = getContext().getPackageManager();
        List<ApplicationInfo> apps;
        try { apps = pm.getInstalledApplications(PackageManager.GET_META_DATA); }
        catch (Exception e) { return 0; }

        for (ApplicationInfo app : apps) {
            if (!isGameApp(app)) continue;
            File cacheDir = new File(Environment.getExternalStorageDirectory(), "Android/data/" + app.packageName + "/cache");
            if (cacheDir.exists()) { freed += getFolderSize(cacheDir); deleteRecursiveDir(cacheDir); }
        }
        return freed;
    }

    private int getNotifCount() {
        NotificationService svc = NotificationService.instance;
        if (svc != null) {
            try {
                StatusBarNotification[] active = svc.getActiveNotifications();
                return active != null ? active.length : 0;
            } catch (Exception e) { Log.e(TAG, "getNotifCount", e); }
        }
        return 0;
    }

    private void dismissAllNotifications() {
        NotificationService.dismissAll();
    }

    private long scanOrphanedAppData() {
        PackageManager pm = getContext().getPackageManager();
        File androidData = new File(Environment.getExternalStorageDirectory(), "Android/data");
        if (!androidData.exists()) return 0;
        File[] dirs = androidData.listFiles();
        if (dirs == null) return 0;
        long size = 0;
        for (File dir : dirs) {
            if (!dir.isDirectory()) continue;
            try { pm.getApplicationInfo(dir.getName(), 0); }
            catch (PackageManager.NameNotFoundException e) { size += getFolderSize(dir); }
        }
        return size;
    }

    private long cleanOrphanedAppData() {
        PackageManager pm = getContext().getPackageManager();
        File androidData = new File(Environment.getExternalStorageDirectory(), "Android/data");
        if (!androidData.exists()) return 0;
        File[] dirs = androidData.listFiles();
        if (dirs == null) return 0;
        long freed = 0;
        for (File dir : dirs) {
            if (!dir.isDirectory()) continue;
            try { pm.getApplicationInfo(dir.getName(), 0); }
            catch (PackageManager.NameNotFoundException e) {
                freed += getFolderSize(dir);
                deleteRecursiveDir(dir);
                dir.delete();
            }
        }
        return freed;
    }

    // ─── File traversal helpers ───────────────────────────────────────────────

    interface FileFilter { boolean accept(File f); }

    private long deleteRecursive(File dir, FileFilter filter) {
        return deleteRecursive(dir, filter, 0);
    }

    private long deleteRecursive(File dir, FileFilter filter, int depth) {
        if (dir == null || !dir.exists() || depth > MAX_SCAN_DEPTH) return 0;
        long freed = 0;
        File[] files = dir.listFiles();
        if (files == null) return 0;
        for (File f : files) {
            if (f.isDirectory()) { freed += deleteRecursive(f, filter, depth + 1); }
            else if (filter.accept(f)) { freed += f.length(); f.delete(); }
        }
        return freed;
    }

    private long scanForExtensions(File dir, List<String> exts, int depth) {
        if (dir == null || !dir.exists() || depth > MAX_SCAN_DEPTH) return 0;
        long size = 0;
        File[] files = dir.listFiles();
        if (files == null) return 0;
        for (File f : files) {
            if (f.isDirectory()) size += scanForExtensions(f, exts, depth+1);
            else {
                String name = f.getName().toLowerCase();
                for (String ext : exts) { if (name.endsWith(ext)) { size += f.length(); break; } }
            }
        }
        return size;
    }

    private long findDirSize(File root, String dirName, int depth) {
        if (root == null || !root.exists() || depth > MAX_SCAN_DEPTH) return 0;
        long size = 0;
        File[] files = root.listFiles();
        if (files == null) return 0;
        for (File f : files) {
            if (f.isDirectory()) {
                if (f.getName().equalsIgnoreCase(dirName)) size += getFolderSize(f);
                else size += findDirSize(f, dirName, depth+1);
            }
        }
        return size;
    }

    // Deletes the contents of every directory named dirName found under root
    // (mirrors findDirSize's traversal, but deletes instead of just sizing).
    private long deleteDirNamed(File root, String dirName, int depth) {
        if (root == null || !root.exists() || depth > MAX_SCAN_DEPTH) return 0;
        long freed = 0;
        File[] files = root.listFiles();
        if (files == null) return 0;
        for (File f : files) {
            if (!f.isDirectory()) continue;
            if (f.getName().equalsIgnoreCase(dirName)) {
                freed += getFolderSize(f);
                deleteRecursiveDir(f);
            } else {
                freed += deleteDirNamed(f, dirName, depth + 1);
            }
        }
        return freed;
    }

    private void findByExtension(File dir, String ext, List<File> result, int depth) {
        if (dir == null || !dir.exists() || depth > MAX_SCAN_DEPTH) return;
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.isDirectory()) findByExtension(f, ext, result, depth+1);
            else if (f.getName().toLowerCase().endsWith(ext)) result.add(f);
        }
    }

    private boolean matchesTmp(File f) {
        String name = f.getName().toLowerCase();
        for (String ext : TMP_EXT) { if (name.endsWith(ext)) return true; }
        return false;
    }

    private boolean matchesJunk(File f) {
        String name = f.getName().toLowerCase();
        for (String ext : JUNK_EXT) { if (name.endsWith(ext)) return true; }
        return false;
    }

    private boolean matchesMediaType(String name, String type) {
        name = name.toLowerCase();
        switch (type) {
            case "video":    return name.endsWith(".mp4") || name.endsWith(".mkv") || name.endsWith(".avi") || name.endsWith(".3gp") || name.endsWith(".mov");
            case "image":    return name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") || name.endsWith(".webp") || name.endsWith(".heic");
            case "document": return name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx") || name.endsWith(".xls") || name.endsWith(".ppt") || name.endsWith(".txt");
            case "audio":    return name.endsWith(".mp3") || name.endsWith(".opus") || name.endsWith(".ogg") || name.endsWith(".aac") || name.endsWith(".m4a");
            case "screenshot": return (name.endsWith(".png") || name.endsWith(".jpg")) && (name.contains("screenshot") || name.startsWith("screen"));
            default:         return true;
        }
    }

    // prefix is "WhatsApp" or "WhatsApp Business" — real device folder names are
    // e.g. "WhatsApp Video" vs "WhatsApp Business Video".
    private String getWASubfolder(String prefix, String type) {
        switch (type) {
            case "video":    return prefix + " Video";
            case "image":    return prefix + " Images";
            case "document": return prefix + " Documents";
            case "audio":    return prefix + " Audio";
            default:         return prefix + " Images";
        }
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

    private void deleteRecursiveDir(File dir) {
        if (dir == null || !dir.exists()) return;
        File[] files = dir.listFiles();
        if (files != null) for (File f : files) {
            if (f.isDirectory()) deleteRecursiveDir(f);
            else f.delete();
        }
    }
}

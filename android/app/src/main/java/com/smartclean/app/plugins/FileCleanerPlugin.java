package com.smartclean.app.plugins;

import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
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
import java.util.List;

@CapacitorPlugin(name = "FileCleaner")
public class FileCleanerPlugin extends Plugin {

    private static final String TAG = "FileCleanerPlugin";

    // ─── Extensions ───────────────────────────────────────────────────────────
    private static final List<String> TMP_EXT = Arrays.asList(
        ".tmp", ".temp", ".bak", ".old", ".dmp", ".swp", "~"
    );
    private static final List<String> THUMB_DIRS = Arrays.asList(
        ".thumbnails", "thumbnails", "thumbnail", "thumbs", "thumb", ".thumb"
    );
    private static final List<String> JUNK_EXT = Arrays.asList(
        ".log", ".trace", ".crash", ".ads", ".nomedia_tmp"
    );
    private static final List<String> BROWSER_PKGS = Arrays.asList(
        "com.android.chrome", "org.mozilla.firefox", "com.opera.browser",
        "com.microsoft.emmx", "com.brave.browser", "com.UCMobile.intl",
        "com.sec.android.app.sbrowser", "com.android.browser"
    );
    private static final List<String> GAME_KEYWORDS = Arrays.asList(
        "game", "games", "play", "pubg", "mlbb", "freefire", "codm", "clash"
    );
    private static final List<String> WA_DIRS = Arrays.asList(
        "WhatsApp/Media", "WhatsApp Business/Media", "Whatsapp/Media"
    );

    // ─── Scan All Junk ────────────────────────────────────────────────────────
    @PluginMethod
    public void scanJunkFiles(PluginCall call) {
        getActivity().runOnUiThread(() -> {});
        new Thread(() -> {
            try {
                long tmpSize    = scanTmpFiles();
                long msgSize    = scanMsgFiles();
                long junkSize   = scanJunkDir();
                long appCache   = getAppCacheSize();
                long browserSz  = getBrowserCacheSize();
                long gameCache  = getGameCacheSize();

                JSObject result = new JSObject();
                JSObject data = new JSObject();
                data.put("tmp",      tmpSize);
                data.put("msg",      msgSize);
                data.put("junk",     junkSize);
                data.put("appcache", appCache);
                data.put("browser",  browserSz);
                data.put("notif",    getNotifCount() * 1024L);
                data.put("game",     gameCache);
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
                if (types.contains("tmp"))     { freed += deleteRecursive(getExternalRoot(), f -> matchesTmp(f));  Log.e(TAG, "tmp done freed="+freed); }
                if (types.contains("msg"))     { freed += cleanMsgFiles();                                          Log.e(TAG, "msg done freed="+freed); }
                if (types.contains("junk"))    { freed += deleteRecursive(getExternalRoot(), f -> matchesJunk(f)); Log.e(TAG, "junk done freed="+freed); }
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

                for (String waDir : WA_DIRS) {
                    String subFolder = getWASubfolder(type);
                    File dir = new File(ext, waDir + "/" + subFolder);
                    if (!dir.exists()) continue;

                    File[] listed = dir.listFiles();
                    if (listed == null) continue;

                    for (File f : listed) {
                        if (!f.isFile()) continue;
                        if (cutoffMs > 0 && f.lastModified() >= cutoffMs) continue;
                        if (!matchesMediaType(f.getName(), type)) continue;

                        JSObject item = new JSObject();
                        item.put("name",   f.getName());
                        item.put("path",   f.getAbsolutePath());
                        item.put("size",   f.length());
                        item.put("dateMs", f.lastModified());
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

                for (String pkg : BROWSER_PKGS) {
                    try {
                        ApplicationInfo info = pm.getApplicationInfo(pkg, 0);
                        File cacheDir = new File(getContext().getCacheDir().getParentFile().getParentFile(),
                            pkg + "/cache");
                        long cacheSize = getFolderSize(cacheDir);
                        if (cacheSize == 0) {
                            cacheDir = new File(Environment.getExternalStorageDirectory(),
                                "Android/data/" + pkg + "/cache");
                            cacheSize = getFolderSize(cacheDir);
                        }

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

    private long scanMsgFiles() {
        long size = 0;
        List<File> msgFiles = new ArrayList<>();
        findByExtension(getExternalRoot(), ".msg", msgFiles, 0);
        if (msgFiles.size() <= 1) return 0;

        msgFiles.sort((a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        for (int i = 1; i < msgFiles.size(); i++) {
            size += msgFiles.get(i).length();
        }
        return size;
    }

    private long cleanMsgFiles() {
        long freed = 0;
        List<File> msgFiles = new ArrayList<>();
        findByExtension(getExternalRoot(), ".msg", msgFiles, 0);
        if (msgFiles.size() <= 1) return 0;
        msgFiles.sort((a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        for (int i = 1; i < msgFiles.size(); i++) {
            freed += msgFiles.get(i).length();
            msgFiles.get(i).delete();
        }
        return freed;
    }

    private long scanJunkDir() {
        return scanForExtensions(getExternalRoot(), JUNK_EXT, 0);
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

    private long getGameCacheSize() {
        long size = 0;
        PackageManager pm = getContext().getPackageManager();
        List<ApplicationInfo> apps;
        try { apps = pm.getInstalledApplications(PackageManager.GET_META_DATA); }
        catch (Exception e) { return 0; }

        for (ApplicationInfo app : apps) {
            String pkg = app.packageName.toLowerCase();
            boolean isGame = false;
            for (String kw : GAME_KEYWORDS) {
                if (pkg.contains(kw)) { isGame = true; break; }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if ((app.category == ApplicationInfo.CATEGORY_GAME)) isGame = true;
            }
            if (!isGame) continue;
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
            String pkg = app.packageName.toLowerCase();
            boolean isGame = false;
            for (String kw : GAME_KEYWORDS) { if (pkg.contains(kw)) { isGame = true; break; } }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (app.category == ApplicationInfo.CATEGORY_GAME) isGame = true;
            }
            if (!isGame) continue;
            File cacheDir = new File(Environment.getExternalStorageDirectory(), "Android/data/" + app.packageName + "/cache");
            if (cacheDir.exists()) { freed += getFolderSize(cacheDir); deleteRecursiveDir(cacheDir); }
        }
        return freed;
    }

    private int getNotifCount() {
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager)
                getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                return nm.getActiveNotifications().length;
            }
        } catch (Exception e) {}
        return 0;
    }

    private void dismissAllNotifications() {
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager)
                getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            nm.cancelAll();
        } catch (Exception e) {
            Log.e(TAG, "dismissNotifications", e);
        }
    }

    // ─── File traversal helpers ───────────────────────────────────────────────

    interface FileFilter { boolean accept(File f); }

    private long deleteRecursive(File dir, FileFilter filter) {
        return deleteRecursive(dir, filter, 0);
    }

    private long deleteRecursive(File dir, FileFilter filter, int depth) {
        if (dir == null || !dir.exists() || depth > 6) return 0;
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
        if (dir == null || !dir.exists() || depth > 6) return 0;
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
        if (root == null || !root.exists() || depth > 6) return 0;
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

    private void findByExtension(File dir, String ext, List<File> result, int depth) {
        if (dir == null || !dir.exists() || depth > 6) return;
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

    private String getWASubfolder(String type) {
        switch (type) {
            case "video":    return "WhatsApp Video";
            case "image":    return "WhatsApp Images";
            case "document": return "WhatsApp Documents";
            case "audio":    return "WhatsApp Audio";
            default:         return "WhatsApp Images";
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

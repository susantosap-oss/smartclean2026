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
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

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

    // Share (out of 100) of scan progress attributed to the combined root-storage walk;
    // the remaining few points are reserved for the final resolve step.
    private static final int ROOT_WEIGHT = 97;

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
    // Used to also scan "App Cache" (all installed apps), "Browser Cache" and "Game
    // Cache" here, but Android's scoped storage (enforced since Android 11) blocks any
    // third-party app — SmartClean included, regardless of permissions granted — from
    // reading OTHER apps' Android/data/<pkg>/cache at all. In practice those three
    // buckets only ever reported SmartClean's own trivial cache (App Cache) or a
    // permanent 0 (Browser/Game Cache, since neither package list ever includes
    // SmartClean itself) — numbers that looked like a working feature but never were.
    // Removed rather than kept as dead weight; see the "Browser Cleaner" advance-menu
    // card for the honest replacement (deep-links to the OS's own storage cleaner).
    @PluginMethod
    public void scanJunkFiles(PluginCall call) {
        getActivity().runOnUiThread(() -> {});
        new Thread(() -> {
            try {
                final AtomicInteger progress = new AtomicInteger(0);
                ScanTotals totals = scanRootCombined(progress);

                long tmpSize    = totals.tmp;
                long junkSize   = totals.junk + scanOrphanedAppData();
                long msgSize    = sizeDbBackups(totals.dbFiles);
                int  notifCount = getNotifCount();
                boolean notifGranted = NotificationService.instance != null;

                JSObject doneProgress = new JSObject();
                doneProgress.put("percent", 100);
                doneProgress.put("stage", "done");
                notifyListeners("scanProgress", doneProgress);

                Log.e(TAG, "SCAN RESULT: tmp=" + tmpSize + " msg=" + msgSize + " junk=" + junkSize
                    + " notif=" + notifCount + " notifSvcConnected=" + notifGranted);

                JSObject result = new JSObject();
                JSObject data = new JSObject();
                data.put("tmp",              tmpSize);
                data.put("msg",              msgSize);
                data.put("junk",             junkSize);
                data.put("notif",            notifCount * 1024L);
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
    // The tmp/thumbnail-dir/junk/db-backup deletion is done in ONE combined walk
    // (deleteCombinedRoot(), gated per-type so partial selections behave exactly like
    // before) instead of up to 8 separate full-tree delete walks — this is what was
    // making "Select All" clean take 50-70s. "appcache"/"browser"/"game" types were
    // removed along with their scan buckets — see scanJunkFiles()'s comment.
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
                final AtomicInteger progress = new AtomicInteger(0);
                boolean doTmp  = types.contains("tmp");
                boolean doMsg  = types.contains("msg");
                boolean doJunk = types.contains("junk");

                if (doTmp || doMsg || doJunk) {
                    CleanTotals ct = deleteCombinedRoot(doTmp, doJunk, progress);
                    freed += ct.freed;
                    Log.e(TAG, "root walk done freed=" + freed);
                    if (doMsg)  { freed += pruneDbBackups(ct.dbFiles); Log.e(TAG, "msg done freed="+freed); }
                    if (doJunk) { freed += cleanOrphanedAppData();     Log.e(TAG, "junk done freed="+freed); }
                }
                bumpProgress(progress, 90, "root", "cleanProgress");

                if (types.contains("notif")) { dismissAllNotifications(); bumpProgress(progress, 96, "notif", "cleanProgress"); Log.e(TAG, "notif done"); }
                bumpProgress(progress, 100, "done", "cleanProgress");
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
        Log.e(TAG, "scanWAMedia type=" + type + " cutoffMs=" + cutoffMs + " now=" + System.currentTimeMillis());

        new Thread(() -> {
            try {
                JSArray files = new JSArray();
                File ext = Environment.getExternalStorageDirectory();
                // De-dupe: legacy and scoped-storage roots can both resolve to the
                // same real folder (symlinked by the OS), so track paths already added.
                java.util.Set<String> seenPaths = new java.util.HashSet<>();
                // De-dupe at the directory level too: on Android's case-insensitive
                // storage FUSE layer, "WhatsApp/Media" and "Whatsapp/Media" (kept in
                // WA_APPS for older case-sensitive filesystems) resolve to the SAME
                // real folder, so scanning both double-counts every file in it — file-path
                // de-dupe alone doesn't catch this because the two paths differ only by
                // case and are therefore different strings.
                java.util.Set<String> seenDirs = new java.util.HashSet<>();

                for (String[] app : WA_APPS) {
                    String mediaRoot = app[0];
                    String prefix    = app[1];
                    String source    = app[2];
                    String subFolder = getWASubfolder(prefix, type);
                    File dir = new File(ext, mediaRoot + "/" + subFolder);
                    boolean exists = dir.exists();
                    String dirKey;
                    try { dirKey = dir.getCanonicalPath().toLowerCase(java.util.Locale.ROOT); }
                    catch (Exception e) { dirKey = dir.getAbsolutePath().toLowerCase(java.util.Locale.ROOT); }
                    boolean isDup = exists && !seenDirs.add(dirKey);
                    File[] listed = (exists && !isDup) ? dir.listFiles() : null;
                    Log.e(TAG, "scanWAMedia dir=" + dir.getAbsolutePath()
                        + " exists=" + exists + " dup=" + isDup
                        + " listedCount=" + (listed != null ? listed.length : -1));
                    if (!exists || isDup || listed == null) continue;

                    int matchedExt = 0, matchedCutoff = 0;
                    for (File f : listed) {
                        if (!f.isFile()) continue;
                        if (!matchesMediaType(f.getName(), type)) continue;
                        matchedExt++;
                        if (cutoffMs > 0 && f.lastModified() >= cutoffMs) continue;
                        matchedCutoff++;
                        if (!seenPaths.add(f.getAbsolutePath())) continue;

                        JSObject item = new JSObject();
                        item.put("name",   f.getName());
                        item.put("path",   f.getAbsolutePath());
                        item.put("size",   f.length());
                        item.put("dateMs", f.lastModified());
                        item.put("source", source);
                        files.put(item);
                        Log.e(TAG, "scanWAMedia MATCH name=" + f.getName() + " size=" + f.length()
                            + " lastModified=" + f.lastModified());
                    }
                    Log.e(TAG, "scanWAMedia dir=" + dir.getName()
                        + " matchedExt=" + matchedExt + " passedCutoff=" + matchedCutoff);
                }

                JSObject res = new JSObject();
                res.put("files", files);
                Log.e(TAG, "scanWAMedia TOTAL files=" + files.length());
                call.resolve(res);
            } catch (Exception e) {
                Log.e(TAG, "scanWAMedia ERROR", e);
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

    // ─── Progress reporting ────────────────────────────────────────────────────
    // Monotonic on purpose: both scanJunkFiles() and cleanJunkFiles() run their walk
    // on a single background thread with a straightforward increasing budget, so an
    // absolute cumulative target is safe — clamping to "only ever increase" is just a
    // safety net against a stray late/duplicate call.
    private void bumpProgress(AtomicInteger tracker, int target, String stage, String eventName) {
        int prev;
        do {
            prev = tracker.get();
            if (target <= prev) return;
        } while (!tracker.compareAndSet(prev, target));
        JSObject d = new JSObject();
        d.put("percent", target);
        d.put("stage", stage);
        notifyListeners(eventName, d);
    }

    private static class ScanTotals {
        long tmp;
        long junk;
        final List<File> dbFiles = new ArrayList<>();
    }

    // Progress that needs to know a total in advance (pre-count the tree, then walk it)
    // has its own failure mode: the count-only pass is itself a full traversal, and if
    // the FIRST folder visited happens to be large (WhatsApp media, Android/data, ...),
    // the percent still sits frozen for however long that first folder takes to count —
    // just shifted earlier instead of fixed. An asymptotic curve sidesteps needing a
    // total at all: percent = weight * v/(v+K) climbs immediately from the very first
    // entry visited (v=1) and approaches (never quite reaches) the weight cap as more
    // entries are seen, so there's no silent phase before the first visible tick, and no
    // second pass over the tree. The K constant is where progress reads "roughly half the
    // stage's budget spent" — tuned to typical external-storage file counts.
    private static final double PROGRESS_HALF_LIFE = 2500.0;

    private static int asymptoticPercent(long visited, int weight) {
        return (int) Math.round((visited / (visited + PROGRESS_HALF_LIFE)) * weight);
    }

    // Single combined pass over external storage that computes tmp/junk/db-backup
    // totals together. Previously tmp-ext, each of the 6 thumbnail-dir names, junk-ext
    // and db-ext were each scanned via their OWN full recursive walk of the whole
    // storage (9 walks total) — that repetition, multiplied by however many files are
    // on the device, is why scan time scaled so badly with storage capacity. One pass
    // classifies every file/dir against all rule sets at once, reporting progress per
    // entry visited via the asymptotic curve above.
    private ScanTotals scanRootCombined(AtomicInteger progress) {
        ScanTotals totals = new ScanTotals();
        File root = getExternalRoot();
        File[] top = root.exists() ? root.listFiles() : null;
        if (top == null || top.length == 0) {
            bumpProgress(progress, ROOT_WEIGHT, "root", "scanProgress");
            return totals;
        }
        AtomicLong visited = new AtomicLong(0);
        for (File t : top) {
            walkCombined(t, totals, 0, visited, progress);
        }
        bumpProgress(progress, ROOT_WEIGHT, "root", "scanProgress");
        return totals;
    }

    // Mirrors the union of the old scanTmpFiles()+findDirSize() (a directory named like
    // a thumbnail cache has its whole size counted, matching the original behavior) and
    // the old JUNK_EXT/DB_BACKUP_EXT full-tree walks. The TMP_EXT and JUNK_EXT checks
    // stay independent (not else-if): the original code let a name matching both lists
    // (".dmp" is in both) count toward both totals, so keeping that avoids silently
    // shrinking the reported size.
    private void walkCombined(File f, ScanTotals totals, int depth, AtomicLong visited, AtomicInteger progress) {
        if (f == null || depth > MAX_SCAN_DEPTH) return;
        long v = visited.incrementAndGet();
        bumpProgress(progress, asymptoticPercent(v, ROOT_WEIGHT), "root", "scanProgress");
        if (f.isDirectory()) {
            for (String td : THUMB_DIRS) {
                if (f.getName().equalsIgnoreCase(td)) { totals.tmp += getFolderSize(f); break; }
            }
            File[] children = f.listFiles();
            if (children == null) return;
            for (File c : children) walkCombined(c, totals, depth + 1, visited, progress);
        } else {
            String name = f.getName().toLowerCase();
            for (String ext : TMP_EXT)  { if (name.endsWith(ext)) { totals.tmp  += f.length(); break; } }
            for (String ext : JUNK_EXT) { if (name.endsWith(ext)) { totals.junk += f.length(); break; } }
            if (name.endsWith(DB_BACKUP_EXT)) totals.dbFiles.add(f);
        }
    }

    // WhatsApp / WhatsApp Business encrypted DB backups are grouped by their containing
    // folder so WhatsApp's and WhatsApp Business's backups are kept/pruned independently
    // instead of one app's newer backup wiping out the other app's only backup.
    private long sizeDbBackups(List<File> dbFiles) {
        long size = 0;
        for (List<File> group : groupByParent(dbFiles).values()) {
            if (group.size() <= 1) continue;
            group.sort((a, b) -> Long.compare(b.lastModified(), a.lastModified()));
            for (int i = 1; i < group.size(); i++) size += group.get(i).length();
        }
        return size;
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

    // ─── Combined clean walk ───────────────────────────────────────────────────

    private static class CleanTotals {
        long freed;
        final List<File> dbFiles = new ArrayList<>();
    }

    // Same consolidation as scanRootCombined() but destructive: deletes tmp-ext files,
    // whole thumbnail-cache directories and junk-ext files in ONE walk (replacing up to
    // 8 separate full-tree delete walks), and collects db-backup files for pruneDbBackups()
    // to grouped-prune afterward. doTmp/doJunk gate which rules actually delete anything
    // so a partial type selection (e.g. only "junk") behaves exactly like the old
    // per-type methods did — db-backup files are always collected regardless (just a list
    // add) so a "msg"-only selection still finds them without its own walk.
    // Same asymptotic-curve progress as scanRootCombined() — no pre-count pass, so
    // there's no phase where the popup can sit frozen while a first/large folder is
    // being sized up; the very first entry deleted already produces a visible tick.
    private CleanTotals deleteCombinedRoot(boolean doTmp, boolean doJunk, AtomicInteger progress) {
        CleanTotals totals = new CleanTotals();
        File root = getExternalRoot();
        File[] top = root.exists() ? root.listFiles() : null;
        if (top == null || top.length == 0) return totals;

        final int rootBudget = 90;
        AtomicLong visited = new AtomicLong(0);
        for (File t : top) {
            totals.freed += deleteCombinedWalk(t, doTmp, doJunk, totals.dbFiles, 0, visited, progress, rootBudget);
        }
        bumpProgress(progress, rootBudget, "root", "cleanProgress");
        return totals;
    }

    private long deleteCombinedWalk(File f, boolean doTmp, boolean doJunk, List<File> dbOut, int depth,
                                     AtomicLong visited, AtomicInteger progress, int rootBudget) {
        if (f == null || !f.exists() || depth > MAX_SCAN_DEPTH) return 0;
        long freed = 0;
        long v = visited.incrementAndGet();
        bumpProgress(progress, asymptoticPercent(v, rootBudget), "root", "cleanProgress");
        if (f.isDirectory()) {
            if (doTmp) {
                for (String td : THUMB_DIRS) {
                    if (f.getName().equalsIgnoreCase(td)) {
                        freed += getFolderSize(f);
                        deleteRecursiveDir(f);
                        return freed; // contents are gone, nothing left to recurse into
                    }
                }
            }
            File[] children = f.listFiles();
            if (children == null) return freed;
            for (File c : children) freed += deleteCombinedWalk(c, doTmp, doJunk, dbOut, depth + 1, visited, progress, rootBudget);
        } else {
            String name = f.getName().toLowerCase();
            boolean deleted = false;
            if (doTmp) {
                for (String ext : TMP_EXT) { if (name.endsWith(ext)) { freed += f.length(); f.delete(); deleted = true; break; } }
            }
            if (!deleted && doJunk) {
                for (String ext : JUNK_EXT) { if (name.endsWith(ext)) { freed += f.length(); f.delete(); deleted = true; break; } }
            }
            if (!deleted && name.endsWith(DB_BACKUP_EXT)) dbOut.add(f);
        }
        return freed;
    }

    private long pruneDbBackups(List<File> dbFiles) {
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

    // ─── Misc file helpers ─────────────────────────────────────────────────────

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

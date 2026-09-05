package com.smartclean.app.plugins;

import android.os.Environment;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@CapacitorPlugin(name = "DuplicateFinder")
public class DuplicateFinderPlugin extends Plugin {

    private static final String TAG = "DuplicateFinderPlugin";

    private static final List<String> IMAGE_EXT = Arrays.asList(".jpg", ".jpeg", ".png", ".webp", ".heic", ".bmp");
    private static final List<String> VIDEO_EXT = Arrays.asList(".mp4", ".mkv", ".avi", ".3gp", ".mov", ".webm");
    private static final List<String> SKIP_DIRS  = Arrays.asList("Android/obb", "Android/data/com.android.providers", ".android_secure");

    @PluginMethod
    public void scanDuplicates(PluginCall call) {
        String scope = call.getString("scope", "all");
        new Thread(() -> {
            try {
                File root = Environment.getExternalStorageDirectory();
                List<File> allFiles = new ArrayList<>();
                collectFiles(root, scope, allFiles, 0);

                // Group by size first (fast pre-filter)
                Map<Long, List<File>> bySize = new HashMap<>();
                for (File f : allFiles) {
                    long sz = f.length();
                    if (sz < 10 * 1024) continue; // skip files < 10KB
                    bySize.computeIfAbsent(sz, k -> new ArrayList<>()).add(f);
                }

                // Hash files with same size
                Map<String, List<File>> byHash = new HashMap<>();
                for (Map.Entry<Long, List<File>> entry : bySize.entrySet()) {
                    if (entry.getValue().size() < 2) continue;
                    for (File f : entry.getValue()) {
                        String hash = md5(f);
                        if (hash == null) continue;
                        byHash.computeIfAbsent(hash, k -> new ArrayList<>()).add(f);
                    }
                }

                JSArray groups = new JSArray();
                for (Map.Entry<String, List<File>> entry : byHash.entrySet()) {
                    if (entry.getValue().size() < 2) continue;
                    List<File> dups = entry.getValue();

                    JSObject group = new JSObject();
                    group.put("hash", entry.getKey());
                    long totalSize = 0;
                    for (File f : dups) totalSize += f.length();
                    group.put("totalSize", totalSize);

                    JSArray files = new JSArray();
                    for (File f : dups) {
                        JSObject fi = new JSObject();
                        fi.put("path",   f.getAbsolutePath());
                        fi.put("name",   f.getName());
                        fi.put("size",   f.length());
                        fi.put("dateMs", f.lastModified());
                        files.put(fi);
                    }
                    group.put("files", files);
                    groups.put(group);
                }

                JSObject res = new JSObject();
                res.put("groups", groups);
                res.put("totalFiles", allFiles.size());
                call.resolve(res);
            } catch (Exception e) {
                Log.e(TAG, "scanDuplicates", e);
                call.reject("Scan error: " + e.getMessage());
            }
        }).start();
    }

    // KNOWN GAP (not gated natively, unlike FileCleanerPlugin/AppManagerPlugin's Pro-locked
    // methods): Duplicate Finder's Free tier isn't an all-or-nothing lock — it's windowed
    // (photos-only scope, first DUP_FREE_GROUP_CAP groups only, see src/js/app.js
    // visibleDupGroups()). Replicating that windowing natively would mean duplicating the
    // whole duplicate-scan result here just to re-validate which paths were "supposed" to
    // be visible, which is out of scope for this pass. A modder who patches app.js to widen
    // dupSelected beyond visibleDupGroups() can still delete extra duplicate files on a
    // Free install — lower severity than the other native gaps closed elsewhere in this
    // pass (it only ever deletes genuine duplicates the user already has, never unlocks an
    // otherwise-inaccessible feature), but it is a real, deliberately-left gap.
    @PluginMethod
    public void deleteFiles(PluginCall call) {
        JSArray pathsArr = call.getArray("paths");
        new Thread(() -> {
            try {
                long freed = 0;
                int deleted = 0;
                if (pathsArr != null) {
                    for (int i = 0; i < pathsArr.length(); i++) {
                        File f = new File(pathsArr.getString(i));
                        if (f.exists() && f.isFile()) {
                            freed += f.length();
                            if (f.delete()) deleted++;
                        }
                    }
                }
                JSObject res = new JSObject();
                res.put("freedBytes",   freed);
                res.put("deletedCount", deleted);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Delete error: " + e.getMessage());
            }
        }).start();
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private void collectFiles(File dir, String scope, List<File> out, int depth) {
        if (dir == null || !dir.exists() || !dir.isDirectory() || depth > 8) return;

        String relPath = dir.getAbsolutePath()
            .replace(Environment.getExternalStorageDirectory().getAbsolutePath(), "");
        for (String skip : SKIP_DIRS) {
            if (relPath.contains(skip)) return;
        }

        File[] files = dir.listFiles();
        if (files == null) return;

        for (File f : files) {
            if (f.isDirectory()) {
                collectFiles(f, scope, out, depth + 1);
            } else {
                if (matchesScope(f.getName(), scope)) {
                    out.add(f);
                }
            }
        }
    }

    private boolean matchesScope(String name, String scope) {
        name = name.toLowerCase();
        switch (scope) {
            case "photos":
                for (String ext : IMAGE_EXT) { if (name.endsWith(ext)) return true; }
                return false;
            case "videos":
                for (String ext : VIDEO_EXT) { if (name.endsWith(ext)) return true; }
                return false;
            default: // "all"
                for (String ext : IMAGE_EXT) { if (name.endsWith(ext)) return true; }
                for (String ext : VIDEO_EXT) { if (name.endsWith(ext)) return true; }
                // Also include audio and docs
                return name.endsWith(".mp3") || name.endsWith(".pdf") || name.endsWith(".apk");
        }
    }

    private String md5(File file) {
        try (FileInputStream fis = new FileInputStream(file)) {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] buffer = new byte[8192];
            // Only hash first 64KB for speed (good enough for duplicate detection)
            int bytesRead, totalRead = 0;
            while ((bytesRead = fis.read(buffer)) != -1 && totalRead < 65536) {
                md.update(buffer, 0, bytesRead);
                totalRead += bytesRead;
            }
            byte[] digest = md.digest();
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) sb.append(String.format("%02x", b));
            // Append file size to reduce false positives on partial hash
            return sb + "_" + file.length();
        } catch (Exception e) {
            return null;
        }
    }
}

package com.smartclean.app.service;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationManagerCompat;

public class NotificationService extends NotificationListenerService {

    public static NotificationService instance;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        instance = null;
    }

    public static void dismissAll() {
        if (instance != null) {
            try { instance.cancelAllNotifications(); } catch (Exception ignored) {}
        }
    }

    public static boolean isEnabled(Context context) {
        return NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.getPackageName());
    }

    // Some OEM skins (ColorOS/Realme in particular) don't rebind this listener service
    // right after the user grants access in system Settings, leaving `instance` null
    // until the app is force-restarted. Fire-and-forget version for the UI thread (e.g.
    // MainActivity.onResume()) — kicks off the OS's own requestRebind() so it has a head
    // start by the time the user actually taps Scan, without blocking anything here.
    public static void requestRebindAsync(Context context) {
        if (instance != null || !isEnabled(context)) return;
        try {
            requestRebind(new ComponentName(context, NotificationService.class));
        } catch (Exception ignored) {}
    }

    // Blocking version — only call from a background thread (e.g. FileCleanerPlugin's
    // scan, which already runs off the UI thread). Tries the official requestRebind()
    // API first and waits briefly for it to land; if that still hasn't connected (seen
    // on some ColorOS builds), falls back to toggling the component's enabled state,
    // which forces an unbind/rebind the framework can't ignore.
    public static void forceRebindIfNeeded(Context context) {
        if (instance != null || !isEnabled(context)) return;
        try {
            ComponentName cn = new ComponentName(context, NotificationService.class);
            requestRebind(cn);
            for (int i = 0; i < 14 && instance == null; i++) {
                Thread.sleep(150);
            }
            if (instance == null) {
                PackageManager pm = context.getPackageManager();
                pm.setComponentEnabledSetting(cn, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
                pm.setComponentEnabledSetting(cn, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
                for (int i = 0; i < 10 && instance == null; i++) {
                    Thread.sleep(150);
                }
            }
        } catch (Exception ignored) {}
    }
}

package com.smartclean.app.service;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

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
}

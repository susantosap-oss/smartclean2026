package com.smartclean.app.plugins;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

// Flexible (non-blocking) in-app update: lets testers who can't be reached directly
// (e.g. anonymous r/testercommunity recruits) still get prompted to update from inside
// the app itself, independent of whether their device has Play Store auto-update on.
// Deliberately FLEXIBLE, not IMMEDIATE — this is a casual cleaner app, so update
// downloads in the background while the user keeps using it; they're only interrupted
// once it's ready, to confirm the restart-to-install.
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String TAG = "AppUpdatePlugin";

    private AppUpdateManager appUpdateManager;
    private InstallStateUpdatedListener installListener;

    @Override
    public void load() {
        appUpdateManager = AppUpdateManagerFactory.create(getContext());
        // Registered once for the plugin's lifetime rather than per startUpdate() call —
        // this is the only reliable way to learn a background flexible download finished,
        // since that can happen minutes after startUpdate() returned.
        installListener = state -> {
            if (state.installStatus() == InstallStatus.DOWNLOADED) {
                notifyListeners("updateDownloaded", new JSObject());
            }
        };
        appUpdateManager.registerListener(installListener);
    }

    // Resolves { available, downloaded }. "downloaded" covers the case where a flexible
    // update finished downloading in a previous session but the user never restarted —
    // Play Core keeps that state until completeUpdate() actually runs.
    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        appUpdateManager.getAppUpdateInfo()
                .addOnSuccessListener(info -> {
                    JSObject res = new JSObject();
                    res.put("available",
                            info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                                    && info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE));
                    res.put("downloaded", info.installStatus() == InstallStatus.DOWNLOADED);
                    call.resolve(res);
                })
                .addOnFailureListener(e -> {
                    // Best-effort feature — e.g. app not installed via Play Store (sideloaded
                    // APK, unlocked/betatest flavor) always fails here. Never surface as an error.
                    JSObject res = new JSObject();
                    res.put("available", false);
                    res.put("downloaded", false);
                    call.resolve(res);
                });
    }

    @PluginMethod
    public void startUpdate(PluginCall call) {
        appUpdateManager.getAppUpdateInfo()
                .addOnSuccessListener(info -> {
                    if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE
                            || !info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) {
                        call.reject("No flexible update available");
                        return;
                    }
                    try {
                        appUpdateManager.startUpdateFlowForResult(
                                info, AppUpdateType.FLEXIBLE, getActivity(), 5405);
                        // Not waiting on the confirmation dialog's own result here — whether the
                        // user accepted just determines if the background download starts; the
                        // real "ready" signal is installListener's DOWNLOADED state above.
                        call.resolve();
                    } catch (Exception e) {
                        call.reject("Failed to start update: " + e.getMessage());
                    }
                })
                .addOnFailureListener(e -> call.reject("Update check failed: " + e.getMessage()));
    }

    @PluginMethod
    public void completeUpdate(PluginCall call) {
        appUpdateManager.completeUpdate();
        call.resolve();
    }
}

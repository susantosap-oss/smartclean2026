package com.smartclean.app.plugins;

import android.app.Activity;
import android.util.Log;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryProductDetailsResult;
import com.android.billingclient.api.QueryPurchasesParams;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

// Google Play Billing wrapper for the "SmartClean Pro" one-time (non-consumable)
// unlock — see DEVELOP.md "Phase 2 — Freemium & In-App Purchase" for the product
// spec this implements. Product must be created in Play Console → Monetize →
// Products → In-app products with this exact ID before purchase flow will work.
@CapacitorPlugin(name = "BillingManager")
public class BillingManagerPlugin extends Plugin implements PurchasesUpdatedListener {

    private static final String TAG = "BillingManagerPlugin";
    public static final String PRO_PRODUCT_ID = "smartclean_pro";

    private BillingClient billingClient;
    private ProductDetails proProductDetails;
    private boolean isPro = false;
    private PluginCall pendingPurchaseCall;

    @Override
    public void load() {
        billingClient = BillingClient.newBuilder(getContext())
                .setListener(this)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder()
                        .enableOneTimeProducts()
                        .build())
                .enableAutoServiceReconnection()
                .build();
        connect(null);
    }

    private void connect(Runnable onReady) {
        if (billingClient.isReady()) {
            if (onReady != null) onReady.run();
            return;
        }
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult billingResult) {
                if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    refreshOwnedPurchases(onReady);
                } else {
                    Log.e(TAG, "Billing setup failed: " + billingResult.getDebugMessage());
                    if (onReady != null) onReady.run();
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                // enableAutoServiceReconnection() handles reconnection automatically.
            }
        });
    }

    // ─── Current Pro status (source of truth: Play Store purchase state) ─────
    @PluginMethod
    public void getProStatus(PluginCall call) {
        connect(() -> {
            JSObject res = new JSObject();
            res.put("isPro", isPro);
            call.resolve(res);
        });
    }

    // ─── Price/title for the upgrade screen ───────────────────────────────────
    @PluginMethod
    public void getProductDetails(PluginCall call) {
        connect(() -> queryProProduct(details -> {
            if (details == null) {
                call.reject("Produk " + PRO_PRODUCT_ID + " tidak ditemukan. Pastikan sudah didaftarkan & aktif di Play Console.");
                return;
            }
            call.resolve(productToJs(details));
        }));
    }

    // ─── Launch purchase flow — result delivered via onPurchasesUpdated() ────
    @PluginMethod
    public void purchasePro(PluginCall call) {
        if (isPro) {
            JSObject res = new JSObject();
            res.put("isPro", true);
            call.resolve(res);
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity tidak tersedia");
            return;
        }

        connect(() -> queryProProduct(details -> {
            if (details == null) {
                call.reject("Produk " + PRO_PRODUCT_ID + " tidak ditemukan. Pastikan sudah didaftarkan & aktif di Play Console.");
                return;
            }

            BillingFlowParams.ProductDetailsParams productParams =
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                            .setProductDetails(details)
                            .build();
            BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(Collections.singletonList(productParams))
                    .build();

            pendingPurchaseCall = call;
            BillingResult result = billingClient.launchBillingFlow(activity, flowParams);
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                pendingPurchaseCall = null;
                call.reject("Gagal membuka billing flow: " + result.getDebugMessage());
            }
        }));
    }

    // ─── Restore purchases (re-sync from Play Store — e.g. after reinstall) ──
    @PluginMethod
    public void restorePurchases(PluginCall call) {
        connect(() -> refreshOwnedPurchases(() -> {
            JSObject res = new JSObject();
            res.put("isPro", isPro);
            call.resolve(res);
        }));
    }

    // ─── PurchasesUpdatedListener — fires after launchBillingFlow() completes ─
    @Override
    public void onPurchasesUpdated(BillingResult billingResult, List<Purchase> purchases) {
        PluginCall call = pendingPurchaseCall;
        pendingPurchaseCall = null;

        int code = billingResult.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase purchase : purchases) handlePurchase(purchase);
            if (call != null) {
                JSObject res = new JSObject();
                res.put("isPro", isPro);
                call.resolve(res);
            }
        } else if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            if (call != null) call.reject("cancelled");
        } else {
            if (call != null) call.reject("Billing error: " + billingResult.getDebugMessage());
        }
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    private void refreshOwnedPurchases(Runnable done) {
        QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP)
                .build();
        billingClient.queryPurchasesAsync(params, (billingResult, purchases) -> {
            boolean owned = false;
            if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                for (Purchase purchase : purchases) {
                    if (purchase.getProducts().contains(PRO_PRODUCT_ID)
                            && purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                        owned = true;
                        handlePurchase(purchase);
                    }
                }
            }
            isPro = owned;
            JSObject data = new JSObject();
            data.put("isPro", isPro);
            notifyListeners("proStatusChanged", data);
            if (done != null) done.run();
        });
    }

    // Grants entitlement immediately on PURCHASED state, then acknowledges
    // (required within 3 days or Google auto-refunds the purchase).
    private void handlePurchase(Purchase purchase) {
        if (!purchase.getProducts().contains(PRO_PRODUCT_ID)) return;
        if (purchase.getPurchaseState() != Purchase.PurchaseState.PURCHASED) return;
        isPro = true;
        if (!purchase.isAcknowledged()) {
            AcknowledgePurchaseParams ackParams = AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(purchase.getPurchaseToken())
                    .build();
            billingClient.acknowledgePurchase(ackParams, billingResult -> {
                if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    Log.e(TAG, "acknowledgePurchase failed: " + billingResult.getDebugMessage());
                }
            });
        }
    }

    private interface ProductCallback { void onResult(ProductDetails details); }

    private void queryProProduct(ProductCallback cb) {
        if (proProductDetails != null) { cb.onResult(proProductDetails); return; }

        QueryProductDetailsParams.Product product = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(PRO_PRODUCT_ID)
                .setProductType(BillingClient.ProductType.INAPP)
                .build();
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(product))
                .build();

        billingClient.queryProductDetailsAsync(params, (billingResult, result) -> {
            List<ProductDetails> list = (result != null) ? result.getProductDetailsList() : new ArrayList<>();
            proProductDetails = (list != null && !list.isEmpty()) ? list.get(0) : null;
            cb.onResult(proProductDetails);
        });
    }

    private JSObject productToJs(ProductDetails details) {
        JSObject res = new JSObject();
        res.put("productId", details.getProductId());
        res.put("title", details.getTitle());
        res.put("description", details.getDescription());
        ProductDetails.OneTimePurchaseOfferDetails offer = details.getOneTimePurchaseOfferDetails();
        if (offer != null) {
            res.put("formattedPrice", offer.getFormattedPrice());
            res.put("priceAmountMicros", offer.getPriceAmountMicros());
            res.put("currencyCode", offer.getPriceCurrencyCode());
        } else {
            res.put("formattedPrice", "-");
        }
        return res;
    }
}

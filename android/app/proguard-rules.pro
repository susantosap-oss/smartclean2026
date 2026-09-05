-keep class com.getcapacitor.** { *; }
-keep class com.smartclean.app.** { *; }
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-dontwarn okhttp3.**
-dontwarn okio.**

# Note: the blanket com.smartclean.app.** keep above already covers the new
# com.smartclean.app.security.** package (EntitlementGuard/IntegrityGuard/LicenseVerifier/
# Obfuscated) and SecurityPlugin, so no additional rule is needed for those. Capacitor's own
# @CapacitorPlugin/Plugin-subclass keep rules (required for our plugins to survive R8 via
# reflection) come from node_modules/@capacitor/android's consumerProguardFiles — Gradle
# merges those automatically since app/build.gradle depends on the capacitor-android module,
# they do not need to be duplicated here.

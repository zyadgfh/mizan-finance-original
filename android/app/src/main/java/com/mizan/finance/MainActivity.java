package com.mizan.finance;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Looper;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    /**
     * Hosts the native bridge may be called from. Anything else (file://,
     * arbitrary https origins, injected frames) is rejected (audit finding 18).
     */
    private static final java.util.Set<String> TRUSTED_WEB_HOSTS = new java.util.HashSet<>(
        java.util.Arrays.asList("localhost", "127.0.0.1", "mizan-finance-rho.vercel.app")
    );

    private volatile String pendingLaunchUrl = null;
    /**
     * Last known WebView URL captured exclusively on the Android UI thread.
     * `@JavascriptInterface` methods run on the background `JavaBridge` thread,
     * where calling `webView.getUrl()` directly throws a WebView thread violation.
     */
    private volatile String currentWebUrl = null;

    /**
     * A single biometric prompt may be open at a time. The WebView can fire the
     * bridge repeatedly (double taps, retries after a timeout), and stacking
     * prompts would let a stale callback unlock the app later.
     */
    private volatile boolean biometricInFlight = false;

    private boolean biometricSensorAvailable() {
        try {
            return BiometricManager.from(this)
                    .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                == BiometricManager.BIOMETRIC_SUCCESS;
        } catch (Exception e) {
            // No biometric hardware, nothing enrolled, or a vendor sensor that
            // crashes BiometricManager: treat all three as "not available".
            return false;
        }
    }

    /**
     * Starts the system biometric prompt and reports the outcome to
     * `window.__mizanBiometric(requestId, ok, code)`.
     *
     * Returns false when the request was refused immediately (untrusted origin,
     * bad id, or a prompt already open) so the caller can fail closed without
     * waiting for a callback that will never arrive.
     */
    private boolean startBiometricPrompt(String requestId) {
        if (requestId == null || requestId.trim().isEmpty()) return false;
        if (biometricInFlight) return false;
        biometricInFlight = true;
        final String id = requestId;
        runOnUiThread(() -> showBiometricPrompt(id));
        return true;
    }

    private void showBiometricPrompt(final String requestId) {
        final java.util.concurrent.atomic.AtomicBoolean settled =
            new java.util.concurrent.atomic.AtomicBoolean(false);
        try {
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(getString(R.string.biometric_title))
                .setSubtitle(getString(R.string.biometric_subtitle))
                .setNegativeButtonText(getString(R.string.biometric_cancel))
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setConfirmationRequired(false)
                .build();

            BiometricPrompt prompt = new BiometricPrompt(
                this,
                ContextCompat.getMainExecutor(this),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        settle(true, "ok");
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence errString) {
                        settle(false, "error_" + errorCode);
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        // A single non-matching finger; the system prompt stays up
                        // and the user may retry, so this is not a final answer.
                    }

                    private void settle(boolean ok, String code) {
                        if (!settled.compareAndSet(false, true)) return;
                        biometricInFlight = false;
                        deliverBiometricResult(requestId, ok, code);
                    }
                }
            );
            prompt.authenticate(info);
        } catch (Exception e) {
            if (settled.compareAndSet(false, true)) {
                biometricInFlight = false;
                deliverBiometricResult(requestId, false, "exception");
            }
        }
    }

    private void deliverBiometricResult(String requestId, boolean ok, String code) {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;
        final String js = "window.__mizanBiometric&&window.__mizanBiometric("
            + JSONObject.quote(requestId == null ? "" : requestId)
            + "," + (ok ? "true" : "false")
            + "," + JSONObject.quote(code == null ? "" : code)
            + ");";
        runOnUiThread(() -> {
            try {
                webView.evaluateJavascript(js, null);
            } catch (Throwable ignored) {
            }
        });
    }

    private boolean isTrustedWebOrigin() {
        try {
            String url = currentWebUrl;
            if (Looper.myLooper() == Looper.getMainLooper()) {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null) {
                    String liveUrl = webView.getUrl();
                    if (liveUrl != null && !liveUrl.trim().isEmpty()) {
                        url = liveUrl;
                        currentWebUrl = liveUrl;
                    }
                }
            }
            if ((url == null || url.trim().isEmpty()) && getBridge() != null) {
                url = getBridge().getAppUrl();
            }
            if ((url == null || url.trim().isEmpty()) && getBridge() != null) {
                url = getBridge().getLocalUrl();
            }
            if (url == null || url.trim().isEmpty()) return false;
            Uri uri = Uri.parse(url);
            if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
            String host = uri.getHost();
            return host != null && TRUSTED_WEB_HOSTS.contains(host.toLowerCase(Locale.ROOT));
        } catch (Throwable t) {
            return false;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        captureIntentDeepLink(getIntent(), false);

        // Ensure Android 15/16 (targetSdk 36) edge-to-edge system bars, cutouts,
        // and IME soft keyboard never overlap WebView headers, tab bars, or inputs.
        View rootContent = findViewById(android.R.id.content);
        if (rootContent != null) {
            ViewCompat.setOnApplyWindowInsetsListener(rootContent, (view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                        | WindowInsetsCompat.Type.displayCutout()
                        | WindowInsetsCompat.Type.ime()
                );
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(rootContent);
        }

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView wv = getBridge().getWebView();
            String initialUrl = wv.getUrl();
            if (initialUrl == null || initialUrl.trim().isEmpty()) {
                initialUrl = getBridge().getAppUrl();
            }
            if (initialUrl == null || initialUrl.trim().isEmpty()) {
                initialUrl = getBridge().getLocalUrl();
            }
            currentWebUrl = initialUrl;

            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public void onPageStarted(WebView view) {
                    if (view != null) {
                        String u = view.getUrl();
                        if (u != null && !u.trim().isEmpty()) {
                            currentWebUrl = u;
                        }
                    }
                }

                @Override
                public void onPageCommitVisible(WebView view, String url) {
                    if (url != null && !url.trim().isEmpty()) {
                        currentWebUrl = url;
                    }
                }

                @Override
                public void onPageLoaded(WebView view) {
                    if (view != null) {
                        String u = view.getUrl();
                        if (u != null && !u.trim().isEmpty()) {
                            currentWebUrl = u;
                        }
                    }
                }
            });

            WebSettings settings = wv.getSettings();
            settings.setDomStorageEnabled(true);
            // The app is served from https://localhost; raw file:// access is
            // never needed and widens the XSS blast radius.
            settings.setAllowFileAccess(false);
            settings.setAllowFileAccessFromFileURLs(false);
            settings.setAllowUniversalAccessFromFileURLs(false);
            // Content access stays enabled only so the system file picker can
            // return content:// URIs for receipt/report imports.
            settings.setAllowContentAccess(true);
            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            settings.setSupportMultipleWindows(false);
            settings.setSaveFormData(false);
            settings.setMediaPlaybackRequiresUserGesture(true);
            settings.setGeolocationEnabled(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                settings.setSafeBrowsingEnabled(true);
            }
            wv.addJavascriptInterface(new MizanNativeBridge(), "MizanNative");
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                    return;
                }
                webView.evaluateJavascript(
                    "(function(){return window.__mizanBack ? Boolean(window.__mizanBack()) : false;})()",
                    value -> {
                        if (!"true".equals(value)) {
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                            setEnabled(true);
                        }
                    }
                );
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureIntentDeepLink(intent, true);
    }

    /** Only the app scheme and the production host may deliver deep links. */
    private static boolean isTrustedDeepLink(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if ("com.mizan.finance".equalsIgnoreCase(scheme)) return true;
        if (!"https".equalsIgnoreCase(scheme)) return false;
        return TRUSTED_WEB_HOSTS.contains(host);
    }

    private void captureIntentDeepLink(Intent intent, boolean dispatchImmediately) {
        if (intent == null || intent.getData() == null) return;
        Uri data = intent.getData();
        if (!isTrustedDeepLink(data)) return;
        String url = data.toString();
        if (url == null || url.trim().isEmpty()) return;
        pendingLaunchUrl = url;

        if (dispatchImmediately && getBridge() != null && getBridge().getWebView() != null) {
            final String quoted = JSONObject.quote(url);
            runOnUiThread(() -> {
                WebView webView = getBridge().getWebView();
                if (webView != null) {
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('mizan:deeplink',{detail:" + quoted + "}));",
                        null
                    );
                }
            });
        }
    }

    private final class MizanNativeBridge {
        /**
         * Android WebView does not implement WebAuthn, so the web layer cannot use
         * navigator.credentials here. These two methods expose the platform
         * BiometricPrompt (fingerprint / strong face) behind the same trusted-origin
         * check as every other bridge call.
         */
        @JavascriptInterface
        public boolean biometricAvailable() {
            try {
                if (!isTrustedWebOrigin()) return false;
                return MainActivity.this.biometricSensorAvailable();
            } catch (Throwable t) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean authenticateBiometric(String requestId) {
            try {
                if (!isTrustedWebOrigin()) return false;
                return MainActivity.this.startBiometricPrompt(requestId);
            } catch (Throwable t) {
                return false;
            }
        }

        private boolean dispatchShareBytes(String filename, String mimeType, byte[] bytes) {
            try {
                String safeName = (filename == null || filename.trim().isEmpty())
                    ? "mizan-export.bin"
                    : new File(filename).getName().replaceAll("[^a-zA-Z0-9._-]", "_");
                String safeMime = (mimeType == null || mimeType.trim().isEmpty())
                    ? "application/octet-stream"
                    : mimeType;
                File outFile = new File(getCacheDir(), safeName);
                try (FileOutputStream out = new FileOutputStream(outFile)) {
                    out.write(bytes);
                }
                Uri uri = FileProvider.getUriForFile(
                    MainActivity.this,
                    getPackageName() + ".fileprovider",
                    outFile
                );
                Intent share = new Intent(Intent.ACTION_SEND);
                share.setType(safeMime);
                share.putExtra(Intent.EXTRA_STREAM, uri);
                share.putExtra(Intent.EXTRA_SUBJECT, safeName);
                share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(share, safeName);
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(chooser));
                return true;
            } catch (Throwable e) {
                return false;
            }
        }

        @JavascriptInterface
        public String consumeLaunchUrl() {
            try {
                if (!isTrustedWebOrigin()) return "";
                String url = pendingLaunchUrl;
                pendingLaunchUrl = null;
                return url == null ? "" : url;
            } catch (Throwable t) {
                return "";
            }
        }

        @JavascriptInterface
        public String getAppVersion() {
            try {
                if (!isTrustedWebOrigin()) return "";
                android.content.pm.PackageInfo info =
                    getPackageManager().getPackageInfo(getPackageName(), 0);
                return info != null && info.versionName != null ? info.versionName : "";
            } catch (Throwable t) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean openExternalUrl(String rawUrl) {
            try {
                if (!isTrustedWebOrigin()) return false;
                if (rawUrl == null || rawUrl.trim().isEmpty()) return false;
                final Uri uri = Uri.parse(rawUrl.trim());
                if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
                String host = uri.getHost() != null ? uri.getHost().toLowerCase(Locale.ROOT) : "";
                String path = uri.getPath() != null ? uri.getPath() : "";
                boolean allowedGithubRelease =
                    "github.com".equals(host)
                        && path.startsWith("/zyadgfh/mizan-finance-original/");
                boolean allowedProdWeb = "mizan-finance-rho.vercel.app".equals(host);
                if (!allowedGithubRelease && !allowedProdWeb) return false;

                runOnUiThread(() -> {
                    try {
                        Intent viewIntent = new Intent(Intent.ACTION_VIEW, uri);
                        viewIntent.addCategory(Intent.CATEGORY_BROWSABLE);
                        viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(viewIntent);
                    } catch (Throwable ignored) {
                    }
                });
                return true;
            } catch (Throwable t) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean shareFile(String filename, String mimeType, String content) {
            try {
                if (!isTrustedWebOrigin()) return false;
                byte[] bytes = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);
                return dispatchShareBytes(filename, mimeType, bytes);
            } catch (Throwable t) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean shareBinaryFile(String filename, String mimeType, String base64Content) {
            try {
                if (!isTrustedWebOrigin()) return false;
                byte[] bytes = Base64.decode(base64Content == null ? "" : base64Content, Base64.DEFAULT);
                return dispatchShareBytes(filename, mimeType, bytes);
            } catch (Throwable e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean copyToClipboard(String text) {
            try {
                if (!isTrustedWebOrigin()) return false;
                final String safeText = text == null ? "" : text;
                runOnUiThread(() -> {
                    try {
                        ClipboardManager clipboard =
                            (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                        if (clipboard != null) {
                            ClipData clip = ClipData.newPlainText("Mizan", safeText);
                            clipboard.setPrimaryClip(clip);
                        }
                    } catch (Throwable ignored) {
                    }
                });
                return true;
            } catch (Throwable e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean setScreenSecure(boolean secure) {
            try {
                if (!isTrustedWebOrigin()) return false;
                runOnUiThread(() -> {
                    try {
                        if (secure) {
                            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                        } else {
                            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                        }
                    } catch (Throwable ignored) {
                    }
                });
                return true;
            } catch (Throwable t) {
                return false;
            }
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public boolean setSystemBarStyle(String hexColor, final boolean darkIcons) {
            try {
                if (!isTrustedWebOrigin()) return false;
                final int parsedColor = Color.parseColor(
                    (hexColor == null || hexColor.trim().isEmpty()) ? "#05070c" : hexColor.trim()
                );
                runOnUiThread(() -> {
                    try {
                        Window window = getWindow();
                        if (window == null) return;
                        View rootContent = findViewById(android.R.id.content);
                        if (rootContent != null) {
                            rootContent.setBackgroundColor(parsedColor);
                        }
                        window.getDecorView().setBackgroundColor(parsedColor);
                        window.setStatusBarColor(parsedColor);
                        window.setNavigationBarColor(parsedColor);
                        WindowInsetsControllerCompat controller =
                            WindowCompat.getInsetsController(window, window.getDecorView());
                        if (controller != null) {
                            controller.setAppearanceLightStatusBars(darkIcons);
                            controller.setAppearanceLightNavigationBars(darkIcons);
                        }
                    } catch (Throwable ignored) {
                    }
                });
                return true;
            } catch (Throwable e) {
                return false;
            }
        }
    }
}

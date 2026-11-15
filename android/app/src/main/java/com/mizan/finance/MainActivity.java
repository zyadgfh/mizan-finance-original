package com.mizan.finance;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private volatile String pendingLaunchUrl = null;

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
            WebSettings settings = wv.getSettings();
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
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

    private void captureIntentDeepLink(Intent intent, boolean dispatchImmediately) {
        if (intent == null || intent.getData() == null) return;
        String url = intent.getDataString();
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
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String consumeLaunchUrl() {
            String url = pendingLaunchUrl;
            pendingLaunchUrl = null;
            return url == null ? "" : url;
        }

        @JavascriptInterface
        public boolean shareFile(String filename, String mimeType, String content) {
            byte[] bytes = (content == null ? "" : content).getBytes(StandardCharsets.UTF_8);
            return dispatchShareBytes(filename, mimeType, bytes);
        }

        @JavascriptInterface
        public boolean shareBinaryFile(String filename, String mimeType, String base64Content) {
            try {
                byte[] bytes = Base64.decode(base64Content == null ? "" : base64Content, Base64.DEFAULT);
                return dispatchShareBytes(filename, mimeType, bytes);
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean copyToClipboard(String text) {
            try {
                final String safeText = text == null ? "" : text;
                runOnUiThread(() -> {
                    ClipboardManager clipboard =
                        (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (clipboard != null) {
                        ClipData clip = ClipData.newPlainText("Mizan", safeText);
                        clipboard.setPrimaryClip(clip);
                    }
                });
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean setScreenSecure(boolean secure) {
            runOnUiThread(() -> {
                if (secure) {
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                } else {
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                }
            });
            return true;
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public boolean setSystemBarStyle(String hexColor, final boolean darkIcons) {
            try {
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
                    } catch (Exception ignored) {
                    }
                });
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }
}

package com.mizan.finance;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new MizanNativeBridge(), "MizanNative");
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
    }
}

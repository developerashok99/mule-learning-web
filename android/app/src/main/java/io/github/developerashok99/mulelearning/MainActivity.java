package io.github.developerashok99.mulelearning;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * The bundled study site has a page per folder (/podcasts/ → public/podcasts/index.html), like on GitHub Pages.
 * Capacitor's local server would answer every folder URL with the root index.html (single-page-app routing), so
 * folder URLs are served here: the folder's index.html, or the site's 404 page. Everything else (scripts, images,
 * downloaded audio via _capacitor_file_) is left to Capacitor.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    WebResourceResponse page = folderPage(request);
                    return page != null ? page : super.shouldInterceptRequest(view, request);
                }
            }
        );
    }

    private WebResourceResponse folderPage(WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        if (!"localhost".equals(url.getHost()) || path == null || path.length() < 2 || !path.endsWith("/")) return null;
        if (path.startsWith("/_capacitor_")) return null;
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        try {
            return html(open("public" + path + "index.html"), 200, "OK", headers);
        } catch (IOException missing) {
            try {
                return html(open("public/404.html"), 404, "Not Found", headers);
            } catch (IOException e) {
                return null;
            }
        }
    }

    private InputStream open(String asset) throws IOException {
        // Capacitor's JavaScript bridge is added to the page here when the WebView cannot inject it itself
        return bridge.getLocalServer().getJavaScriptInjectedStream(getAssets().open(asset));
    }

    private static WebResourceResponse html(InputStream in, int status, String reason, Map<String, String> headers) {
        return new WebResourceResponse("text/html", "utf-8", status, reason, headers, in);
    }
}

package com.signageos.player.playback

import android.annotation.SuppressLint
import android.content.Context
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import com.signageos.player.data.ManifestItem
import kotlinx.serialization.json.jsonPrimitive

class WebCreativeView(
    context: Context,
    private val container: FrameLayout,
    private val onRenderCrash: (assetId: String) -> Unit,
) {
    private var webView: WebView? = null
    private var activeAssetId: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    private fun ensureWebView(): WebView {
        webView?.let { return it }
        val wv = WebView(container.context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webViewClient = object : WebViewClient() {
                override fun onRenderProcessGone(
                    view: WebView?,
                    detail: RenderProcessGoneDetail?,
                ): Boolean {
                    val crashed = activeAssetId
                    teardown()
                    if (crashed != null) onRenderCrash(crashed)
                    return true
                }
            }
        }
        container.removeAllViews()
        container.addView(wv)
        webView = wv
        return wv
    }

    fun render(item: ManifestItem) {
        activeAssetId = item.assetId
        val wv = ensureWebView()
        val cfg = item.appConfig
        val url = cfg?.get("url")?.jsonPrimitive?.content ?: item.url

        when (item.type) {
            "webpage" -> {
                if (url.startsWith("https://") || url.startsWith("http://")) {
                    wv.loadUrl(url)
                } else {
                    renderHtmlCard(wv, item.title, "Invalid webpage URL")
                }
            }
            "youtube" -> {
                val vid = cfg?.get("videoId")?.jsonPrimitive?.content ?: ""
                if (vid.isNotBlank()) {
                    val html = """
                        <html><body style="margin:0;background:#000;">
                        <iframe width="100%" height="100%" src="https://www.youtube.com/embed/$vid?autoplay=1&mute=1&controls=0&playsinline=1"
                        frameborder="0" allow="autoplay; encrypted-media"></iframe></body></html>
                    """.trimIndent()
                    wv.loadDataWithBaseURL("https://www.youtube.com", html, "text/html", "utf-8", null)
                } else {
                    renderHtmlCard(wv, item.title, "YouTube videoId missing")
                }
            }
            else -> {
                val headline = cfg?.get("headline")?.jsonPrimitive?.content ?: item.title
                val body = cfg?.get("body")?.jsonPrimitive?.content ?: ""
                renderHtmlCard(wv, headline, body)
            }
        }
    }

    private fun renderHtmlCard(wv: WebView, headline: String, body: String) {
        val safeHead = headline.replace("<", "&lt;").replace(">", "&gt;")
        val safeBody = body.replace("<", "&lt;").replace(">", "&gt;")
        val html = """
            <html><body style="margin:0;padding:48px;background:#09090b;color:#fafafa;font-family:sans-serif;display:flex;flex-direction:column;justify-content:center;height:100vh;box-sizing:border-box;">
            <h1 style="font-size:44px;margin:0 0 16px 0;">$safeHead</h1>
            <p style="font-size:24px;color:#d4d4d8;margin:0;">$safeBody</p>
            </body></html>
        """.trimIndent()
        wv.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    fun teardown() {
        activeAssetId = null
        container.removeAllViews()
        webView?.destroy()
        webView = null
    }
}

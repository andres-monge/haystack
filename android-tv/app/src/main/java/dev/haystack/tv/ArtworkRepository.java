package dev.haystack.tv;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.TimeUnit;
import org.json.JSONException;
import org.json.JSONObject;

final class ArtworkRepository {
    private final URI origin;
    private final ArtworkCache cache;
    private static final int TIMEOUT_MILLIS = 5000;
    private final AtomicBoolean fetching = new AtomicBoolean();
    private volatile String acceptedId;

    ArtworkRepository(String origin, ArtworkCache cache) {
        this.origin = URI.create(origin);
        if (!"http".equals(this.origin.getScheme()) || this.origin.getHost() == null ||
                this.origin.getUserInfo() != null || this.origin.getRawQuery() != null ||
                this.origin.getRawFragment() != null || !this.origin.getPath().isEmpty()) {
            throw new IllegalArgumentException("Expected a configured HTTP LAN origin without a path");
        }
        this.cache = cache;
    }

    Artwork loadCached() {
        Artwork artwork = cache.load();
        if (artwork != null) acceptedId = artwork.id;
        return artwork;
    }

    Artwork refresh(FetchCancellation cancellation) {
        if (!fetching.compareAndSet(false, true)) return null;
        try {
            cancellation.check();
            JSONObject latest = new JSONObject(new String(get(origin.resolve("/api/latest"), 64 * 1024, cancellation), StandardCharsets.UTF_8));
            String id = latest.getJSONObject("metadata").getString("id");
            if (!ArtworkCache.validId(id)) throw new IOException("Invalid render ID");
            URI image = origin.resolve(latest.getString("imageUrl"));
            if (!sameOrigin(image) || !image.getRawPath().equals("/api/outputs/" + id) ||
                    image.getRawQuery() != null || image.getRawFragment() != null || image.getUserInfo() != null) {
                throw new IOException("Image URL outside the configured presentation endpoint");
            }
            if (id.equals(acceptedId)) return null;
            byte[] bytes = get(image, ArtworkDecoder.MAX_BYTES, cancellation);
            Artwork accepted = cache.commit(id, bytes, cancellation);
            acceptedId = id;
            return accepted;
        } catch (IOException | JSONException | IllegalArgumentException failure) {
            return null;
        } finally {
            fetching.set(false);
        }
    }

    private boolean sameOrigin(URI uri) {
        return origin.getScheme().equals(uri.getScheme()) && origin.getHost().equalsIgnoreCase(uri.getHost()) &&
                port(origin) == port(uri);
    }
    private static int port(URI uri) { return uri.getPort() == -1 ? 80 : uri.getPort(); }

    private byte[] get(URI uri, int limit, FetchCancellation cancellation) throws IOException {
        if (!sameOrigin(uri)) throw new IOException("Foreign origin");
        cancellation.check();
        HttpURLConnection connection = (HttpURLConnection) uri.toURL().openConnection();
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(TIMEOUT_MILLIS * 3L);
        try {
            cancellation.attach(connection);
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(TIMEOUT_MILLIS);
            connection.setReadTimeout(TIMEOUT_MILLIS);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (connection.getResponseCode() != 200) throw new IOException("Non-200 response");
            long declared = connection.getContentLengthLong();
            if (declared > limit) throw new IOException("Response size limit");
            try (var input = connection.getInputStream(); var output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    cancellation.check();
                    if (System.nanoTime() > deadline) throw new IOException("Response deadline");
                    if (output.size() > limit - read) throw new IOException("Response size limit");
                    output.write(buffer, 0, read);
                }
                cancellation.check();
                if (declared >= 0 && declared != output.size()) throw new IOException("Truncated response");
                return output.toByteArray();
            }
        } finally {
            cancellation.detach(connection);
            connection.disconnect();
        }
    }

}

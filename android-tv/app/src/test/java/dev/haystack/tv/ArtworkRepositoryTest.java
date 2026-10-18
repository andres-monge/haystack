package dev.haystack.tv;

import static org.junit.Assert.*;

import android.graphics.Bitmap;
import android.graphics.Color;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class ArtworkRepositoryTest {
    static byte[] image(Bitmap.CompressFormat format, int color, int width, int height) {
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        bitmap.eraseColor(color);
        var out = new ByteArrayOutputStream();
        bitmap.compress(format, 95, out);
        bitmap.recycle();
        return out.toByteArray();
    }
    static byte[] png(int color) { return image(Bitmap.CompressFormat.PNG, color, 64, 36); }
    static ArtworkCache cache() throws IOException {
        return new ArtworkCache(Files.createTempDirectory("haystack-cache").toFile());
    }
    static final class Fixture implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0);
        volatile String id = "A", imageUrl;
        volatile byte[] bytes = png(Color.BLUE);
        volatile int imageStatus = 200, latestStatus = 200, imageRequests, latestRequests;
        volatile String redirect;
        volatile long imageLengthOverride = -1;
        volatile CountDownLatch entered, release;
        final Thread thread;
        Fixture() throws IOException {
            thread = new Thread(() -> {
                while (!socket.isClosed()) {
                    try (var client = socket.accept()) {
                        client.setSoTimeout(2000);
                        var reader = new java.io.BufferedReader(new java.io.InputStreamReader(client.getInputStream()));
                        String request = reader.readLine();
                        String line;
                        do { line = reader.readLine(); } while (line != null && !line.isEmpty());
                        boolean latest = request.contains(" /api/latest ");
                        if (latest) latestRequests++; else imageRequests++;
                        if (!latest && entered != null) { entered.countDown(); release.await(8, TimeUnit.SECONDS); }
                        byte[] body = latest ? ("{\"metadata\":{\"id\":\"" + id + "\"},\"imageUrl\":\"" +
                            (imageUrl == null ? "/api/outputs/" + id : imageUrl) + "\"}").getBytes(StandardCharsets.UTF_8) : bytes;
                        int status = latest ? latestStatus : imageStatus;
                        String location = redirect == null ? "" : "Location: " + redirect + "\r\n";
                        client.getOutputStream().write(("HTTP/1.1 " + status + " Test\r\n" + location +
                            "Content-Length: " + (!latest && imageLengthOverride >= 0 ? imageLengthOverride : body.length) + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                        client.getOutputStream().write(body);
                    } catch (Exception ignored) { /* Closing/cancelling a fixture request is expected. */ }
                }
            });
            thread.setDaemon(true); thread.start();
        }
        String origin() { return "http://127.0.0.1:" + socket.getLocalPort(); }
        @Override public void close() throws Exception { socket.close(); thread.join(4000); }
    }

    @Test public void retriesSameIdAndKeepsLastGoodOnEmptyPurgeAndCorruption() throws Exception {
        try (var fixture = new Fixture()) {
            var cache = cache();
            var repository = new ArtworkRepository(fixture.origin(), cache);
            assertEquals("A", repository.refresh(new FetchCancellation()).id);
            fixture.id = "B"; fixture.imageStatus = 404;
            assertNull(repository.refresh(new FetchCancellation()));
            assertEquals("A", cache.load().id);
            fixture.imageStatus = 200; fixture.bytes = new byte[] {1, 2, 3};
            assertNull(repository.refresh(new FetchCancellation()));
            assertEquals("A", cache.load().id);
            fixture.bytes = png(Color.RED);
            assertEquals("B", repository.refresh(new FetchCancellation()).id);
            assertEquals(4, fixture.imageRequests);
            fixture.latestStatus = 404;
            assertNull(repository.refresh(new FetchCancellation()));
            assertEquals("B", cache.load().id);
            fixture.latestStatus = 200;
            assertNull(repository.refresh(new FetchCancellation()));
            assertEquals(4, fixture.imageRequests); // Accepted ID does not download again.
        }
    }

    @Test public void refusesOversizeHeaderAndTruncatedHttpBodyWithoutReplacingLastGood() throws Exception {
        try (var fixture = new Fixture()) {
            var cache = cache(); var repository = new ArtworkRepository(fixture.origin(), cache);
            assertEquals("A", repository.refresh(new FetchCancellation()).id);
            fixture.id = "B"; fixture.bytes = png(Color.RED);
            fixture.imageLengthOverride = ArtworkDecoder.MAX_BYTES + 1L;
            assertNull(repository.refresh(new FetchCancellation()));
            assertEquals("A", cache.load().id);
            fixture.imageLengthOverride = fixture.bytes.length + 100;
            assertNull(repository.refresh(new FetchCancellation()));
            assertEquals("A", cache.load().id);
        }
    }

    @Test public void rejectsForeignOriginAndRedirectWithoutContactingTarget() throws Exception {
        try (var fixture = new Fixture(); var foreign = new Fixture()) {
            var repository = new ArtworkRepository(fixture.origin(), cache());
            fixture.imageUrl = foreign.origin() + "/api/outputs/A";
            assertNull(repository.refresh(new FetchCancellation()));
            assertEquals(0, foreign.imageRequests);
            fixture.imageUrl = null; fixture.imageStatus = 302; fixture.redirect = foreign.origin() + "/api/outputs/A";
            assertNull(repository.refresh(new FetchCancellation()));
            assertEquals(0, foreign.imageRequests);
        }
    }

    @Test public void cancellationDisconnectsAndSingleFlightRejectsDuplicateFetch() throws Exception {
        try (var fixture = new Fixture()) {
            var cache = cache(); var repository = new ArtworkRepository(fixture.origin(), cache);
            fixture.entered = new CountDownLatch(1); fixture.release = new CountDownLatch(1);
            var token = new FetchCancellation();
            var worker = new Thread(() -> repository.refresh(token)); worker.start();
            assertTrue(fixture.entered.await(2, TimeUnit.SECONDS));
            assertNull(repository.refresh(new FetchCancellation()));
            token.cancel(); fixture.release.countDown(); worker.join(3000);
            assertFalse(worker.isAlive()); assertNull(cache.load());
            assertEquals(1, fixture.latestRequests);
        }
    }

    @Test public void stalledHttpTimesOutWithoutReplacingCache() throws Exception {
        try (var fixture = new Fixture()) {
            var cache = cache(); var repository = new ArtworkRepository(fixture.origin(), cache);
            fixture.entered = new CountDownLatch(1); fixture.release = new CountDownLatch(1);
            assertNull(repository.refresh(new FetchCancellation()));
            assertNull(cache.load()); fixture.release.countDown();
        }
    }
}

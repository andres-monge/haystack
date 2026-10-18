package dev.haystack.tv;

import static org.junit.Assert.*;
import android.graphics.Color;
import android.os.Looper;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.annotation.LooperMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@LooperMode(LooperMode.Mode.PAUSED)
public class DreamArtworkControllerTest {
    @Test public void duplicateStartAndStopDuringFetchCannotPublishAfterStop() throws Exception {
        try (var fixture = new ArtworkRepositoryTest.Fixture()) {
            var shown = new ArrayList<String>();
            var controller = new DreamArtworkController(new ArtworkRepository(fixture.origin(), ArtworkRepositoryTest.cache()), art -> shown.add(art.id));
            fixture.entered = new CountDownLatch(1); fixture.release = new CountDownLatch(1);
            controller.start(); controller.start();
            assertTrue(fixture.entered.await(2, TimeUnit.SECONDS));
            controller.stop(); controller.stop(); fixture.release.countDown();
            Thread.sleep(100);
            Shadows.shadowOf(Looper.getMainLooper()).idle();
            assertTrue(shown.isEmpty());
            assertEquals(1, fixture.latestRequests);
        }
    }
    @Test public void offlineSessionDisplaysDurableCacheBeforeNetworkCompletes() throws Exception {
        try (var fixture = new ArtworkRepositoryTest.Fixture()) {
            var cache = ArtworkRepositoryTest.cache();
            cache.commit("cached", ArtworkRepositoryTest.png(Color.BLUE), new FetchCancellation());
            fixture.latestStatus = 503;
            var shown = new ArrayList<String>();
            var controller = new DreamArtworkController(new ArtworkRepository(fixture.origin(), cache), art -> shown.add(art.id));
            try {
                controller.start();
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
                while (shown.isEmpty() && System.nanoTime() < deadline) {
                    Thread.sleep(10); Shadows.shadowOf(Looper.getMainLooper()).idle();
                }
                assertEquals(java.util.List.of("cached"), shown);
            } finally { controller.stop(); }
        }
    }
}

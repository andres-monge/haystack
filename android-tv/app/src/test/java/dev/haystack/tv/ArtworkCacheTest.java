package dev.haystack.tv;

import static org.junit.Assert.*;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.util.AtomicFile;
import java.io.File;
import java.nio.file.Files;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 35})
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class ArtworkCacheTest {
    @Test public void coldStartRecoversCommittedIdAndBytesAfterInterruptedAtomicWrite() throws Exception {
        File directory = Files.createTempDirectory("cache-recovery").toFile();
        assertNull(new ArtworkCache(directory).load());
        new ArtworkCache(directory).commit("A", ArtworkRepositoryTest.png(Color.BLUE), new FetchCancellation());
        // Real Android AtomicFile crash boundary: open a replacement but never finish/fail it.
        var atomic = new AtomicFile(new File(directory, "artwork.bin"));
        var abandoned = atomic.startWrite(); abandoned.write(new byte[] {1, 2, 3}); abandoned.close();
        var recovered = new ArtworkCache(directory).load();
        assertNotNull(recovered); assertEquals("A", recovered.id);
        assertEquals(Color.BLUE, recovered.bitmap.getPixel(20, 20));
    }
    @Test public void supportsFormatsAndSamplesTo1080pBounds() throws Exception {
        for (var format : new Bitmap.CompressFormat[] {Bitmap.CompressFormat.PNG, Bitmap.CompressFormat.JPEG, Bitmap.CompressFormat.WEBP}) {
            var art = ArtworkDecoder.decode("A", ArtworkRepositoryTest.image(format, Color.RED, 3840, 2160));
            assertTrue(art.bitmap.getWidth() <= 1920); assertTrue(art.bitmap.getHeight() <= 1080);
            assertTrue(art.bitmap.getAllocationByteCount() <= 1920 * 1080 * 4);
        }
    }
    @Test public void rejectsTruncationOversizeAndOver40Megapixels() throws Exception {
        byte[] valid = ArtworkRepositoryTest.png(Color.RED);
        for (var format : new Bitmap.CompressFormat[] {Bitmap.CompressFormat.PNG, Bitmap.CompressFormat.JPEG, Bitmap.CompressFormat.WEBP}) {
            byte[] bytes = ArtworkRepositoryTest.image(format, Color.RED, 64, 36);
            rejects(java.util.Arrays.copyOf(bytes, bytes.length - 8));
        }
        rejects(new byte[32 * 1024 * 1024 + 1]);
        // A valid PNG IHDR with dimensions above 40MP; bounds gate must reject before allocation.
        byte[] large = valid.clone();
        java.nio.ByteBuffer.wrap(large, 16, 8).putInt(10000).putInt(5000);
        var crc = new java.util.zip.CRC32(); crc.update(large, 12, 17);
        java.nio.ByteBuffer.wrap(large, 29, 4).putInt((int) crc.getValue());
        rejects(large);
    }
    private static void rejects(byte[] bytes) throws Exception {
        try { ArtworkDecoder.decode("invalid", bytes); fail("Invalid image accepted"); }
        catch (java.io.IOException expected) { }
    }
    @Test public void cancelledCandidateNeverReplacesCommittedPairAndOfflineColdStartIsLocal() throws Exception {
        File directory = Files.createTempDirectory("cache-cancel").toFile();
        var cache = new ArtworkCache(directory);
        cache.commit("A", ArtworkRepositoryTest.png(Color.BLUE), new FetchCancellation());
        var cancelled = new FetchCancellation(); cancelled.cancel();
        try { cache.commit("B", ArtworkRepositoryTest.png(Color.RED), cancelled); fail(); }
        catch (java.io.IOException expected) { }
        assertEquals("A", new ArtworkCache(directory).load().id);
    }
}

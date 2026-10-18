package dev.haystack.tv;

import static org.junit.Assert.*;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.util.AtomicFile;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.File;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class ArtworkRecoveryTest {
    @Test public void interruptedAtomicReplacementRecoversMatchingIdAndBytes() throws Exception {
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File directory = new File(context.getCacheDir(), "recovery-test");
        assertTrue(directory.isDirectory() || directory.mkdirs());
        var bitmap = Bitmap.createBitmap(32, 18, Bitmap.Config.ARGB_8888);
        bitmap.eraseColor(Color.BLUE);
        var bytes = new ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes); bitmap.recycle();
        new ArtworkCache(directory).commit("A", bytes.toByteArray(), new FetchCancellation());
        var abandoned = new AtomicFile(new File(directory, "artwork.bin")).startWrite();
        abandoned.write(new byte[] {1, 2, 3}); abandoned.getFD().sync(); abandoned.close();
        var cold = new ArtworkCache(directory).load();
        assertNotNull(cold); assertEquals("A", cold.id); assertEquals(Color.BLUE, cold.bitmap.getPixel(10, 10));
        cold.bitmap.recycle();
        for (File file : directory.listFiles()) assertTrue(file.delete());
        assertTrue(directory.delete());
    }
}

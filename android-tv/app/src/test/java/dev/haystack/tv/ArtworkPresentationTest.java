package dev.haystack.tv;

import static org.junit.Assert.*;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Canvas;
import android.view.View;
import android.graphics.drawable.BitmapDrawable;
import android.os.Looper;
import android.widget.ImageView;
import java.time.Duration;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadows.ShadowChoreographer;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 35})
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@LooperMode(LooperMode.Mode.PAUSED)
public class ArtworkPresentationTest {
    @Before public void useTimedAnimationFrames() {
        ShadowChoreographer.setPaused(true);
        ShadowChoreographer.setFrameDelay(Duration.ofMillis(16));
    }
    @Test public void firstArtIsImmediateThenNewArtCrossfadesWithoutDarkeningOldLayer() {
        var view = new ArtworkPresentation(RuntimeEnvironment.getApplication());
        Artwork first = art("a", Color.BLUE);
        Artwork next = art("b", Color.RED);
        view.show(first);
        ImageView outgoing = image(view, 0);
        assertSame(first.bitmap, bitmap(outgoing));
        assertEquals(1f, outgoing.getAlpha(), 0f);
        view.show(next);
        ImageView incoming = image(view, 1);
        assertSame(next.bitmap, bitmap(incoming));
        assertEquals(0f, incoming.getAlpha(), 0f);
        advance(1000);
        assertEquals(1f, outgoing.getAlpha(), 0f);
        assertEquals(0.5f, incoming.getAlpha(), 0.15f);
        advance(1100);
        assertEquals(1f, incoming.getAlpha(), 0f);
        assertNull(outgoing.getDrawable());
        assertSame(next.bitmap, bitmap(incoming));
    }

    @Test public void sameIdDoesNotReplaceOrRestartAndRapidChangeKeepsOnlyTwoLayers() {
        var view = new ArtworkPresentation(RuntimeEnvironment.getApplication());
        Artwork first = art("a", Color.BLUE);
        Artwork next = art("b", Color.RED);
        view.show(first);
        view.show(art("a", Color.GREEN));
        assertSame(first.bitmap, bitmap(image(view, 0)));
        assertNull(image(view, 1).getDrawable());
        view.show(next);
        advance(500);
        float alpha = image(view, 1).getAlpha();
        view.show(art("b", Color.GREEN));
        assertEquals(alpha, image(view, 1).getAlpha(), 0f);
        Artwork third = art("c", Color.YELLOW);
        view.show(third);
        assertEquals(2, view.getChildCount());
        assertSame(next.bitmap, bitmap(image(view, 0)));
        assertEquals(1f, image(view, 0).getAlpha(), 0f);
        assertSame(third.bitmap, bitmap(image(view, 1)));
        assertEquals(0f, image(view, 1).getAlpha(), 0f);
        advance(2100);
        assertNull(image(view, 0).getDrawable());
        assertSame(third.bitmap, bitmap(image(view, 1)));
    }

    @Test public void stopReleasesLayersAndAnimationAndNextSessionStartsImmediately() {
        var view = new ArtworkPresentation(RuntimeEnvironment.getApplication());
        view.show(art("a", Color.BLUE));
        view.show(art("b", Color.RED));
        advance(500);
        view.clear();
        advance(3000);
        assertFalse(image(view, 0).getDrawable() instanceof BitmapDrawable);
        assertNull(image(view, 1).getDrawable());
        Artwork cached = art("b", Color.RED);
        view.show(cached);
        assertSame(cached.bitmap, bitmap(image(view, 0)));
        assertEquals(1f, image(view, 0).getAlpha(), 0f);
        assertNull(image(view, 1).getDrawable());
    }

    @Test public void midpointBlendsOpaqueFramesIncludingChangedLetterboxing() {
        var view = new ArtworkPresentation(RuntimeEnvironment.getApplication());
        view.show(art("wide", Color.BLUE));
        Bitmap portrait = Bitmap.createBitmap(10, 18, Bitmap.Config.ARGB_8888);
        portrait.eraseColor(Color.RED);
        view.show(new Artwork("portrait", portrait));
        advance(1000);
        int specWidth = View.MeasureSpec.makeMeasureSpec(320, View.MeasureSpec.EXACTLY);
        int specHeight = View.MeasureSpec.makeMeasureSpec(180, View.MeasureSpec.EXACTLY);
        view.measure(specWidth, specHeight);
        view.layout(0, 0, 320, 180);
        Bitmap output = Bitmap.createBitmap(320, 180, Bitmap.Config.ARGB_8888);
        view.draw(new Canvas(output));
        int center = output.getPixel(160, 90);
        assertEquals(255, Color.alpha(center));
        assertTrue(Color.red(center) > 90 && Color.blue(center) > 90);
        // Incoming letterbox replaces the old wide art gradually, with no blue
        // ghost left at completion and no transparent fade-through-black.
        int edge = output.getPixel(0, 90);
        assertTrue(Color.blue(edge) > 100 && Color.blue(edge) < 220);
        advance(1100);
        view.draw(new Canvas(output));
        assertEquals(Color.rgb(24, 42, 61), output.getPixel(0, 90));
        assertEquals(Color.RED, output.getPixel(160, 90));
        output.recycle();
        view.clear();
    }

    @Test public void fullHdTransitionRetainsOnlyTwoFittedBitmapAllocations() {
        var view = new ArtworkPresentation(RuntimeEnvironment.getApplication());
        Bitmap a = Bitmap.createBitmap(1920, 1080, Bitmap.Config.ARGB_8888);
        Bitmap b = Bitmap.createBitmap(1920, 1080, Bitmap.Config.ARGB_8888);
        view.show(new Artwork("a", a));
        view.show(new Artwork("b", b));
        long retained = (long) bitmap(image(view, 0)).getAllocationByteCount()
                + bitmap(image(view, 1)).getAllocationByteCount();
        assertEquals(16_588_800L, retained);
        advance(2100);
        assertNull(image(view, 0).getDrawable());
        assertEquals(8_294_400, bitmap(image(view, 1)).getAllocationByteCount());
        view.clear();
    }

    private static ImageView image(ArtworkPresentation view, int index) {
        return (ImageView) view.getChildAt(index);
    }
    private static Bitmap bitmap(ImageView image) {
        return ((BitmapDrawable) image.getDrawable()).getBitmap();
    }
    private static Artwork art(String id, int color) {
        Bitmap bitmap = Bitmap.createBitmap(32, 18, Bitmap.Config.ARGB_8888);
        bitmap.eraseColor(color);
        return new Artwork(id, bitmap);
    }
    private static void advance(long millis) {
        // Advance each vsync; one large jump establishes the first frame at the
        // end of that jump instead of running intermediate animation frames.
        for (long elapsed = 0; elapsed < millis; elapsed += 16) {
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(Math.min(16, millis - elapsed)));
        }
    }
}

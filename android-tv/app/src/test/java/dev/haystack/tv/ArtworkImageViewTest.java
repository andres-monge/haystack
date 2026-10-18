package dev.haystack.tv;

import static org.junit.Assert.*;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.RectF;
import android.graphics.drawable.BitmapDrawable;
import android.widget.ImageView;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 35}, qualifiers = "xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class ArtworkImageViewTest {
    @Test public void fittedBitmapDrawUsesWholePhysicalPixelsAfterChanges() {
        var context = RuntimeEnvironment.getApplication();
        ImageView view = new ArtworkImageView(context);
        view.setScaleType(ImageView.ScaleType.FIT_CENTER);
        Bitmap bitmap = Bitmap.createBitmap(1920, 1065, Bitmap.Config.ARGB_8888);
        bitmap.setDensity(160); // Resource density differs from the physical xhdpi display.
        var landscape = new ObservedBitmap(bitmap);
        view.setImageDrawable(landscape);
        draw(view, 1920, 1080);
        assertEquals(new RectF(0, 8, 1920, 1073), landscape.physicalBounds);
        assertEquals(1f, landscape.physicalBounds.width() / bitmap.getWidth(), 0f);
        assertEquals(1f, landscape.physicalBounds.height() / bitmap.getHeight(), 0f);

        draw(view, 1920, 1081);
        assertEquals(new RectF(0, 8, 1920, 1073), landscape.physicalBounds);

        Bitmap portraitBitmap = Bitmap.createBitmap(599, 1080, Bitmap.Config.ARGB_8888);
        portraitBitmap.setDensity(320);
        var portrait = new ObservedBitmap(portraitBitmap);
        view.setImageDrawable(portrait);
        draw(view, 1920, 1080);
        assertEquals(new RectF(661, 0, 1260, 1080), portrait.physicalBounds);
        assertTrue(portrait.getPaint().isFilterBitmap());
        bitmap.recycle();
        portraitBitmap.recycle();
    }

    @Test public void builtinVectorKeepsStandardFitAndPlacement() {
        var context = RuntimeEnvironment.getApplication();
        ImageView artwork = new ArtworkImageView(context);
        ImageView standard = new ImageView(context);
        Matrix[] physicalTransforms = new Matrix[2];
        int index = 0;
        for (ImageView view : new ImageView[] {artwork, standard}) {
            view.setScaleType(ImageView.ScaleType.FIT_CENTER);
            view.setImageResource(R.drawable.fixture_art);
            physicalTransforms[index++] = draw(view, 1920, 1081);
        }
        assertNotNull(physicalTransforms[0]);
        assertEquals(physicalTransforms[1], physicalTransforms[0]);
        assertEquals(standard.getDrawable().getBounds(), artwork.getDrawable().getBounds());
        assertEquals(standard.getImageMatrix(), artwork.getImageMatrix());
    }

    private static Matrix draw(ImageView view, int width, int height) {
        view.measure(android.view.View.MeasureSpec.makeMeasureSpec(width, android.view.View.MeasureSpec.EXACTLY),
                android.view.View.MeasureSpec.makeMeasureSpec(height, android.view.View.MeasureSpec.EXACTLY));
        view.layout(0, 0, width, height);
        Bitmap output = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Matrix[] physicalTransform = new Matrix[1];
        view.draw(new Canvas(output) {
            @Override public void concat(Matrix matrix) {
                super.concat(matrix);
                if (physicalTransform[0] == null) {
                    physicalTransform[0] = new Matrix();
                    getMatrix(physicalTransform[0]);
                }
            }
        });
        output.recycle();
        return physicalTransform[0];
    }

    private static final class ObservedBitmap extends BitmapDrawable {
        final RectF physicalBounds = new RectF();
        ObservedBitmap(Bitmap bitmap) {
            super(RuntimeEnvironment.getApplication().getResources(), bitmap);
        }
        @Override public void draw(Canvas canvas) {
            // Inspect the transform at the real drawable entry point: software rasterization
            // alone snaps half-pixel coordinates and would hide the hardware-rendering defect.
            physicalBounds.set(getBounds());
            Matrix physical = new Matrix();
            canvas.getMatrix(physical);
            physical.mapRect(physicalBounds);
            super.draw(canvas);
        }
    }
}

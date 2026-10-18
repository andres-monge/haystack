package dev.haystack.tv;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.drawable.BitmapDrawable;
import android.widget.ImageView;

final class ArtworkImageView extends ImageView {
    private final float[] transform = new float[9];

    ArtworkImageView(Context context) {
        super(context);
    }

    @Override protected void onDraw(Canvas canvas) {
        if (!(getDrawable() instanceof BitmapDrawable)) {
            super.onDraw(canvas);
            return;
        }
        getImageMatrix().getValues(transform);
        float x = transform[Matrix.MTRANS_X];
        float y = transform[Matrix.MTRANS_Y];
        int saved = canvas.save();
        // FIT_CENTER can leave half a spare pixel on each side. Align the final
        // bitmap draw without resampling its already fitted pixels a second time.
        canvas.translate(Math.round(x) - x, Math.round(y) - y);
        super.onDraw(canvas);
        canvas.restoreToCount(saved);
    }
}

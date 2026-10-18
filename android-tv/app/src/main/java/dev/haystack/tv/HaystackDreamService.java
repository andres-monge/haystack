package dev.haystack.tv;

import android.graphics.Color;
import android.service.dreams.DreamService;
import android.view.ViewGroup;
import android.widget.ImageView;

public final class HaystackDreamService extends DreamService {
    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);
        setFullscreen(true);
        ImageView artwork = new ImageView(this);
        artwork.setBackgroundColor(Color.rgb(24, 42, 61));
        artwork.setImageResource(R.drawable.fixture_art);
        artwork.setContentDescription(getString(R.string.fixture_description));
        artwork.setScaleType(ImageView.ScaleType.FIT_CENTER);
        artwork.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(artwork);
    }
}

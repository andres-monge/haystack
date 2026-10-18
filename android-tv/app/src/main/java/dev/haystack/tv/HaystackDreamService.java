package dev.haystack.tv;

import android.graphics.Color;
import android.service.dreams.DreamService;
import android.view.ViewGroup;
import android.widget.ImageView;

public final class HaystackDreamService extends DreamService {
    private DreamArtworkController controller;
    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);
        setFullscreen(true);
        ImageView artwork = new ArtworkImageView(this);
        artwork.setBackgroundColor(Color.rgb(24, 42, 61));
        artwork.setImageResource(R.drawable.fixture_art);
        artwork.setContentDescription(getString(R.string.fixture_description));
        artwork.setScaleType(ImageView.ScaleType.FIT_CENTER);
        artwork.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(artwork);
        controller = new DreamArtworkController(
                new ArtworkRepository(BuildConfig.HAYSTACK_ORIGIN, new ArtworkCache(getFilesDir())),
                image -> {
                    artwork.setImageBitmap(image.bitmap);
                    artwork.setContentDescription(getString(R.string.artwork_description));
                });
    }
    @Override public void onDreamingStarted() {
        super.onDreamingStarted();
        if (controller != null) controller.start();
    }

    @Override public void onDreamingStopped() {
        if (controller != null) controller.stop();
        super.onDreamingStopped();
    }

    @Override public void onDetachedFromWindow() {
        if (controller != null) controller.stop();
        controller = null;
        super.onDetachedFromWindow();
    }
}

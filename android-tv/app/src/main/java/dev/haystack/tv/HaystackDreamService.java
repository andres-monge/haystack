package dev.haystack.tv;

import android.service.dreams.DreamService;
import android.view.ViewGroup;

public final class HaystackDreamService extends DreamService {
    private DreamArtworkController controller;
    private ArtworkPresentation artwork;
    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);
        setFullscreen(true);
        artwork = new ArtworkPresentation(this);
        artwork.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(artwork);
        controller = new DreamArtworkController(
                new ArtworkRepository(BuildConfig.HAYSTACK_ORIGIN, new ArtworkCache(getFilesDir())),
                artwork::show);
    }
    @Override public void onDreamingStarted() {
        super.onDreamingStarted();
        if (controller != null) controller.start();
    }

    @Override public void onDreamingStopped() {
        if (controller != null) controller.stop();
        if (artwork != null) artwork.clear();
        super.onDreamingStopped();
    }

    @Override public void onDetachedFromWindow() {
        if (controller != null) controller.stop();
        if (artwork != null) artwork.clear();
        controller = null;
        artwork = null;
        super.onDetachedFromWindow();
    }
}

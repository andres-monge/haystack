package dev.haystack.tv;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Color;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;

final class ArtworkPresentation extends FrameLayout {
    private final ArtworkImageView first;
    private final ArtworkImageView second;
    private ArtworkImageView current;
    private ValueAnimator transition;
    private String currentId;

    ArtworkPresentation(Context context) {
        super(context);
        setBackgroundColor(Color.rgb(24, 42, 61));
        first = layer(context);
        second = layer(context);
        addView(first);
        addView(second);
        reset();
    }

    private ArtworkImageView layer(Context context) {
        var image = new ArtworkImageView(context);
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        image.setBackgroundColor(Color.rgb(24, 42, 61));
        image.setLayoutParams(new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        return image;
    }

    void show(Artwork artwork) {
        if (artwork.id.equals(currentId)) return;
        finishTransition();
        if (currentId == null) {
            current.setImageBitmap(artwork.bitmap);
        } else {
            ArtworkImageView outgoing = current;
            ArtworkImageView incoming = current == first ? second : first;
            incoming.setImageBitmap(artwork.bitmap);
            incoming.setAlpha(0f);
            incoming.bringToFront();
            current = incoming;
            ValueAnimator animator = ValueAnimator.ofFloat(0f, 1f);
            transition = animator;
            animator.setDuration(2000);
            animator.setInterpolator(new PathInterpolator(0.42f, 0f, 0.58f, 1f));
            animator.addUpdateListener(value -> incoming.setAlpha((float) value.getAnimatedValue()));
            animator.addListener(new AnimatorListenerAdapter() {
                @Override public void onAnimationEnd(Animator animation) {
                    incoming.setAlpha(1f);
                    outgoing.setImageDrawable(null);
                    transition = null;
                }
            });
            animator.start();
        }
        currentId = artwork.id;
        setContentDescription(getContext().getString(R.string.artwork_description));
    }

    private void finishTransition() {
        if (transition != null) transition.end();
    }

    void clear() {
        if (transition != null) {
            transition.removeAllListeners();
            transition.removeAllUpdateListeners();
            transition.cancel();
            transition = null;
        }
        reset();
    }

    private void reset() {
        currentId = null;
        current = first;
        first.setAlpha(1f);
        first.setImageResource(R.drawable.fixture_art);
        second.setAlpha(0f);
        second.setImageDrawable(null);
        second.bringToFront();
        setContentDescription(getContext().getString(R.string.fixture_description));
    }
}

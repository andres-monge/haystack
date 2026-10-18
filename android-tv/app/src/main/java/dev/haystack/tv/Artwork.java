package dev.haystack.tv;

import android.graphics.Bitmap;

final class Artwork {
    final String id;
    final Bitmap bitmap;

    Artwork(String id, Bitmap bitmap) {
        this.id = id;
        this.bitmap = bitmap;
    }
}

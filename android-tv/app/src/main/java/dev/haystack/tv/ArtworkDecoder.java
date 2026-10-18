package dev.haystack.tv;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.zip.CRC32;

final class ArtworkDecoder {
    static final int MAX_BYTES = 32 * 1024 * 1024;
    static final long MAX_PIXELS = 40_000_000L;
    private static final int PNG_IEND_CHUNK = 0x49454e44;

    static Artwork decode(String id, byte[] bytes) throws IOException {
        if (bytes.length == 0 || bytes.length > MAX_BYTES) throw new IOException("Image size limit");
        checkCompleteContainer(bytes);
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 ||
                (long) bounds.outWidth * bounds.outHeight > MAX_PIXELS) {
            throw new IOException("Image dimensions invalid or exceed 40 megapixels");
        }
        int targetWidth = bounds.outWidth;
        int targetHeight = bounds.outHeight;
        int fitRatio = 1;
        if (targetWidth > 1920 || targetHeight > 1080) {
            if ((long) bounds.outWidth * 1080 >= (long) bounds.outHeight * 1920) {
                targetWidth = 1920;
                targetHeight = Math.max(1, (int) ((long) bounds.outHeight * 1920 / bounds.outWidth));
                fitRatio = bounds.outWidth / 1920;
            } else {
                targetHeight = 1080;
                targetWidth = Math.max(1, (int) ((long) bounds.outWidth * 1080 / bounds.outHeight));
                fitRatio = bounds.outHeight / 1080;
            }
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        options.inSampleSize = Integer.highestOneBit(Math.max(1, fitRatio));
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (bitmap == null) throw new IOException("Image decode failed");
        if (bitmap.getWidth() != targetWidth || bitmap.getHeight() != targetHeight) {
            Bitmap fitted = Bitmap.createScaledBitmap(bitmap, targetWidth, targetHeight, true);
            if (fitted != bitmap) bitmap.recycle();
            bitmap = fitted;
        }
        return new Artwork(id, bitmap);
    }

    // Android's decoders can render partially downloaded files. Require a complete supported
    // container before allowing those bytes to replace the durable last-good image.
    private static void checkCompleteContainer(byte[] bytes) throws IOException {
        int length = bytes.length;
        if (length >= 8 && ByteBuffer.wrap(bytes).getLong() == 0x89504e470d0a1a0aL) {
            int offset = 8;
            while (offset <= length - 12) {
                int size = ByteBuffer.wrap(bytes, offset, 4).getInt();
                if (size < 0 || size > length - offset - 12) break;
                CRC32 crc = new CRC32();
                crc.update(bytes, offset + 4, size + 4);
                long stored = Integer.toUnsignedLong(ByteBuffer.wrap(bytes, offset + 8 + size, 4).getInt());
                if (crc.getValue() != stored) throw new IOException("PNG checksum failed");
                int type = ByteBuffer.wrap(bytes, offset + 4, 4).getInt();
                offset += size + 12;
                if (type == PNG_IEND_CHUNK && size == 0 && offset == length) return;
            }
        } else if (length >= 4 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216 &&
                (bytes[length - 2] & 255) == 255 && (bytes[length - 1] & 255) == 217) {
            return;
        } else if (length >= 12 && ByteBuffer.wrap(bytes).getInt() == 0x52494646 &&
                ByteBuffer.wrap(bytes, 8, 4).getInt() == 0x57454250 &&
                Integer.toUnsignedLong(ByteBuffer.wrap(bytes, 4, 4).order(ByteOrder.LITTLE_ENDIAN).getInt()) + 8 == length) {
            return;
        }
        throw new IOException("Unsupported or incomplete image container");
    }

    private ArtworkDecoder() { }
}

package dev.haystack.tv;

import android.util.AtomicFile;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

final class ArtworkCache {
    private static final int RECORD_MAGIC_HST1 = 0x48535431;
    private final AtomicFile record;

    ArtworkCache(File directory) {
        record = new AtomicFile(new File(directory, "artwork.bin"));
    }

    synchronized Artwork load() {
        try (var input = new DataInputStream(record.openRead())) {
            if (input.readInt() != RECORD_MAGIC_HST1) return null;
            String id = input.readUTF();
            int size = input.readInt();
            if (!validId(id) || size <= 0 || size > ArtworkDecoder.MAX_BYTES) return null;
            byte[] expectedHash = new byte[32]; input.readFully(expectedHash);
            byte[] bytes = new byte[size]; input.readFully(bytes);
            if (input.read() != -1 || !MessageDigest.isEqual(expectedHash, hash(bytes))) return null;
            return ArtworkDecoder.decode(id, bytes);
        } catch (IOException | RuntimeException failure) {
            return null;
        }
    }

    synchronized Artwork commit(String id, byte[] bytes, FetchCancellation cancellation) throws IOException {
        if (!validId(id)) throw new IOException("Invalid render ID");
        cancellation.check();
        Artwork candidate = ArtworkDecoder.decode(id, bytes);
        FileOutputStream stream = null;
        try {
            cancellation.check();
            stream = record.startWrite();
            var output = new DataOutputStream(stream);
            output.writeInt(RECORD_MAGIC_HST1); output.writeUTF(id); output.writeInt(bytes.length);
            byte[] expectedHash = hash(bytes);
            output.write(expectedHash);
            for (int offset = 0; offset < bytes.length; offset += 8192) {
                cancellation.check();
                output.write(bytes, offset, Math.min(8192, bytes.length - offset));
            }
            output.flush();
            stream.getFD().sync();
            cancellation.check();
            record.finishWrite(stream);
            stream = null;
            // AtomicFile.finishWrite logs rename errors instead of throwing on some API levels.
            // Verify the complete committed pair before the repository may accept its ID.
            verifyCommitted(id, bytes, expectedHash);
            return candidate;
        } catch (IOException | RuntimeException failure) {
            if (stream != null) record.failWrite(stream);
            candidate.bitmap.recycle();
            throw failure;
        }
    }

    private void verifyCommitted(String id, byte[] bytes, byte[] expectedHash) throws IOException {
        try (var input = new DataInputStream(record.openRead())) {
            if (input.readInt() != RECORD_MAGIC_HST1 || !id.equals(input.readUTF()) || input.readInt() != bytes.length) {
                throw new IOException("Atomic image replacement did not commit");
            }
            byte[] stored = new byte[32]; input.readFully(stored);
            if (!MessageDigest.isEqual(expectedHash, stored)) throw new IOException("Committed ID/bytes mismatch");
            byte[] buffer = new byte[8192];
            int offset = 0;
            while (offset < bytes.length) {
                int size = Math.min(buffer.length, bytes.length - offset);
                input.readFully(buffer, 0, size);
                for (int index = 0; index < size; index++) {
                    if (buffer[index] != bytes[offset + index]) throw new IOException("Committed bytes mismatch");
                }
                offset += size;
            }
            if (input.read() != -1) throw new IOException("Invalid committed record length");
        }
    }

    static boolean validId(String id) { return id != null && id.matches("[A-Za-z0-9_-]+"); }

    private static byte[] hash(byte[] bytes) {
        try { return MessageDigest.getInstance("SHA-256").digest(bytes); }
        catch (NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }
}
